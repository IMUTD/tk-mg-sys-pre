#!/usr/bin/env sh
set -eu

usage() {
  echo "Usage: smoke-test.sh [--env-file PATH] [--web-url URL] [--compose-file PATH]"
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file="$script_dir/.env"
web_url=""
compose_file="$script_dir/docker-compose.yml"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      env_file="$2"
      shift 2
      ;;
    --web-url)
      web_url="$2"
      shift 2
      ;;
    --compose-file)
      compose_file="$2"
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 64
      ;;
  esac
done

if [ ! -f "$env_file" ]; then
  echo "Missing environment file: $env_file. Copy infra/.env.example to infra/.env first." >&2
  exit 66
fi

compose() {
  docker compose --env-file "$env_file" -f "$compose_file" "$@"
}

wait_for() {
  description="$1"
  shift
  attempts=0
  until "$@"; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 30 ]; then
      echo "Smoke check failed: $description" >&2
      echo "Compose service state:" >&2
      compose ps >&2 || true
      echo "Recent Compose logs:" >&2
      compose logs --tail=120 postgres redis api web >&2 || true
      exit 1
    fi
    sleep 2
  done
  echo "Ready: $description"
}

wait_for_status() {
  expected_status="$1"
  url="$2"
  status=$(curl --connect-timeout 3 --max-time 5 -sS -o /dev/null -w "%{http_code}" "$url" || true)
  test "$status" = "$expected_status"
}

wait_for "PostgreSQL" compose exec -T postgres sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
wait_for "Redis" compose exec -T redis sh -ec 'redis-cli --no-auth-warning -a "$REDIS_PASSWORD" ping | grep -q PONG'
wait_for "API readiness" compose exec -T api bun -e "const response=await fetch('http://127.0.0.1:3000/ready');if(!response.ok)process.exit(1)"

if [ -z "$web_url" ]; then
  web_port=$(sed -n 's/^WEB_PORT=//p' "$env_file" | tail -n 1)
  web_url="http://127.0.0.1:${web_port:-8080}"
fi
web_url=${web_url%/}
wait_for "web" curl --connect-timeout 3 --max-time 5 -fsS "$web_url/health"
wait_for "Nginx proxied API" wait_for_status 401 "$web_url/api/auth/session"

echo "TK-MG smoke test passed."
