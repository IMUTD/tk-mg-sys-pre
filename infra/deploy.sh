#!/usr/bin/env bash
set -euo pipefail
umask 077

deploy_root=${1:?Usage: deploy.sh /opt/tk-mg-sys sha-COMMIT [--rollback]}
image_tag=${2:?Image tag is required}
mode=${3:-deploy}
[[ "$image_tag" =~ ^sha-[0-9a-f]{40}$ ]] || { echo "Expected sha- followed by a full commit SHA" >&2; exit 64; }
[[ "$mode" = deploy || "$mode" = --rollback ]] || { echo "Unknown deployment mode" >&2; exit 64; }
[[ "$deploy_root" = /* && "$deploy_root" != / ]] || { echo "Use an absolute deployment directory" >&2; exit 64; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$deploy_root/shared/.env"
[[ -f "$env_file" ]] || { echo "Run setup-deploy-env.sh first" >&2; exit 66; }
export IMAGE_TAG="$image_tag"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-tk-mg}
mkdir -p "$deploy_root/backups"
exec 9>"$deploy_root/deploy.lock"
flock -n 9 || { echo "Another deployment is running" >&2; exit 75; }

compose() {
  docker compose --env-file "$env_file" -f "$script_dir/compose.prod.yml" "$@"
}
report_failure() {
  echo "Deployment failed; successful version record preserved. Check service status on the server." >&2
  compose ps >&2 || true
}
trap report_failure ERR
compose config --quiet
if [[ "$mode" != --rollback ]]; then
  echo "Pulling release images ($image_tag)..."
  compose --profile bootstrap pull
fi
echo "Starting PostgreSQL and Redis..."
compose up -d --pull never --wait --wait-timeout 180 postgres redis
if [[ -f "$deploy_root/current-release" ]]; then
  backup="$deploy_root/backups/$(date -u +%Y%m%dT%H%M%S)-$image_tag.dump"
  compose exec -T postgres sh -ec 'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup.tmp"
  [[ -s "$backup.tmp" ]]
  mv "$backup.tmp" "$backup"
fi
printf '%s\n' "$image_tag" > "$deploy_root/pending-release.tmp"
mv "$deploy_root/pending-release.tmp" "$deploy_root/pending-release"
compose stop worker web api
if [[ "$mode" != --rollback ]]; then
  echo "Applying migrations and initializing deployment accounts..."
  compose --profile bootstrap run --rm --no-deps --pull never initialize
fi
echo "Starting API, worker and web..."
compose up -d --no-build --pull never --wait --wait-timeout 180 api worker web
echo "Checking deployment health..."
bash "$script_dir/smoke-test.sh" --env-file "$env_file" --compose-file "$script_dir/compose.prod.yml"
if [[ -f "$deploy_root/current-release" ]] && [[ "$(cat "$deploy_root/current-release")" != "$image_tag" ]]; then
  cp "$deploy_root/current-release" "$deploy_root/previous-release.tmp"
  mv "$deploy_root/previous-release.tmp" "$deploy_root/previous-release"
fi
printf '%s\n' "$image_tag" > "$deploy_root/current-release.tmp"
mv "$deploy_root/current-release.tmp" "$deploy_root/current-release"
rm -f "$deploy_root/pending-release"
echo "Deployed $image_tag successfully"
