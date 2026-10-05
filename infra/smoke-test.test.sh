#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

"$script_dir/smoke-test.sh" --help | grep -F "Usage: smoke-test.sh"
grep -F '"$web_url/api/auth/session"' "$script_dir/smoke-test.sh"
grep -F 'compose ps' "$script_dir/smoke-test.sh"
repo_root=$(CDPATH= cd -- "$script_dir/.." && pwd)
test -f "$repo_root/.dockerignore"
grep -Fx '.git' "$repo_root/.dockerignore"
grep -Fx 'node_modules' "$repo_root/.dockerignore"
grep -Fx 'infra/.env' "$repo_root/.dockerignore"

reserved_password_compose=$(POSTGRES_PASSWORD='p@ss' POSTGRES_PASSWORD_URL_ENCODED='p%40ss' \
  REDIS_PASSWORD='p@ss' REDIS_PASSWORD_URL_ENCODED='p%40ss' \
  docker compose --env-file "$script_dir/.env.example" -f "$script_dir/docker-compose.yml" config)
printf '%s\n' "$reserved_password_compose" | grep -F 'POSTGRES_PASSWORD: p@ss'
printf '%s\n' "$reserved_password_compose" | grep -F 'REDIS_PASSWORD: p@ss'
printf '%s\n' "$reserved_password_compose" | grep -F 'DATABASE_URL: postgres://tk_mg:p%40ss@postgres:5432/tk_mg'
printf '%s\n' "$reserved_password_compose" | grep -F 'REDIS_URL: redis://:p%40ss@redis:6379/0'
grep -F 'bun --cwd apps/api node_modules/drizzle-kit/bin.cjs migrate --config=drizzle.config.ts' "$script_dir/docker-compose.yml"
