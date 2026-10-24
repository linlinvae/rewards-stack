#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
allow_existing=false
[[ ${1:-} != --existing ]] || allow_existing=true
need docker; need python3; need ss
docker info >/dev/null 2>&1 || fail 'Docker daemon unavailable or access denied.'
docker compose version >/dev/null || fail 'Docker Compose v2 required.'
[[ -f .env && ! -L .env ]] || fail 'Missing/unsafe .env; run init.sh.'
[[ $(stat -c '%a' .env) == 600 ]] || fail '.env permissions must be 600.'
dc config -q
cfg=$(mktemp)
trap 'rm -f -- "$cfg"' EXIT
dc config --format json > "$cfg"
project=$(python3 - "$cfg" <<'PY'
import json,sys,os
c=json.load(open(sys.argv[1]))
s,d=c['services']['script'],c['services']['dashboard']
e=s['environment']; de=d['environment']
def check(v,message):
    if not v: raise SystemExit(message)
check(len(e.get('API_TOKEN',''))>=32,'API_TOKEN must have >=32 characters')
check(len(de.get('DASHBOARD_PASSWORD',''))>=24 and de.get('DASHBOARD_USERNAME') and ':' not in de['DASHBOARD_USERNAME'],'Dashboard credentials invalid')
check(de.get('CONTROL_API_TOKEN')==e['API_TOKEN'],'Token mismatch')
check(de.get('CONTROL_API_URL')=='http://script:3010','Invalid Docker service URL')
check(e.get('RUN_ON_START')=='false' and not e.get('CRON_SCHEDULE') and e.get('API_MODE')=='true','Automatic Script execution must be disabled')
for k in ['API_ALLOW_SCHEDULE_WRITE','API_ALLOW_CONFIG_REVEAL','API_ALLOW_ENV_OVERRIDES']:
    check(e.get(k)=='false',k+' must remain false')
check(not s.get('ports'),'Script port publication forbidden')
check(all(p.get('host_ip')=='127.0.0.1' for p in d['ports']),'Dashboard must bind loopback')
check(e.get('TZ')==de.get('TZ'),'Timezone mismatch')
check(os.path.isfile('/usr/share/zoneinfo/'+e['TZ']),'Unknown timezone')
check(not any(k.endswith('_TOTP_SECRET') and v for k,v in e.items()),'TOTP secrets are not allowed in this deployment; handle MFA manually')
check(not any('_PROXY_' in k and v and not (k=='CONFIG_PROXY_IGNORE_CERTIFICATE_ERRORS' and v=='false') for k,v in e.items()),'Proxy configuration needs separate review; not enabled by this deployment')
if os.path.exists('config/schedule.json'):
    check(json.load(open('config/schedule.json')).get('enabled') is False,'Existing Script schedule not explicitly disabled; preserve it and migrate manually')
print(c['name'])
PY
)
existing=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
if [[ -n $existing && $allow_existing == false ]]; then
  fail "Compose project $project already exists. Review its paths/data; use --existing only for this same deployment."
fi
if [[ $allow_existing == false ]]; then
  legacy=$(docker ps -a --format '{{.Names}}' | awk '$0=="microsoft-rewards-script" || $0=="rewards-dashboard"')
  [[ -z $legacy ]] || fail 'Existing legacy Rewards container detected; review before migration.'
  if ss -H -ltn 'sport = :8890' | read -r _; then fail 'Port 8890 already in use.'; fi
else
  [[ -n $existing ]] || fail '--existing requires an existing project; use normal preflight for fresh deployment.'
  for cid in $existing; do
    found=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$cid")
    [[ $found == "$STACK_ROOT" ]] || fail 'Project belongs to a different directory; refusing collision.'
  done
fi
for dir in config sessions data/dashboard data/diagnostics backups; do
  [[ -d $dir && ! -L $dir ]] || fail "Missing/unsafe directory: $dir"
  [[ $(stat -c '%a' "$dir") == 700 ]] || fail "Private directory must be mode 700: $dir (review existing ownership/data first)"
done
[[ $(stat -c '%u:%g' data/dashboard) == 1000:1000 ]] || fail 'Dashboard data must be owned by 1000:1000.'
printf 'PASS: Compose config, credentials, timezone, schedule isolation, project/port conflicts, data paths.\n'
