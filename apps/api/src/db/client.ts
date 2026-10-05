import postgres from "postgres"

export const createSqlClient = (databaseUrl: string) =>
  postgres(databaseUrl, {
    max: 10,
  })
