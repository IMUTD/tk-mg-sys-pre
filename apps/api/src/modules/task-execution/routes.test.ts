import { describe, expect, it } from "bun:test"
import {
  type ExecutionTaskRepository,
  TaskIdempotencyConflictError,
  type TaskRecord,
} from "@tk-mg/task-execution"
import { z } from "zod"
import { createApp } from "../../app"
import { GroupIdSchema, Permission, Role } from "../../lib/authorization"
import type { PageAccess } from "../../lib/pages"
import { PageKey } from "../../lib/pages"
import { createInMemoryAuditRepository } from "../audit/service"
import { createAuthService, createInMemoryAuthRepository } from "../auth/service"
import { createInMemoryDeviceRepository } from "../devices/in-memory-repository"
import { type Device, DeviceIdSchema, DeviceInstanceIdSchema } from "../devices/repository"
import { createTaskExecutionService } from "./service"

const groupId = "11111111-1111-4111-8111-111111111111"
const otherGroup = "22222222-2222-4222-8222-222222222222"
const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const instanceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const unknownInstanceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const userId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const taskId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const commandTarget = { deviceId: DeviceIdSchema.parse(deviceId) }
const device: Device = {
  bridge: false,
  createdAt: new Date(),
  enabled: true,
  groupId: GroupIdSchema.parse(groupId),
  host: "localhost",
  id: DeviceIdSchema.parse(deviceId),
  instances: [
    {
      createdAt: new Date(),
      deviceId: DeviceIdSchema.parse(deviceId),
      enabled: true,
      id: DeviceInstanceIdSchema.parse(instanceId),
      index: 0,
      label: "test instance",
      lastHealthAt: null,
      lastHealthFailure: null,
      lastPlaybackDiagnostic: null,
      status: "unknown",
      updatedAt: new Date(),
    },
  ],
  lastHealthAt: null,
  lastHealthFailure: null,
  model: "test",
  name: "test",
  resourceCount: 0,
  status: "unknown",
  updatedAt: new Date(),
  version: null,
}

const fixture = (
  permissions: readonly Permission[] = [Permission.OperationsRead, Permission.OperationsWrite],
  pages: readonly PageAccess[] = [
    { key: PageKey.Tasks, canView: true, canDelete: true },
    { key: PageKey.TaskRecords, canView: true, canDelete: true },
  ],
  role: Role = Role.Operator,
) => {
  const audit = createInMemoryAuditRepository()
  const records = new Map<string, TaskRecord>()
  const keys = new Map<string, string>()
  const repository: Pick<
    ExecutionTaskRepository,
    "submit" | "get" | "list" | "requestCancel" | "reconcile"
  > = {
    reconcile: async (input) => {
      const task = records.get(input.taskId)
      if (task === undefined || task.groupId !== input.groupId) return "not_found"
      if (task.state === input.resolution) return "duplicate"
      if (task.state !== "needs_reconciliation") return "conflict"
      records.set(input.taskId, { ...task, state: input.resolution })
      return "resolved"
    },
    submit: async (input, actor) => {
      const existingId = keys.get(`${input.groupId}:${input.idempotencyKey}`)
      const existing = existingId === undefined ? undefined : records.get(existingId)
      if (existing !== undefined) {
        if (input.fingerprint !== existing.actor.requestId) throw new TaskIdempotencyConflictError()
        return { task: existing, created: false }
      }
      const task: TaskRecord = {
        taskId: input.taskId,
        groupId: input.groupId,
        target: input.steps[0]?.command.target ?? commandTarget,
        state: "queued",
        attempt: 0,
        maxAttempts: input.maxAttempts,
        steps: input.steps.map((step) => ({
          stepId: step.stepId,
          taskId: input.taskId,
          ordinal: step.sequence,
          command: step.command,
          state: "pending",
          attempt: 0,
        })),
        actor: { ...actor, requestId: input.fingerprint },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      records.set(task.taskId, task)
      keys.set(`${input.groupId}:${input.idempotencyKey}`, task.taskId)
      return { task, created: true }
    },
    get: async (requestedGroup, taskId) => {
      const task = records.get(taskId)
      return task?.target.deviceId === deviceId && requestedGroup === groupId ? task : null
    },
    list: async (requestedGroup, page, pageSize) => ({
      items: requestedGroup === groupId ? [...records.values()] : [],
      total: records.size,
      page,
      pageSize,
    }),
    requestCancel: async (requestedGroup, taskId) => {
      const task = records.get(taskId)
      if (task === undefined || requestedGroup !== groupId) return false
      records.set(taskId, { ...task, state: "cancelled", updatedAt: Date.now() })
      return true
    },
  }
  const service = createTaskExecutionService({
    repository,
    deviceRepository: createInMemoryDeviceRepository([device]),
  })
  const auth = createAuthService(
    createInMemoryAuthRepository([
      {
        email: "operator@example.com",
        groupIds: [groupId],
        id: userId,
        password: "password",
        permissions,
        role,
        pages,
      },
    ]),
    async (password, hash) => password === hash,
  )
  const app = createApp({
    authService: auth,
    auditRepository: audit,
    taskExecutionService: service,
  })
  return {
    app,
    audit,
    records,
    login: async () =>
      (
        await app.request("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: "operator@example.com", password: "password" }),
        })
      ).headers.get("set-cookie") ?? "",
  }
}

const body = {
  name: "test task",
  executorKey: "device-command",
  steps: [{ type: "health_check", target: commandTarget }],
}

const endpoints = [
  { name: "submit", method: "POST", suffix: "", action: "execution.task.submit", allowed: 202 },
  { name: "list", method: "GET", suffix: "", action: "execution.task.list", allowed: 200 },
  {
    name: "detail",
    method: "GET",
    suffix: `/${taskId}`,
    action: "execution.task.detail",
    allowed: 200,
  },
  {
    name: "cancel",
    method: "POST",
    suffix: `/${taskId}/cancel`,
    action: "execution.task.cancel",
    allowed: 200,
  },
] as const

const pageCases = [
  {
    name: "Tasks",
    pages: [{ key: PageKey.Tasks, canView: true, canDelete: false }],
    allowed: true,
  },
  {
    name: "Proxies",
    pages: [{ key: PageKey.Proxies, canView: true, canDelete: false }],
    allowed: false,
  },
  {
    name: "TaskRecords",
    pages: [{ key: PageKey.TaskRecords, canView: true, canDelete: false }],
    allowed: false,
  },
  {
    name: "Tasks without view plus Proxies",
    pages: [
      { key: PageKey.Tasks, canView: false, canDelete: false },
      { key: PageKey.Proxies, canView: true, canDelete: false },
    ],
    allowed: false,
  },
  { name: "no pages", pages: [], allowed: false },
] as const

const seededTask = (): TaskRecord => ({
  taskId,
  groupId: GroupIdSchema.parse(groupId),
  target: commandTarget,
  state: "queued",
  attempt: 0,
  maxAttempts: 1,
  steps: [],
  actor: { actorId: userId, actorType: "user", requestId: "seed" },
  createdAt: 1,
  updatedAt: 1,
})

const requestEndpoint = (
  app: ReturnType<typeof fixture>["app"],
  cookie: string,
  endpoint: (typeof endpoints)[number],
  targetGroup: string = groupId,
) =>
  app.request(`/api/groups/${targetGroup}/tasks${endpoint.suffix}`, {
    method: endpoint.method,
    headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "matrix" },
    ...(endpoint.name === "submit" ? { body: JSON.stringify(body) } : {}),
  })

describe("task execution routes", () => {
  it("reconciles through Hono with duplicate and conflicting resolutions", async () => {
    const { app, login, records } = fixture(undefined, undefined, Role.Administrator)
    records.set(taskId, { ...seededTask(), state: "needs_reconciliation" })
    const cookie = await login()
    const request = (resolution: string, group = groupId) =>
      app.request(`/api/groups/${group}/tasks/${taskId}/reconcile`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ resolution, evidenceRef: "CASE_6" }),
      })
    expect((await request("succeeded", otherGroup)).status).toBe(404)
    expect((await request("succeeded")).status).toBe(200)
    expect((await request("succeeded")).status).toBe(200)
    expect((await request("failed")).status).toBe(409)
  })
  for (const missing of ["permission", "page"] as const) {
    it(`denies administrator reconciliation without explicit ${missing}`, async () => {
      const { app, login } = fixture(
        missing === "permission" ? [] : undefined,
        missing === "page" ? [] : undefined,
        Role.Administrator,
      )
      const response = await app.request(`/api/groups/${groupId}/tasks/${taskId}/reconcile`, {
        method: "POST",
        headers: { Cookie: await login(), "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "succeeded", evidenceRef: "CASE_6" }),
      })
      expect(response.status).toBe(403)
    })
  }
  it("denies reconciliation to nonadministrators and audits the denial", async () => {
    const { app, login, audit } = fixture()
    const response = await app.request(`/api/groups/${groupId}/tasks/${taskId}/reconcile`, {
      method: "POST",
      headers: { Cookie: await login(), "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: "succeeded", evidenceRef: "CASE_6" }),
    })
    expect(response.status).toBe(403)
    expect(audit.all()).toContainEqual(
      expect.objectContaining({
        action: "execution.task.reconcile",
        outcome: "denied",
        actorId: userId,
      }),
    )
  })
  for (const evidenceRef of ["", "a".repeat(65), "receipt/private", "汉字", "a\n"]) {
    it(`rejects malformed reconciliation evidence ${JSON.stringify(evidenceRef)}`, async () => {
      const { app, login } = fixture(undefined, undefined, Role.Administrator)
      const response = await app.request(`/api/groups/${groupId}/tasks/${taskId}/reconcile`, {
        method: "POST",
        headers: { Cookie: await login(), "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: "succeeded", evidenceRef }),
      })
      expect(response.status).toBe(400)
    })
  }
  for (const pageCase of pageCases) {
    for (const endpoint of endpoints) {
      it(`${pageCase.name} ${endpoint.name} requires the exact Tasks page`, async () => {
        const { app, audit, login, records } = fixture(undefined, pageCase.pages)
        records.set(taskId, seededTask())
        const cookie = await login()

        const response = await requestEndpoint(app, cookie, endpoint)

        expect(response.status).toBe(pageCase.allowed ? endpoint.allowed : 403)
        expect(audit.all()).toEqual(
          pageCase.allowed
            ? []
            : [
                expect.objectContaining({
                  action: endpoint.action,
                  actorId: userId,
                  outcome: "denied",
                  target: `group:${groupId}`,
                }),
              ],
        )
        if (!pageCase.allowed) expect(records.size).toBe(1)
      })
    }
  }

  for (const endpoint of endpoints) {
    it(`${endpoint.name} hides another group before checking pages`, async () => {
      const { app, audit, login, records } = fixture(undefined, [])
      records.set(taskId, seededTask())
      const cookie = await login()

      const response = await requestEndpoint(app, cookie, endpoint, otherGroup)

      expect(response.status).toBe(404)
      expect(audit.all()).toEqual([
        expect.objectContaining({
          action: endpoint.action,
          actorId: userId,
          outcome: "denied",
          target: `group:${otherGroup}`,
        }),
      ])
      expect(records.size).toBe(1)
    })

    it(`${endpoint.name} rejects malformed group IDs with a denied audit`, async () => {
      const { app, audit, login } = fixture()
      const cookie = await login()

      const response = await requestEndpoint(app, cookie, endpoint, "invalid-group")

      expect(response.status).toBe(404)
      expect(audit.all()).toEqual([
        expect.objectContaining({
          action: endpoint.action,
          actorId: userId,
          outcome: "denied",
          target: "group:invalid-group",
        }),
      ])
    })
  }

  for (const endpoint of endpoints.filter((item) => item.method === "POST")) {
    it(`read-only Tasks user cannot ${endpoint.name}`, async () => {
      const { app, audit, login, records } = fixture([Permission.OperationsRead])
      records.set(taskId, seededTask())
      const cookie = await login()

      const response = await requestEndpoint(app, cookie, endpoint)

      expect(response.status).toBe(403)
      expect(audit.all()).toEqual([
        expect.objectContaining({
          action: endpoint.action,
          actorId: userId,
          outcome: "denied",
          target: `group:${groupId}`,
        }),
      ])
      expect(records.get(taskId)?.state).toBe("queued")
    })
  }

  for (const endpoint of endpoints.filter((item) => item.method === "GET")) {
    it(`read-only Tasks user can ${endpoint.name}`, async () => {
      const { app, login, records } = fixture([Permission.OperationsRead], pageCases[0].pages)
      records.set(taskId, seededTask())
      const cookie = await login()

      const response = await requestEndpoint(app, cookie, endpoint)

      expect(response.status).toBe(200)
    })

    it(`write-only Tasks user cannot ${endpoint.name}`, async () => {
      const { app, audit, login, records } = fixture(
        [Permission.OperationsWrite],
        pageCases[0].pages,
      )
      records.set(taskId, seededTask())
      const cookie = await login()

      const response = await requestEndpoint(app, cookie, endpoint)

      expect(response.status).toBe(403)
      expect(audit.all()).toEqual([
        expect.objectContaining({
          action: endpoint.action,
          actorId: userId,
          outcome: "denied",
          target: `group:${groupId}`,
        }),
      ])
    })
  }

  for (const endpoint of endpoints.filter(
    (item) => item.name === "detail" || item.name === "cancel",
  )) {
    it(`${endpoint.name} hides a malformed task ID`, async () => {
      const { app, login } = fixture()
      const cookie = await login()

      const response = await app.request(
        `/api/groups/${groupId}/tasks/not-a-uuid${endpoint.name === "cancel" ? "/cancel" : ""}`,
        {
          method: endpoint.method,
          headers: { Cookie: cookie },
        },
      )

      expect(response.status).toBe(404)
    })
  }

  it("Tasks user receives 400 for malformed submit body", async () => {
    const { app, login, records } = fixture(undefined, pageCases[0].pages)
    const cookie = await login()

    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "bad" },
      body: "{",
    })

    expect(response.status).toBe(400)
    expect(records.size).toBe(0)
  })

  it("unauthenticated task list returns 401 without a denied audit", async () => {
    const { app, audit } = fixture()

    const response = await app.request(`/api/groups/${groupId}/tasks`)

    expect(response.status).toBe(401)
    expect(audit.all()).toEqual([])
  })

  it("characterizes device-command auth denial status and audit shape", async () => {
    const { app, audit, login } = fixture([Permission.OperationsRead])
    const cookie = await login()
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "key" },
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(403)
    expect(audit.all()).toContainEqual(
      expect.objectContaining({ action: "execution.task.submit", outcome: "denied" }),
    )
  })

  it("submits with 202 and replays with 200 for omitted and empty parameters", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const headers = { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "key" }
    const first = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    const replay = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, parameters: {} }),
    })
    expect(first.status).toBe(202)
    expect(replay.status).toBe(200)
    expect(records.size).toBe(1)
  })

  it("rejects non-empty parameters before persistence without echoing nested secrets", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "secret" },
      body: JSON.stringify({
        ...body,
        parameters: { nested: { privateKey: "private-key-value", cookie: "cookie-value" } },
      }),
    })
    const responseText = await response.text()
    expect(response.status).toBe(400)
    expect(responseText).not.toMatch(/private-key-value|cookie-value/)
    expect(records.size).toBe(0)
  })

  it("rejects an unknown executor before persistence", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "executor",
      },
      body: JSON.stringify({ ...body, executorKey: "unknown-executor" }),
    })
    expect(response.status).toBe(400)
    expect(records.size).toBe(0)
  })

  it("rejects mixed device-instance target presence before persistence", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "target" },
      body: JSON.stringify({
        ...body,
        steps: [
          { type: "health_check", target: commandTarget },
          { type: "capture_screen", target: { ...commandTarget, instanceId } },
        ],
      }),
    })
    expect(response.status).toBe(400)
    expect(records.size).toBe(0)
  })

  it("rejects an unknown target field and unknown instance before persistence", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const invalidTarget = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "target-field",
      },
      body: JSON.stringify({
        ...body,
        steps: [{ type: "health_check", target: { ...commandTarget, privateKey: "raw-secret" } }],
      }),
    })
    const unknownInstance = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "target-instance",
      },
      body: JSON.stringify({
        ...body,
        steps: [
          { type: "health_check", target: { ...commandTarget, instanceId: unknownInstanceId } },
        ],
      }),
    })
    expect(invalidTarget.status).toBe(400)
    expect(unknownInstance.status).toBe(400)
    expect(records.size).toBe(0)
  })

  it("rejects unsupported commands before persistence", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "unsupported",
      },
      body: JSON.stringify({
        ...body,
        steps: [{ type: "unsupported_command", target: commandTarget }],
      }),
    })
    expect(response.status).toBe(400)
    expect(records.size).toBe(0)
  })

  it("excludes stored provider result and error fields from the task detail DTO", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const created = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "Idempotency-Key": "provider-secret",
      },
      body: JSON.stringify(body),
    })
    const submitted = z.object({ taskId: z.string() }).parse(await created.json())
    const task = records.get(submitted.taskId)
    if (task === undefined) throw new Error("task missing")
    records.set(task.taskId, {
      ...task,
      steps: task.steps.map((step) => ({
        ...step,
        result: {
          commandId: step.command.commandId,
          status: "failed" as const,
          retryable: false,
          error: { code: "failed" as const, message: "Bearer raw-provider-secret" },
          nested: { password: "nested-password", authorization: "nested-auth" },
        },
        errorMessage: "Bearer raw-provider-secret",
      })),
    })

    const detail = await app.request(`/api/groups/${groupId}/tasks/${task.taskId}`, {
      headers: { Cookie: cookie },
    })

    const detailText = await detail.text()
    expect(detail.status).toBe(200)
    expect(JSON.parse(detailText)).toEqual(
      expect.objectContaining({
        taskId: task.taskId,
        steps: [expect.objectContaining({ kind: "health_check", state: "pending" })],
      }),
    )
    expect(detailText).not.toMatch(/nested-password|nested-auth|raw-provider-secret/)
  })

  it("rejects input_text without persistence and hides a task from another group", async () => {
    const { app, login, records } = fixture()
    const cookie = await login()
    const rejected = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", "Idempotency-Key": "input" },
      body: JSON.stringify({
        ...body,
        steps: [{ type: "input_text", target: commandTarget, text: "secret" }],
      }),
    })
    const hidden = await app.request(`/api/groups/${otherGroup}/tasks/not-a-task`, {
      headers: { Cookie: cookie },
    })
    expect(rejected.status).toBe(400)
    expect(records.size).toBe(0)
    expect(hidden.status).toBe(404)
  })

  it("returns 409 when an idempotency key is reused for changed input", async () => {
    const { app, login } = fixture()
    const cookie = await login()
    const headers = {
      Cookie: cookie,
      "Content-Type": "application/json",
      "Idempotency-Key": "conflict",
    }
    await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    const response = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, name: "changed" }),
    })
    expect(response.status).toBe(409)
  })

  it("lists, retrieves, and cancels a group task", async () => {
    const { app, login } = fixture()
    const cookie = await login()
    const headers = {
      Cookie: cookie,
      "Content-Type": "application/json",
      "Idempotency-Key": "lifecycle",
    }
    const created = await app.request(`/api/groups/${groupId}/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    const taskId = z.object({ taskId: z.string().uuid() }).parse(await created.json()).taskId
    const listed = await app.request(`/api/groups/${groupId}/tasks`, {
      headers: { Cookie: cookie },
    })
    const detail = await app.request(`/api/groups/${groupId}/tasks/${taskId}`, {
      headers: { Cookie: cookie },
    })
    const cancelled = await app.request(`/api/groups/${groupId}/tasks/${taskId}/cancel`, {
      method: "POST",
      headers: { Cookie: cookie },
    })
    expect(listed.status).toBe(200)
    expect(detail.status).toBe(200)
    expect(cancelled.status).toBe(200)
    expect(z.object({ state: z.string() }).parse(await cancelled.json()).state).toBe("cancelled")
  })
})
