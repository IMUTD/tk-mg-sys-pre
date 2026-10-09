import { readFileSync } from "node:fs"

const [path, ...command] = process.argv.slice(2)
if (path === undefined || command.length === 0) throw new Error("Provide fixture file and command")
const data: unknown = JSON.parse(readFileSync(path, "utf8"))
if (
  data === null ||
  typeof data !== "object" ||
  Array.isArray(data) ||
  Object.values(data).some((value) => typeof value !== "string")
) {
  throw new Error("Invalid integration environment")
}
const environment = data as Record<string, string>
const child = Bun.spawn(command, {
  env: { ...Bun.env, ...environment },
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
})
const terminate = () => child.kill("SIGTERM")
process.once("SIGTERM", terminate)
process.once("SIGINT", terminate)
process.exitCode = await child.exited
