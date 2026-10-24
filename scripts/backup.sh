#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
[[ $EUID -eq 0 ]] || fail 'Use sudo bash scripts/backup.sh to protect and read all private data.'
need tar; need sha256sum
[[ -d backups && ! -L backups ]] || fail 'Unsafe backup directory.'
[[ $(stat -c '%a' backups) == 700 ]] || fail 'backups must be mode 700.'
exec 9>backups/.backup.lock
flock -n 9 || fail 'Another backup is in progress.'
snapshot="snapshot-$(date -u +%Y-%m-%dT%H-%M-%SZ)-$$"
# Root SQLite readers can create WAL/SHM files even with readOnly:true.
# Restore auxiliary ownership on success and failure, without changing database rows.
trap 'python3 "$STACK_ROOT/scripts/sqlite-helper-permissions.py" "$STACK_ROOT"' EXIT
# Online SQLite snapshots: no service stop, no direct copy of live DB/WAL.
dc --profile tools run --rm --no-deps maintenance /stack/snapshot.mjs "$snapshot"
cp -- .env "backups/$snapshot/.env"
chmod 600 "backups/$snapshot/.env"
tar -C backups -czf "backups/$snapshot.tar.gz" "$snapshot"
chmod 600 "backups/$snapshot.tar.gz"
(cd backups && sha256sum "$snapshot.tar.gz" > "$snapshot.tar.gz.sha256")
printf 'Backup verified: backups/%s.tar.gz (contains secrets; staging retained).\n' "$snapshot"
