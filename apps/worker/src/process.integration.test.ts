// biome-ignore-all lint/complexity/useLiteralKeys: Bun.env is index-signature typed.
import { expect, it } from "bun:test"
import { watch } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import postgres from "postgres"
import { startWorker } from "./main"

const awaitEvent = async (path: string, event: string): Promise<void> => {
  const ready = Promise.withResolvers<void>()
  const observer = watch(path, () => {
    void readFile(path, "utf8").then((text) => {
      if (text.split("\n").includes(event)) ready.resolve()
    }, ready.reject)
  })
  const timeout = setTimeout(() => ready.reject(new Error(`Missing child event: ${event}`)), 8_000)
  try {
    if ((await readFile(path, "utf8")).split("\n").includes(event)) return
    await ready.promise
  } finally {
    clearTimeout(timeout)
    observer.close()
  }
}

for (const failRenewal of [false, true]) {
  it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
    `stops a real worker child during ${failRenewal ? "lost renewal" : "SIGTERM poll"} without stale ack`,
    async () => {
      const url = Bun.env["TEST_DATABASE_URL"]
      if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_")) {
        throw new Error("A disposable tk_mg_test_* database is required")
      }
      const client = postgres(url, { max: 1 })
      const actorId = crypto.randomUUID()
      const directory = await mkdtemp(join(tmpdir(), "tk-mg-worker-ownership-"))
      const healthFile = join(directory, "health")
      const eventsFile = join(directory, "events")
      let child: ReturnType<typeof Bun.spawn> | undefined
      try {
        await Bun.write(eventsFile, "")
        await client`insert into app_user (id, email, password_hash, role, enabled)
          values (${actorId}, ${`worker-ownership-${actorId}@example.test`}, 'test', 'administrator', false)`
        child = Bun.spawn([process.execPath, "src/fixtures/ownership-child.ts"], {
          cwd: join(import.meta.dir, ".."),
          env: {
            ...process.env,
            DATABASE_URL: url,
            TK_MG_SYSTEM_ACTOR_ID: actorId,
            TK_MG_WORKER_ID: `ownership-${actorId}`,
            TK_MG_WORKER_POLL_INTERVAL_MS: "50",
            TK_MG_WORKER_HEARTBEAT_MS: "250",
            TK_MG_WORKER_EVENT_FILE: eventsFile,
            TK_MG_WORKER_INJECT_RENEW_FAILURE: String(failRenewal),
            TK_MG_WORKER_HEALTH_FILE: healthFile,
          },
          stdin: "pipe",
          stdout: "ignore",
          stderr: "pipe",
        })
        await awaitEvent(eventsFile, failRenewal ? "renew-task" : "poll")
        if (!failRenewal) {
          if (child.stdin === undefined || typeof child.stdin === "number")
            throw new Error("Expected child stdin pipe")
          child.stdin.end()
        }
        const timeout = setTimeout(() => child?.kill(), 8_000)
        try {
          expect(await child.exited).toBe(failRenewal ? 1 : 0)
        } finally {
          clearTimeout(timeout)
        }
        const events = (await readFile(eventsFile, "utf8")).trim().split("\n")
        expect(events.filter((event) => event === "submit")).toHaveLength(1)
        expect(events).toContain("marker")
        if (!failRenewal) expect(events).toContain("quarantine")
        expect(events).not.toContain("ack")
        expect(events).not.toContain("fail")
        expect(await readFile(healthFile, "utf8")).toBe(failRenewal ? "failed\n" : "stopped\n")
        const probe = Bun.spawn([process.execPath, "src/health-check.ts"], {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env, TK_MG_WORKER_HEALTH_FILE: healthFile },
          stdout: "ignore",
          stderr: "ignore",
        })
        expect(await probe.exited).toBe(1)
      } finally {
        child?.kill()
        if (child !== undefined) await child.exited
        try {
          await client`delete from app_user where id = ${actorId}`
        } finally {
          await client.end()
          await rm(directory, { recursive: true, force: true })
        }
      }
    },
  )
}

it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
  "exits nonzero and fails the Compose health probe after a fatal worker cycle",
  async () => {
    const url = Bun.env["TEST_DATABASE_URL"]
    if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_")) {
      throw new Error("A disposable tk_mg_test_* database is required")
    }
    const client = postgres(url, { max: 1 })
    const actorId = crypto.randomUUID()
    const directory = await mkdtemp(join(tmpdir(), "tk-mg-worker-process-"))
    const healthFile = join(directory, "health")
    let child: ReturnType<typeof Bun.spawn> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await client`insert into app_user (id, email, password_hash, role, enabled)
        values (${actorId}, ${`worker-process-${actorId}@example.test`}, 'test', 'administrator', false)`
      await Bun.write(healthFile, "ready\n")
      const healthyProbe = Bun.spawn([process.execPath, "src/health-check.ts"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, TK_MG_WORKER_HEALTH_FILE: healthFile },
        stdout: "ignore",
        stderr: "ignore",
      })
      expect(await healthyProbe.exited).toBe(0)
      child = Bun.spawn([process.execPath, "src/fixtures/fatal-cycle-child.ts"], {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          DATABASE_URL: url,
          TK_MG_SYSTEM_ACTOR_ID: actorId,
          TK_MG_WORKER_ID: `worker-process-${actorId}`,
          TK_MG_WORKER_POLL_INTERVAL_MS: "50",
          TK_MG_WORKER_HEALTH_FILE: healthFile,
        },
        stdout: "ignore",
        stderr: "pipe",
      })
      timeout = setTimeout(() => child?.kill(), 8_000)
      expect(await child.exited).toBe(1)
      if (!(child.stderr instanceof ReadableStream)) throw new Error("Expected worker stderr pipe")
      expect(await new Response(child.stderr).text()).toContain("Isolated fatal worker cycle")
      expect(await readFile(healthFile, "utf8")).toBe("failed\n")

      const probe = Bun.spawn([process.execPath, "src/health-check.ts"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, TK_MG_WORKER_HEALTH_FILE: healthFile },
        stdout: "ignore",
        stderr: "ignore",
      })
      expect(await probe.exited).toBe(1)
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      child?.kill()
      if (child !== undefined) await child.exited
      try {
        await client`delete from app_user where id = ${actorId}`
      } finally {
        await client.end()
        await rm(directory, { recursive: true, force: true })
      }
    }
  },
)

it.skipIf(Bun.env["TEST_DATABASE_URL"] === undefined)(
  "closes its SQL client when startup rejects a missing system actor",
  async () => {
    const url = Bun.env["TEST_DATABASE_URL"]
    if (url === undefined || !new URL(url).pathname.slice(1).startsWith("tk_mg_test_")) {
      throw new Error("A disposable tk_mg_test_* database is required")
    }
    const observer = postgres(url, { max: 1 })
    const applicationName = `worker-readiness-${crypto.randomUUID()}`
    const workerUrl = new URL(url)
    workerUrl.searchParams.set("application_name", applicationName)
    const directory = await mkdtemp(join(tmpdir(), "tk-mg-worker-startup-"))
    const sessionsBeforeClose: number[] = []
    try {
      const failure = await startWorker(
        {
          DATABASE_URL: workerUrl.toString(),
          TK_MG_SYSTEM_ACTOR_ID: crypto.randomUUID(),
          TK_MG_WORKER_ID: applicationName,
          TK_MG_WORKER_HEALTH_FILE: join(directory, "health"),
        },
        async (path, contents) => {
          await Bun.write(path, contents)
          if (contents === "failed\n") {
            const sessions = await observer<{ readonly count: number }[]>`
              select count(*)::int as count from pg_stat_activity
              where application_name = ${applicationName}
            `
            sessionsBeforeClose.push(sessions[0]?.count ?? 0)
          }
        },
      ).then(
        () => undefined,
        (error: unknown) => error,
      )
      expect(failure).toHaveProperty(
        "message",
        "Configured system actor must be an existing disabled administrator",
      )
      expect(sessionsBeforeClose).toEqual([1])
      const connections = await observer<{ readonly count: number }[]>`
        select count(*)::int as count from pg_stat_activity where application_name = ${applicationName}
      `
      expect(connections[0]?.count).toBe(0)
      expect(await readFile(join(directory, "health"), "utf8")).toBe("failed\n")
    } finally {
      await observer.end()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
