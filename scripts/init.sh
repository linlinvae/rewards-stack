#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
[[ $(uname -s) == Linux ]] || fail 'Run initialization on the target Linux server.'
[[ $EUID -eq 0 ]] || fail 'Use sudo bash scripts/init.sh for secure ownership setup.'
[[ ! -e .env ]] || fail '.env already exists; nothing overwritten. Inspect the existing installation.'
need openssl
for dir in config sessions data backups data/diagnostics; do
  if [[ ! -e $dir ]]; then mkdir -m 700 -- "$dir"; fi
  [[ -d $dir && ! -L $dir ]] || fail "Unsafe data directory: $dir"
done
if [[ ! -e data/dashboard ]]; then
  mkdir -m 700 data/dashboard
  chown 1000:1000 data/dashboard
else
  [[ -d data/dashboard && ! -L data/dashboard ]] || fail 'Unsafe Dashboard data directory.'
  [[ $(stat -c '%u:%g' data/dashboard) == 1000:1000 ]] || fail 'Existing Dashboard directory must be reviewed and owned by UID/GID 1000:1000; no ownership changed.'
fi
temp_env=$(mktemp "$STACK_ROOT/.env.init.XXXXXX")
trap 'rm -f -- "$temp_env"' EXIT
cp -- .env.example "$temp_env"
api_token=$(openssl rand -hex 32)
dashboard_password=$(openssl rand -hex 24)
sed -i "s/^API_TOKEN=$/API_TOKEN=$api_token/;s/^DASHBOARD_PASSWORD=$/DASHBOARD_PASSWORD=$dashboard_password/" "$temp_env"
chmod 600 "$temp_env"
# Hard link provides no-clobber publication even if another initializer races us.
ln -- "$temp_env" .env || fail '.env was created concurrently; refusing overwrite.'
unset api_token dashboard_password
printf 'Created .env (600) and private data directories. Read Dashboard credentials locally with sudoedit .env. No accounts or schedules enabled.\n'
