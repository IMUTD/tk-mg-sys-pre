import postgres from "postgres"
import { z } from "zod"
import { applyInitializerSnapshot } from "./modules/initializer-sync/repository"
import { readInitializerSnapshot } from "./modules/initializer-sync/source"

export const SyncConfigurationSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    INIT_SOURCE_DATABASE_URL: z.string().url(),
    INIT_SOURCE_KEY: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .default("default"),
    INIT_SYNC_INTERVAL_MS: z.coerce.number().int().min(1000).max(60000).default(5000),
  })
  .superRefine((config, context) => {
    const target = new URL(config.DATABASE_URL)
    const source = new URL(config.INIT_SOURCE_DATABASE_URL)
    if (
      target.hostname === source.hostname &&
      target.port === source.port &&
      target.pathname === source.pathname
    ) {
      context.addIssue({
        code: "custom",
        message: "Initializer and business databases must be separate",
      })
    }
  })

export const startInitializerSync = (environment: Record<string, string | undefined>) => {
  const config = SyncConfigurationSchema.parse(environment)
  const source = postgres(config.INIT_SOURCE_DATABASE_URL, { max: 1, connect_timeout: 5 })
  const target = postgres(config.DATABASE_URL, { max: 1, connect_timeout: 5 })
  let stopping = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const cycle = async (): Promise<void> => {
    try {
      await applyInitializerSnapshot(
        target,
        config.INIT_SOURCE_KEY,
        await readInitializerSnapshot(source),
      )
    } catch (error) {
      // Never log connection strings, source rows, or potentially credential-bearing SQL errors.
      console.error("initializer sync failed", error instanceof Error ? error.name : "Error")
    } finally {
      if (!stopping)
        timer = setTimeout(() => {
          active = cycle()
        }, config.INIT_SYNC_INTERVAL_MS)
    }
  }
  let active = cycle()
  return {
    close: async () => {
      stopping = true
      clearTimeout(timer)
      await active
      await source.end({ timeout: 10 })
      await target.end({ timeout: 10 })
    },
  }
}

if (import.meta.main) {
  const runtime = startInitializerSync(Bun.env)
  const shutdown = () => {
    void runtime.close().catch(() => {
      process.exitCode = 1
    })
  }
  process.once("SIGINT", shutdown)
  process.once("SIGTERM", shutdown)
}
