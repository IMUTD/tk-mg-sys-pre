import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

const path = resolve(process.argv[2] ?? "infra/.env.integration")
if (existsSync(path)) throw new Error("Refusing to overwrite an existing environment file")
const databasePassword = crypto.randomUUID().replaceAll("-", "")
const redisPassword = crypto.randomUUID().replaceAll("-", "")
mkdirSync(dirname(path), { recursive: true })
writeFileSync(
  path,
  [
    "POSTGRES_DB=tk_mg_test_integration",
    "POSTGRES_USER=tk_mg",
    `POSTGRES_PASSWORD=${databasePassword}`,
    `POSTGRES_PASSWORD_URL_ENCODED=${databasePassword}`,
    `REDIS_PASSWORD=${redisPassword}`,
    `REDIS_PASSWORD_URL_ENCODED=${redisPassword}`,
    `SECRET_ENCRYPTION_KEY=${crypto.randomUUID().replaceAll("-", "")}`,
    "TK_MG_SYSTEM_ACTOR_ID=99999999-9999-4999-8999-999999999999",
    "TK_MG_WORKER_ID=integration-worker",
    "WEB_BIND_ADDRESS=127.0.0.1",
    "WEB_PORT=18081",
    "ADMIN_BOOTSTRAP_EMAIL=admin@example.internal",
    `ADMIN_BOOTSTRAP_PASSWORD=${crypto.randomUUID()}`,
    "INIT_SOURCE_KEY=default",
    "INIT_SYNC_INTERVAL_MS=5000",
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
)
chmodSync(path, 0o600)
console.log("Created isolated integration configuration; credentials were not printed")
