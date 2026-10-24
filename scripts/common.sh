#!/usr/bin/env bash
set -euo pipefail
STACK_ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd -- "$STACK_ROOT"
umask 077
dc() { docker compose --project-directory "$STACK_ROOT" --env-file "$STACK_ROOT/.env" -f "$STACK_ROOT/compose.yaml" "$@"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null || fail "Required command missing: $1"; }
