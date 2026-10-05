import postgres from "postgres"
import { z } from "zod"

import { Role } from "./lib/authorization"

const BootstrapAdministratorConfigurationSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().email(),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12),
  DATABASE_URL: z.string().url(),
})

export type BootstrapAdministratorConfig = {
  readonly databaseUrl: string
  readonly email: string
  readonly password: string
}

type AdministratorInput = {
  readonly email: string
  readonly passwordHash: string
}

type BootstrapAdministratorDependencies = {
  readonly create: (input: AdministratorInput) => Promise<boolean>
  readonly hashPassword: (password: string) => Promise<string>
}

export const parseBootstrapAdministratorConfig = (
  environment: Record<string, string | undefined>,
): BootstrapAdministratorConfig => {
  const config = BootstrapAdministratorConfigurationSchema.parse(environment)
  return {
    databaseUrl: config.DATABASE_URL,
    email: config.ADMIN_BOOTSTRAP_EMAIL.toLowerCase(),
    password: config.ADMIN_BOOTSTRAP_PASSWORD,
  }
}

export const bootstrapAdministrator = async (
  config: BootstrapAdministratorConfig,
  dependencies: BootstrapAdministratorDependencies,
): Promise<{ readonly kind: "created" } | { readonly kind: "already_exists" }> => {
  const passwordHash = await dependencies.hashPassword(config.password)
  const created = await dependencies.create({ email: config.email, passwordHash })
  return created ? { kind: "created" } : { kind: "already_exists" }
}

const runBootstrap = async (): Promise<void> => {
  const config = parseBootstrapAdministratorConfig(Bun.env)
  const client = postgres(config.databaseUrl, { max: 1 })
  try {
    const result = await bootstrapAdministrator(config, {
      create: async (input) => {
        const rows = await client<{ readonly email: string }[]>`
          insert into app_user (id, email, display_name, password_hash, role)
          values (${crypto.randomUUID()}, ${input.email}, ${"管理员"}, ${input.passwordHash}, ${Role.Administrator})
          on conflict (email) do nothing
          returning email
        `
        return rows.length === 1
      },
      hashPassword: async (password) => Bun.password.hash(password),
    })
    if (result.kind === "already_exists") {
      throw new Error("Administrator email already exists; refusing to overwrite it")
    }
    console.log("Administrator bootstrap completed")
  } finally {
    await client.end()
  }
}

if (import.meta.main) {
  void runBootstrap().catch((error: unknown) => {
    if (error instanceof Error) {
      console.error(`Administrator bootstrap failed: ${error.message}`)
    } else {
      console.error("Administrator bootstrap failed")
    }
    process.exitCode = 1
  })
}
