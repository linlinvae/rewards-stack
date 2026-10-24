#!/usr/bin/env bash
source "$(dirname -- "$0")/common.sh"
need git
fetch_one() {
  local dir=$1 url=$2 ref=$3
  if [[ ! -e $dir ]]; then
    mkdir -p "$(dirname "$dir")"
    git clone --no-checkout "$url" "$dir"
    git -C "$dir" checkout --detach "$ref"
  fi
  [[ $(git -C "$dir" rev-parse HEAD) == "$ref" ]] || fail "Unexpected source revision in $dir; no files overwritten."
  [[ -z $(git -C "$dir" status --porcelain) ]] || fail "Modified source in $dir; refusing to build a changed snapshot."
}
fetch_one upstream/script https://github.com/TheNetsky/Microsoft-Rewards-Script.git d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e
fetch_one upstream/dashboard https://github.com/mgrimace/rewards-dashboard.git 4a81f9f3bd2aacce59b9cda6377562721760d854
