import type { Sql, TransactionSql } from "postgres"

type Fragment = ReturnType<Sql>

// Testing phase: only these hosts are held to their paid time. "*" holds every box.
const limitedHosts = (): readonly string[] | "all" => {
  const raw = (process.env["BOX_SERVICE_LIMITED_HOSTS"] ?? "192.168.76.166").trim()
  if (raw === "*") return "all"
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "")
}

export const isLimitedHost = (host: string): boolean => {
  const hosts = limitedHosts()
  return hosts === "all" || hosts.includes(host)
}

// True when the box may take new tasks: either it is not limited yet or it has paid time left.
export const serviceActive = (
  db: Sql | TransactionSql,
  until: Fragment,
  host: Fragment,
): Fragment => {
  const hosts = limitedHosts()
  if (hosts === "all") return db`coalesce(${until} > now(), false)`
  return db`(not (${host} = any(${[...hosts]}::text[])) or coalesce(${until} > now(), false))`
}

// Thrown when a task targets a box without paid time left; routes answer `service_expired`.
export class ServiceExpiredError extends Error {
  override readonly name = "ServiceExpiredError"
}
