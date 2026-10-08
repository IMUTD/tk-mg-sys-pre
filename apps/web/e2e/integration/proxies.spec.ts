import { expect, test } from "@playwright/test"
import { z } from "zod"

const config = z
  .object({
    E2E_EMAIL: z.string(),
    E2E_PASSWORD: z.string(),
    E2E_SECOND_EMAIL: z.string(),
  })
  .parse(process.env)
const ProxyRecord = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
  note: z.string(),
  configuration: z.object({ protocol: z.string(), turbo: z.boolean() }),
  checkResult: z
    .object({
      ok: z.boolean(),
      message: z.string(),
      detection_type: z.string().optional(),
      connectivity_checked: z.boolean().optional(),
    })
    .nullable(),
})

test("new public IP record is queried automatically without connecting to its unusable port", async ({
  page,
}) => {
  test.setTimeout(60000)
  await page.goto("/operations/proxies")
  await page.getByRole("textbox", { name: "邮箱" }).fill(config.E2E_EMAIL)
  await page.getByLabel("密码", { exact: true }).fill(config.E2E_PASSWORD)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("button", { name: "新增", exact: true })).toBeEnabled()
  const session = z
    .object({
      user: z.object({ scope: z.object({ groupIds: z.array(z.string().uuid()) }) }),
    })
    .parse(await (await page.request.get("/api/auth/session")).json())
  const groupId = session.user.scope.groupIds[0]
  if (groupId === undefined) throw new Error("Missing proxy group")
  const path = `/api/groups/${groupId}/operations/proxies`
  const note = `e2e-ip-lookup-${Date.now()}`
  let createdId: string | undefined
  try {
    await page.getByRole("button", { name: "新增", exact: true }).click()
    const form = page.getByRole("dialog").filter({ hasText: "新增代理" })
    await form.getByText("HTTP", { exact: true }).click()
    await form.getByLabel("IP", { exact: true }).fill("8.8.8.8")
    await form.getByLabel("端口", { exact: true }).fill("1")
    await form.getByLabel("备注", { exact: true }).fill(note)
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "POST",
    )
    const lookedUp = page.waitForResponse(
      (response) => response.url().endsWith("/detect") && response.request().method() === "POST",
    )
    await form.getByRole("button", { name: "确认", exact: true }).click()
    const savedResponse = await saved
    expect(savedResponse.status()).toBe(201)
    createdId = ProxyRecord.parse(await savedResponse.json()).id
    const response = await lookedUp
    expect(response.status()).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      target_ip: "8.8.8.8",
      detection_type: "ip_lookup",
      connectivity_checked: false,
      use_turbo: false,
      results: [{ response_body: { ip: "8.8.8.8" } }],
    })
    await expect(form).not.toBeVisible()
    await page.reload()
    const row = page.getByRole("row").filter({ hasText: note })
    await expect(row).toContainText("8.8.8.8:1")
    await expect(row).toContainText("成功")
    const listed = z
      .object({ items: z.array(ProxyRecord) })
      .parse(await (await page.request.get(`${path}?pageSize=100`)).json())
    expect(listed.items.find((item) => item.id === createdId)?.checkResult).toMatchObject({
      ok: true,
      detection_type: "ip_lookup",
      connectivity_checked: false,
    })
    await row.getByRole("button", { name: "查看", exact: true }).click()
    const details = page.getByRole("dialog").filter({ hasText: "检测结果[" })
    await expect(details.getByText("IP 信息查询", { exact: true })).toBeVisible()
    await expect(details.getByText("未检测", { exact: true })).toBeVisible()
    await page.screenshot({
      path: "test-results/integration/ip-lookup-desktop.png",
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    expect((await details.boundingBox())?.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: "test-results/integration/ip-lookup-mobile.png", fullPage: true })
  } finally {
    if (createdId !== undefined)
      expect(
        (
          await page.request.post(`${path}/batch/delete`, {
            data: { ids: [createdId] },
          })
        ).ok(),
      ).toBe(true)
  }
})
test.use({ actionTimeout: 15000 })
test("real proxy form, database persistence, safe detection failure and administrator isolation", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000)
  await page.goto("/operations/proxies")
  await page.getByRole("textbox", { name: "邮箱" }).fill(config.E2E_EMAIL)
  await page.getByLabel("密码", { exact: true }).fill(config.E2E_PASSWORD)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByRole("button", { name: "新增", exact: true })).toBeEnabled()
  const session = z
    .object({
      user: z.object({ scope: z.object({ groupIds: z.array(z.string().uuid()) }) }),
    })
    .parse(await (await page.request.get("/api/auth/session")).json())
  const groupId = session.user.scope.groupIds[0]
  if (groupId === undefined) throw new Error("Missing proxy group")
  const path = `/api/groups/${groupId}/operations/proxies`
  const note = `e2e-proxy-${Date.now()}`
  const refreshUrl = "https://refresh.example.test/?token=e2e-private-refresh"
  let createdId: string | undefined
  try {
    await page.goto("/operations/proxies")
    await page.getByRole("button", { name: "新增", exact: true }).click()
    const form = page.getByRole("dialog").filter({ hasText: "新增代理" })
    await form.getByText("HTTP", { exact: true }).click()
    await expect(form.getByRole("radio", { name: "HTTP", exact: true })).toBeChecked()
    await form.getByLabel("IP", { exact: true }).fill("127.0.0.1")
    await form.getByLabel("端口", { exact: true }).fill("8080")
    await form.getByLabel("备注", { exact: true }).fill(note)
    await form.getByLabel("刷新URL", { exact: true }).fill(refreshUrl)
    await form.getByRole("switch", { name: "加速节点", exact: true }).check()
    await page.screenshot({ path: "test-results/integration/proxies-form-desktop.png" })
    const desktopViewport = page.viewportSize()
    await page.setViewportSize({ width: 390, height: 844 })
    expect((await form.boundingBox())?.width).toBeLessThanOrEqual(390)
    for (const element of [
      form.getByText("新增代理", { exact: true }),
      form.getByRole("button", { name: "确认", exact: true }),
    ]) {
      const bounds = await element.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds?.y).toBeGreaterThanOrEqual(0)
      expect((bounds?.y ?? 844) + (bounds?.height ?? 844)).toBeLessThanOrEqual(844)
    }
    await page.screenshot({ path: "test-results/integration/proxies-form-mobile.png" })
    if (desktopViewport !== null) await page.setViewportSize(desktopViewport)
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(path) && response.request().method() === "POST",
    )
    const autoChecked = page.waitForResponse(
      (response) => response.url().endsWith("/detect") && response.request().method() === "POST",
    )
    await form.getByRole("button", { name: "确认", exact: true }).click()
    const savedResponse = await saved
    expect(savedResponse.status()).toBe(201)
    const savedBody = await savedResponse.json()
    expect(JSON.stringify(savedBody)).not.toContain("e2e-private-refresh")
    const created = ProxyRecord.parse(savedBody)
    createdId = created.id
    expect(created.configuration).toMatchObject({ protocol: "http", turbo: true })
    const autoResponse = await autoChecked
    expect(autoResponse.status()).toBe(200)
    expect(await autoResponse.json()).toMatchObject({
      ok: false,
      message: "proxy_address_not_public",
      detection_type: "ip_lookup",
      connectivity_checked: false,
    })
    await expect(form).not.toBeVisible()
    await page.reload()
    const row = page.getByRole("row").filter({ hasText: note })
    await expect(row).toBeVisible()
    await expect(row).toContainText("HTTP")
    await row.getByRole("button", { name: "编辑", exact: true }).click()
    const editor = page.getByRole("dialog").filter({ hasText: "修改代理" })
    await expect(editor.getByLabel("IP", { exact: true })).toHaveValue("127.0.0.1")
    await expect(editor.getByLabel("刷新URL", { exact: true })).toHaveValue(refreshUrl)
    await expect(editor.getByRole("switch", { name: "加速节点", exact: true })).toBeChecked()
    await editor.getByRole("button", { name: "取消", exact: true }).click()
    // The existing ten-second cooldown applies to the automatic lookup too.
    await page.waitForTimeout(10500)
    await row.getByRole("button", { name: "检测", exact: true }).click()
    const detector = page.getByRole("dialog").filter({ hasText: "检测选项" })
    const checked = page.waitForResponse((response) =>
      response.url().endsWith(`/${created.id}/detect`),
    )
    await detector.getByRole("button", { name: "确认", exact: true }).click()
    expect((await checked).ok()).toBe(true)
    await expect(detector).not.toBeVisible()
    await expect(row).toContainText("失败")
    await page.reload()
    await expect(row).toContainText("失败")
    const listed = z
      .object({ items: z.array(ProxyRecord) })
      .parse(await (await page.request.get(path)).json())
    expect(JSON.stringify(listed)).not.toContain("e2e-private-refresh")
    expect(listed.items.find((item) => item.id === created.id)?.checkResult).toMatchObject({
      ok: false,
      message: "proxy_address_not_public",
      detection_type: "ip_lookup",
      connectivity_checked: false,
    })
    const favoriteSaved = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/${created.id}`) && response.request().method() === "PATCH",
    )
    await row.getByRole("button", { name: "收藏", exact: true }).click()
    expect((await favoriteSaved).ok()).toBe(true)
    await expect(row.getByRole("button", { name: "取消收藏", exact: true })).toBeVisible()
    await page.reload()
    await expect(row).toContainText("失败")
    const other = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      ignoreHTTPSErrors: true,
    })
    try {
      expect(
        (
          await other.request.post("/api/auth/login", {
            data: {
              email: config.E2E_SECOND_EMAIL,
              password: config.E2E_PASSWORD,
            },
          })
        ).ok(),
      ).toBe(true)
      expect((await other.request.get(path)).status()).toBe(404)
      expect((await other.request.post(`${path}/${created.id}/credentials`)).status()).toBe(404)
      expect(
        (await other.request.post(`${path}/${created.id}/detect`, { data: {} })).status(),
      ).toBe(404)
    } finally {
      await other.close()
    }
    await page.screenshot({ path: "test-results/integration/proxies-desktop.png", fullPage: true })
    await row.getByRole("button", { name: "查看", exact: true }).click()
    const details = page.getByRole("dialog").filter({ hasText: "检测结果[" })
    await expect(details).toBeVisible()
    // The existing mobile shell clips table columns; this checks the dialog, not that shell.
    await page.setViewportSize({ width: 390, height: 844 })
    const bounds = await details.boundingBox()
    expect(bounds?.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: "test-results/integration/proxies-mobile.png", fullPage: true })
  } finally {
    if (createdId !== undefined) {
      expect(
        (await page.request.post(`${path}/batch/delete`, { data: { ids: [createdId] } })).ok(),
      ).toBe(true)
    }
  }
})
