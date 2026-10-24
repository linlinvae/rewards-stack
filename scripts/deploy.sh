#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
"$STACK_ROOT/scripts/preflight.sh" "${1:-}"
if ! dc build --pull script dashboard; then
  printf 'Registry build failed. Building the pinned upstream source snapshots instead.\n' >&2
  "$STACK_ROOT/scripts/fetch-upstream.sh"
  docker compose -f compose.source.yaml build
  SCRIPT_BASE_IMAGE=rewards-stack-script-base:d0f07d74a0ed \
  DASHBOARD_BASE_IMAGE=rewards-stack-dashboard-base:4a81f9f3bd2a \
    dc build script dashboard
fi
dc up -d --no-build --wait --wait-timeout 240 script dashboard
"$STACK_ROOT/scripts/healthcheck.sh"
