import type { Config } from "drizzle-kit"

const { DATABASE_URL: databaseUrl } = process.env

const config = {
  ...(databaseUrl === undefined ? {} : { dbCredentials: { url: databaseUrl } }),
  dialect: "postgresql",
  out: "./src/db/migrations",
  schema: [
    "./src/db/schema/account-pools.ts",
    "./src/db/schema/auth.ts",
    "./src/db/schema/behavior-chains.ts",
    "./src/db/schema/device-commands.ts",
    "./src/db/schema/devices.ts",
    "./src/db/schema/execution-tasks.ts",
    "./src/db/schema/initializer-sync.ts",
    "./src/db/schema/operations.ts",
    "./src/db/schema/registration-resources.ts",
    "./src/db/schema/storage.ts",
    "./src/db/schema/tasks.ts",
  ],
} satisfies Config

// biome-ignore lint/style/noDefaultExport: Drizzle Kit requires a default-exported configuration.
export default config
