import { expect, test } from "@playwright/test"
import { z } from "zod"

const config = z
  .object({
    E2E_EMAIL: z.string().email(),
    E2E_SECOND_EMAIL: z.string().email(),
    E2E_PASSWORD: z.string(),
  })
  .parse(process.env)
const Pool = z.object({
  id: z.string().uuid(),
  key: z.string(),
  count: z.number(),
  times: z.number(),
})
const Details = Pool.extend({
  accounts: z.array(z.object({ id: z.string().uuid(), uid: z.string(), status: z.string() })),
  progress: z.array(
    z.object({
      round: z.number(),
      size: z.number(),
      total: z.number(),
      unusedAccountIds: z.array(z.string().uuid()),
    }),
  ),
})

test.use({ actionTimeout: 15000 })

test("real account-pool writes, refresh persistence, rounds, exports and administrator isolation", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000)
  await page.goto("/operations/account-pool")
  await page.getByRole("textbox", { name: "邮箱" }).fill(config.E2E_EMAIL)
  await page.getByLabel("密码", { exact: true }).fill(config.E2E_PASSWORD)
  await page.getByRole("button", { name: "登录", exact: true }).click()
  await expect(page.getByText("验收-本地备份", { exact: true })).toBeVisible()
  const session = z
    .object({ user: z.object({ scope: z.object({ groupIds: z.array(z.string().uuid()) }) }) })
    .parse(await (await page.request.get("/api/auth/session")).json())
  const groupId = session.user.scope.groupIds[0]
  if (groupId === undefined) throw new Error("Missing test business group")
  const root = `/api/groups/${groupId}/operations/account-pools`
  const created: string[] = []
  const key = `e2e-pool-${Date.now()}`
  try {
    const devices = z
      .object({
        items: z.array(z.object({ id: z.string().uuid(), host: z.string(), name: z.string() })),
      })
      .parse(await (await page.request.get(`${root}/devices`)).json())
    const device = devices.items[0]
    if (device === undefined) throw new Error("Missing test device")
    await page
      .getByRole("row")
      .filter({ hasText: "验收-本地备份" })
      .getByRole("button", { name: "复制", exact: true })
      .click()
    let form = page.getByRole("dialog", { name: "新增账号池" })
    await form.getByLabel("账号池名", { exact: true }).fill(key)
    await form.getByLabel("重复次数", { exact: true }).fill("3")
    await form.getByLabel("设备", { exact: true }).click()
    await page.getByRole("option", { name: `${device.host}-${device.name}`, exact: true }).click()
    await form.getByLabel("账号分组", { exact: true }).click()
    await page.getByRole("option", { name: /验收-本地账号/ }).click()
    const saved = page.waitForResponse(
      (response) => response.url().endsWith(root) && response.request().method() === "POST",
    )
    await form.getByRole("button", { name: "确认", exact: true }).click()
    const savedResponse = await saved
    expect(savedResponse.status()).toBe(201)
    const pool = Pool.parse(await savedResponse.json())
    created.push(pool.id)
    expect(pool).toMatchObject({ key, times: 3, count: 4 })
    await expect(form).not.toBeVisible()
    await page.reload()
    const row = page.getByRole("row").filter({ hasText: key })
    await expect(row).toBeVisible()
    const details = Details.parse(await (await page.request.get(`${root}/${pool.id}`)).json())
    const account = details.accounts.find((item) => item.status === "0")
    if (account === undefined) throw new Error("Missing ready fixture account")
    const receipt = { accountId: account.id, round: 1, consumptionKey: `${key}-receipt` }
    for (let index = 0; index < 2; index++) {
      expect(
        (await page.request.post(`${root}/${pool.id}/consumption`, { data: receipt })).status(),
      ).toBe(204)
    }
    const consumed = Details.parse(await (await page.request.get(`${root}/${pool.id}`)).json())
    expect(consumed.progress.map((item) => item.size)).toEqual([3, 4, 4])
    expect(consumed.progress[0]?.unusedAccountIds).not.toContain(account.id)
    await row.getByRole("button", { name: "消耗进度", exact: true }).click()
    const progress = page.getByRole("dialog", { name: "消耗进度" })
    await expect(progress.getByText("3 / 4", { exact: true })).toBeVisible()
    await expect(progress.getByText("4 / 4", { exact: true })).toHaveCount(2)
    const download = page.waitForEvent("download")
    await progress
      .getByRole("row")
      .filter({ hasText: `${key}_1` })
      .getByRole("button", { name: "导出未使用", exact: true })
      .click()
    const csv = await (await download).createReadStream()
    let output = ""
    for await (const chunk of csv) output += chunk.toString()
    expect(output.split("\n")).toHaveLength(4)
    expect(output).not.toContain(account.uid)
    expect(output).not.toContain("simulation-only-not-a-real-password")
    await page.keyboard.press("Escape")
    await expect(progress).not.toBeVisible()
    await row.getByRole("button", { name: "复制", exact: true }).click()
    form = page.getByRole("dialog", { name: "新增账号池" })
    await expect(form.getByLabel("账号池名", { exact: true })).toHaveValue(key)
    await form.getByLabel("账号池名", { exact: true }).fill(`${key}-copy`)
    const copied = page.waitForResponse(
      (response) => response.url().endsWith(root) && response.request().method() === "POST",
    )
    await form.getByRole("button", { name: "确认", exact: true }).click()
    const copyResponse = await copied
    expect(copyResponse.status()).toBe(201)
    created.push(Pool.parse(await copyResponse.json()).id)
    await expect(form).not.toBeVisible()

    await expect(page.getByRole("button", { name: "创建账号池", exact: true })).toHaveCount(0)
    await page.getByRole("button", { name: "新增", exact: true }).click()
    const creator = page.getByRole("dialog", { name: "新增账号池" })
    await creator
      .getByRole("group", { name: "账号状态", exact: true })
      .getByRole("button", { name: "正常", exact: true })
      .click()
    const selected = page.waitForResponse(
      (response) => response.url().endsWith(root) && response.request().method() === "POST",
    )
    await creator.getByRole("button", { name: "确认", exact: true }).click()
    const selectedResponse = await selected
    expect(selectedResponse.status()).toBe(201)
    const selectedPool = Pool.parse(await selectedResponse.json())
    created.push(selectedPool.id)
    expect(selectedPool.key).toBe("账号状态=正常")
    await expect(creator).not.toBeVisible()
    await page.reload()
    await expect(page.getByText(selectedPool.key, { exact: true })).toBeVisible()

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
      for (const suffix of ["", `/${pool.id}`])
        expect((await other.request.get(`${root}${suffix}`)).status()).toBe(404)
      expect(
        (await other.request.post(`${root}/${pool.id}/consumption`, { data: receipt })).status(),
      ).toBe(404)
      expect(
        (await other.request.post(`${root}/batch-delete`, { data: { ids: [pool.id] } })).status(),
      ).toBe(404)
    } finally {
      await other.close()
    }
    await page.screenshot({
      path: "test-results/integration/account-pools-desktop.png",
      fullPage: true,
    })
    // The pre-existing mobile sidebar clips table actions; verify dialog sizing separately.
    await page
      .getByRole("row")
      .filter({ hasText: key })
      .filter({ hasNotText: "-copy" })
      .getByRole("button", { name: "消耗进度", exact: true })
      .click()
    const mobile = page.getByRole("dialog", { name: "消耗进度" })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(mobile).toBeVisible()
    expect((await mobile.boundingBox())?.width).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: "test-results/integration/account-pools-mobile.png",
      fullPage: true,
    })
    await page.keyboard.press("Escape")
    await expect(mobile).not.toBeVisible()
    await page.setViewportSize({ width: 1280, height: 720 })
    const original = page.getByRole("row").filter({ hasText: key }).filter({ hasNotText: "-copy" })
    await original.getByRole("button", { name: "删除", exact: true }).click()
    const removed = page.waitForResponse((response) =>
      response.url().endsWith(`${root}/batch-delete`),
    )
    await page.getByRole("button", { name: "确定", exact: true }).click()
    expect((await removed).status()).toBe(200)
    created.splice(created.indexOf(pool.id), 1)
    await page.reload()
    await expect(page.getByText(key, { exact: true })).toHaveCount(0)
    expect((await page.request.get(`${root}/${pool.id}`)).status()).toBe(404)
  } finally {
    test.info().setTimeout(test.info().timeout + 15000)
    if (created.length > 0)
      expect(
        (
          await page.request.post(`${root}/batch-delete`, {
            data: { ids: created },
          })
        ).status(),
      ).toBe(200)
  }
  await page.goto("/operations/account-pool")
  await expect(page.getByText("验收-本地备份", { exact: true })).toBeVisible()
  await page.screenshot({
    path: "test-results/integration/account-pools-acceptance.png",
    fullPage: true,
  })
})
