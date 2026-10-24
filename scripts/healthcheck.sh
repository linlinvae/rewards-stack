#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
dc config -q
dc ps
for service in script dashboard; do
  cid=$(dc ps -q "$service")
  [[ -n $cid ]] || fail "$service container missing"
  deadline=$((SECONDS + 120))
  waiting=false
  while true; do
    [[ $(docker inspect -f '{{.State.Status}}' "$cid") == running ]] || fail "$service is not running"
    health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$cid")
    case "$health" in
      healthy) break ;;
      starting)
        (( SECONDS < deadline )) || fail "$service health is still starting after 120 seconds; inspect private container logs"
        if [[ $waiting == false ]]; then
          printf 'WAIT: %s health is starting; waiting up to 120 seconds.\n' "$service"
          waiting=true
        fi
        sleep 2
        ;;
      unhealthy) fail "$service health is unhealthy; inspect private container logs" ;;
      *) fail "$service health status is $health; check its healthcheck configuration" ;;
    esac
  done
done
dc exec -T script node /stack/probe.mjs script
dc exec -T dashboard node /stack/probe.mjs full
dc exec -T script node --input-type=module - <<'NODE'
import fs from 'node:fs';
for(const dir of ['config','sessions','diagnostics']) {
  fs.accessSync(dir,fs.constants.R_OK|fs.constants.W_OK);
  const file=`${dir}/.write-probe-${process.pid}`;
  try { fs.writeFileSync(file,'probe',{flag:'wx',mode:0o600}); } finally { if(fs.existsSync(file))fs.unlinkSync(file); }
}
console.log('PASS: Script persistent paths writable');
NODE
printf 'PASS: read-only health checks finished. No Rewards task or account login triggered.\n'
