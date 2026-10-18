#!/usr/bin/env bash
set -euo pipefail

deploy_root=${1:?Usage: rollback.sh /opt/tk-mg-sys}
record="$deploy_root/previous-release"
if [[ -f "$deploy_root/pending-release" ]]; then
  record="$deploy_root/current-release"
fi
[[ -f "$record" ]] || { echo "No successful release is available to restore" >&2; exit 66; }
previous=$(cat "$record")
[[ "$previous" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "Invalid previous release record" >&2; exit 64; }
script="$deploy_root/releases/$previous/infra/deploy.sh"
[[ -f "$script" ]] || { echo "Previous release files are missing" >&2; exit 66; }
echo "Rolling back application images only; database schema is preserved"
exec bash "$script" "$deploy_root" "$previous" --rollback
