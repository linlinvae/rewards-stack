#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ${API_MODE:-} != true || ${RUN_ON_START:-} != false || -n ${CRON_SCHEDULE:-} || ${API_ALLOW_SCHEDULE_WRITE:-} != false ]]; then
  echo 'ERROR: this stack requires API mode, no startup run, and Dashboard-only scheduling.' >&2
  exit 1
fi
if [[ ${#API_TOKEN} -lt 32 || ${API_ALLOW_ENV_OVERRIDES:-} != false || ${API_ALLOW_CONFIG_REVEAL:-} != false ]]; then
  echo 'ERROR: token must be at least 32 characters; env overrides and secret reveal must stay disabled.' >&2
  exit 1
fi
export SCHEDULE_FILE=/run/rewards-stack/no-schedule.json
if [[ -e $SCHEDULE_FILE ]]; then
  echo 'ERROR: reserved disabled-schedule path unexpectedly exists.' >&2
  exit 1
fi
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const file = '/usr/src/microsoft-rewards-script/config/schedule.json';
if (fs.existsSync(file)) {
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (saved.enabled !== false) throw new Error('Existing Script schedule is not explicitly disabled. Preserve it and disable it manually before migration.');
}
NODE
# env_file supports arbitrary ACCOUNT_N_* slots; remove Dashboard-only secrets
# before upstream snapshots the environment or starts browser workers.
unset DASHBOARD_PASSWORD DASHBOARD_USERNAME CONTROL_API_TOKEN
exec /usr/local/bin/entrypoint.sh "$@"
