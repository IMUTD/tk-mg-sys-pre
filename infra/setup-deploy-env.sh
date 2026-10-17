#!/usr/bin/env bash
set -euo pipefail
umask 077

deploy_root=${1:?Usage: setup-deploy-env.sh /opt/tk-mg-sys administrator-email}
admin_email=${2:?Administrator email is required}
web_port=${WEB_PORT:-8080}
[[ "$deploy_root" = /* && "$deploy_root" != / ]] || { echo "Use an absolute deployment directory" >&2; exit 64; }
[[ "$admin_email" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]] || { echo "Invalid administrator email" >&2; exit 64; }
[[ "$web_port" =~ ^[0-9]{1,5}$ ]] && ((10#$web_port >= 1 && 10#$web_port <= 65535)) || { echo "Invalid WEB_PORT" >&2; exit 64; }
mkdir -p "$deploy_root/shared" "$deploy_root/backups" "$deploy_root/releases"
env_file="$deploy_root/shared/.env"
[[ ! -e "$env_file" ]] || { echo "Refusing to overwrite existing deployment credentials" >&2; exit 73; }
postgres_password=$(openssl rand -hex 24)
redis_password=$(openssl rand -hex 24)
encryption_key=$(openssl rand -hex 16)
admin_password=$(openssl rand -hex 24)
set -o noclobber
cat > "$env_file" <<EOF
POSTGRES_DB=tk_mg
POSTGRES_USER=tk_mg
POSTGRES_PASSWORD=$postgres_password
POSTGRES_PASSWORD_URL_ENCODED=$postgres_password
REDIS_PASSWORD=$redis_password
REDIS_PASSWORD_URL_ENCODED=$redis_password
SECRET_ENCRYPTION_KEY=$encryption_key
TK_MG_SYSTEM_ACTOR_ID=99999999-9999-4999-8999-999999999999
WEB_BIND_ADDRESS=0.0.0.0
WEB_PORT=$web_port
AUTH_COOKIE_SECURE=false
ADMIN_BOOTSTRAP_EMAIL=$admin_email
ADMIN_BOOTSTRAP_PASSWORD=$admin_password
EOF
echo "Created $env_file (mode 600). Read administrator credentials directly on the server."
