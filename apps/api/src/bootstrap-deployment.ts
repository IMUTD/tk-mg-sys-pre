import postgres, { type Sql } from "postgres"
import { z } from "zod"

import {
  type BootstrapAdministratorConfig,
  parseBootstrapAdministratorConfig,
} from "./bootstrap-admin"

export type DeploymentBootstrapConfig = BootstrapAdministratorConfig & {
  readonly systemActorId: string
}

class DeploymentIdentityConflictError extends Error {
  constructor() {
    super(
      "Existing deployment identities conflict with the configured administrator or system actor",
    )
    this.name = "DeploymentIdentityConflictError"
  }
}

export const initializeDeploymentDatabase = async (
  client: Sql,
  config: DeploymentBootstrapConfig,
): Promise<void> => {
  const adminHash = await Bun.password.hash(config.password)
  const actorHash = await Bun.password.hash(crypto.randomUUID())
  const actorEmail = `system-${config.systemActorId}@tk-mg.internal`
  await client.begin(async (transaction) => {
    await transaction`
      insert into app_user (id, email, display_name, password_hash, role, enabled)
      values (${config.systemActorId}, ${actorEmail}, '部署系统账号', ${actorHash}, 'administrator', false)
      on conflict do nothing
    `
    const actors = await transaction<{ readonly id: string }[]>`
      select id from app_user where id = ${config.systemActorId}
      and email = ${actorEmail} and role = 'administrator' and enabled = false
    `
    if (actors.length !== 1) throw new DeploymentIdentityConflictError()
    await transaction`
      insert into app_user (id, email, display_name, password_hash, role)
      values (${crypto.randomUUID()}, ${config.email}, '管理员', ${adminHash}, 'administrator')
      on conflict (email) do nothing
    `
    const admins = await transaction<{ readonly id: string }[]>`
      select id from app_user where email = ${config.email} and enabled = true
      and role = 'administrator' and id <> ${config.systemActorId}
    `
    if (admins.length !== 1) throw new DeploymentIdentityConflictError()
  })
}

if (import.meta.main) {
  const run = async (): Promise<void> => {
    const config = {
      ...parseBootstrapAdministratorConfig(Bun.env),
      systemActorId: z.object({ TK_MG_SYSTEM_ACTOR_ID: z.string().uuid() }).parse(Bun.env)
        .TK_MG_SYSTEM_ACTOR_ID,
    }
    const client = postgres(config.databaseUrl, { max: 1 })
    try {
      await initializeDeploymentDatabase(client, config)
      console.log("Deployment identities ready; existing passwords preserved")
    } finally {
      await client.end()
    }
  }
  void run().catch((error: unknown) => {
    if (error instanceof DeploymentIdentityConflictError) console.error(error.message)
    else
      console.error(
        "Deployment initialization failed; check configuration and database availability",
      )
    process.exitCode = 1
  })
}
