import { existsSync, readFileSync } from "node:fs"

for (const file of ["infra/.tls.integration/cert.pem", "infra/.tls.integration/key.pem"]) {
  if (!existsSync(file))
    throw new Error("Generate an isolated integration TLS certificate before deployment")
}

const path = process.argv[2] ?? "infra/.integration-fixtures.json"
const fixture: unknown = JSON.parse(readFileSync(path, "utf8"))
if (
  fixture === null ||
  typeof fixture !== "object" ||
  !("DATABASE_URL" in fixture) ||
  !("INIT_SOURCE_DATABASE_URL" in fixture) ||
  typeof fixture.DATABASE_URL !== "string" ||
  typeof fixture.INIT_SOURCE_DATABASE_URL !== "string"
) {
  throw new Error("Invalid integration fixture environment")
}
const target = new URL(fixture.DATABASE_URL)
if (!/^tk_mg_test_[a-zA-Z0-9_]+$/.test(target.pathname.slice(1))) {
  throw new Error("Integration deployment requires a disposable tk_mg_test_* database")
}
const source = new URL(fixture.INIT_SOURCE_DATABASE_URL)
source.hostname = "initializer-postgres"
source.port = "5432"
const child = Bun.spawn(
  [
    "docker",
    "compose",
    "--project-name",
    "tk-mg-integration",
    "--env-file",
    "infra/.env.integration",
    "-f",
    "infra/docker-compose.yml",
    "-f",
    "infra/docker-compose.integration.yml",
    "--profile",
    "initializer",
    "up",
    "-d",
    "--build",
    "api",
    "worker",
    "web",
    "init-sync",
  ],
  {
    env: {
      ...Bun.env,
      POSTGRES_DB: target.pathname.slice(1),
      INIT_SOURCE_DATABASE_URL: source.toString(),
      INIT_SOURCE_KEY: "integration",
    },
    stdout: "inherit",
    stderr: "inherit",
  },
)
process.exitCode = await child.exited
