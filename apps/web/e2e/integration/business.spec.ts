import { expect, test } from "@playwright/test"
import { z } from "zod"

const config = z
  .object({
    E2E_EMAIL: z.string().email(),
    E2E_SECOND_EMAIL: z.string().email(),
    E2E_PASSWORD: z.string(),
    E2E_AGENT_TOKEN: z.string(),
  })
  .parse(process.env)
const Box = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  externalId: z.string(),
  host: z.string(),
})
const Pointer = z.object({
  task_id: z.string().uuid(),
  checkpoint: z.object({ step_id: z.string().uuid() }),
})

test("real login, synchronized devices, account persistence and compatible Agent reports", async ({
  page,
  request,
  browser,
}) => {
  await page.goto("/operations/devices")
  await page.getByRole("textbox", { name: "邮箱" }).fill(config.E2E_EMAIL)
  await page.getByLabel("密码", { exact: true }).fill(config.E2E_PASSWORD)
  await page.getByRole("button", { name: "登录" }).click()
  await expect(page.getByText("192.0.2.20", { exact: true })).toBeVisible()
  const boxesResponse = await page.request.get("/api/devices")
  expect(boxesResponse.ok()).toBe(true)
  const box = z.array(Box).parse(await boxesResponse.json())[0]
  if (box === undefined) throw new Error("Missing synchronized box")
  const filterFixture = async () => {
    await page.getByLabel("用户名", { exact: true }).fill("integration.account")
    await page.getByRole("button", { name: "搜索", exact: true }).click()
  }
  await page.goto("/operations/accounts")
  await filterFixture()
  await expect(page.getByText("integration.account", { exact: true })).toBeVisible()
  await page.reload()
  await filterFixture()
  await expect(page.getByText("integration.account", { exact: true })).toBeVisible()
  const accountsPath = `/api/groups/${box.groupId}/operations/accounts`
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "编辑账号" })
  await editor.getByLabel("uid", { exact: true }).fill("integration-uid")
  await editor.getByLabel("备注", { exact: true }).fill("persisted-ui-note")
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes(accountsPath),
  )
  await editor.getByRole("button", { name: "确认", exact: true }).click()
  expect((await saved).ok()).toBe(true)
  await expect(editor).not.toBeVisible()
  await page.reload()
  await filterFixture()
  await page.getByRole("button", { name: "编辑", exact: true }).click()
  await expect(editor.getByLabel("备注", { exact: true })).toHaveValue("persisted-ui-note")
  await expect(editor.getByLabel("uid", { exact: true })).toHaveValue("integration-uid")
  await editor.getByRole("button", { name: "取消", exact: true }).click()
  const fixtureQuery = `${accountsPath}?query=integration.account&pageSize=100`
  const result = await page.request.get(fixtureQuery)
  const accounts = z
    .object({ items: z.array(z.object({ id: z.string().uuid(), identifier: z.string() })) })
    .parse(await result.json())
  const account = accounts.items.find((item) => item.identifier === "integration.account")
  if (account === undefined) throw new Error("Missing account fixture")
  const update = await page.request.patch(`${accountsPath}/${account.id}`, {
    data: { note: "persisted-browser-note", tags: ["integration", "browser"] },
  })
  expect(update.ok()).toBe(true)
  expect(await (await page.request.get(fixtureQuery)).json()).toMatchObject({
    items: [
      expect.objectContaining({
        id: account.id,
        note: "persisted-browser-note",
        tags: ["integration", "browser"],
      }),
    ],
  })
  const agentHeaders = { authorization: `Bearer ${config.E2E_AGENT_TOKEN}` }
  expect(
    (
      await request.post("/agent/register", {
        headers: agentHeaders,
        data: { boxId: box.externalId, version: "protocol-fixture" },
      })
    ).ok(),
  ).toBe(true)
  expect(
    (
      await request.post("/agent/heartbeat", {
        headers: agentHeaders,
        data: {
          boxId: box.externalId,
          slots: [
            { boxIp: box.host, indexNum: 1, status: "running", width: "720", height: "1280" },
          ],
        },
      })
    ).ok(),
  ).toBe(true)
  const submitted = await page.request.post("/api/tasks", {
    headers: { "idempotency-key": crypto.randomUUID() },
    data: { deviceId: box.id, indexNum: 1, steps: [{ skill: "DumpNodeXmlEx", input: {} }] },
  })
  expect(submitted.status()).toBe(201)
  const pointer = Pointer.parse(
    await (
      await request.post(`/agent/tasks/claim?boxId=${box.externalId}&wait=0`, {
        headers: agentHeaders,
      })
    ).json(),
  )
  const report = {
    status: "succeeded",
    checkpoint: { step_id: pointer.checkpoint.step_id, outputs: { xml: "<node/>" } },
  }
  expect(
    (
      await request.post(`/agent/tasks/${pointer.task_id}/status`, {
        headers: agentHeaders,
        data: report,
      })
    ).ok(),
  ).toBe(true)
  expect(
    (
      await request.post(`/agent/tasks/${pointer.task_id}/status`, {
        headers: agentHeaders,
        data: report,
      })
    ).ok(),
  ).toBe(true)
  expect(await (await page.request.get(`/api/tasks/${pointer.task_id}`)).json()).toMatchObject({
    status: "succeeded",
  })
  const other = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    ignoreHTTPSErrors: true,
  })
  try {
    expect(
      (
        await other.request.post("/api/auth/login", {
          data: { email: config.E2E_SECOND_EMAIL, password: config.E2E_PASSWORD },
        })
      ).ok(),
    ).toBe(true)
    expect(await (await other.request.get("/api/devices")).json()).toEqual([])
    expect((await other.request.get(accountsPath)).status()).toBe(404)
    expect((await other.request.get(`/api/tasks/${pointer.task_id}`)).status()).toBe(404)
  } finally {
    await other.close()
  }
  await page.screenshot({ path: "test-results/integration/business-desktop.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/operations/devices")
  await expect(page.getByText("192.0.2.20", { exact: true })).toBeVisible()
  await page.screenshot({ path: "test-results/integration/business-mobile.png", fullPage: true })
})
