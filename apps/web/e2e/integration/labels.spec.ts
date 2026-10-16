import { expect, test } from "@playwright/test"
import { z } from "zod"

const config = z
  .object({
    E2E_EMAIL: z.string().email(),
    E2E_SECOND_EMAIL: z.string().email(),
    E2E_PASSWORD: z.string(),
  })
  .parse(process.env)

const labelId = z.object({ id: z.string().uuid() })

test("scoped categories persist, reuse the right objects and isolate administrators", async ({
  page,
  browser,
}) => {
  const groupName = `e2e-group-${crypto.randomUUID().slice(0, 8)}`
  const remarkName = `e2e-remark-${crypto.randomUUID().slice(0, 8)}`
  const names = {
    device: groupName,
    remark: remarkName,
    account: `${groupName}-account`,
    tag: `${groupName}-tag`,
    proxy: `${groupName}-proxy`,
    resource: `${groupName}-resource`,
    registration: `${groupName}-registration`,
  }
  const created: { id: string; page: string; scope: string }[] = []
  await page.goto("/operations/devices")
  await page.getByRole("textbox", { name: "邮箱" }).fill(config.E2E_EMAIL)
  await page.getByLabel("密码", { exact: true }).fill(config.E2E_PASSWORD)
  await page.getByRole("button", { name: "登录" }).click()
  await expect(page.getByRole("button", { name: "添加备注" })).toBeVisible()
  const verify = async (title: string, visible: string) => {
    const row = page.getByRole("group", { name: title, exact: true })
    const tag = row.getByRole("button", { name: visible, exact: true })
    await expect(tag).toBeVisible()
    for (const hidden of Object.values(names).filter((name) => name !== visible)) {
      await expect(row.getByRole("button", { name: hidden, exact: true })).toHaveCount(0)
    }
    await tag.click()
    await expect(tag).toHaveAttribute("aria-pressed", "true")
    await tag.click()
    await expect(tag).toHaveAttribute("aria-pressed", "false")
  }
  try {
    for (const [title, name, route] of [
      ["分组", groupName, "box-groups"],
      ["备注", remarkName, "box-remarks"],
    ] as const) {
      await page.getByRole("button", { name: `添加${title}`, exact: true }).click()
      const input = page.getByRole("group", { name: title, exact: true }).getByRole("textbox", {
        name: `添加${title}`,
      })
      await input.fill(name)
      const response = page.waitForResponse(
        (result) => result.request().method() === "POST" && result.url().endsWith(`/api/${route}`),
      )
      await input.press("Enter")
      const result = await response
      expect(result.status()).toBe(201)
      created.push({
        id: labelId.parse(await result.json()).id,
        page: "/operations/devices",
        scope: "device",
      })
      await expect(input).not.toBeVisible()
    }
    await page.reload()
    await expect(
      page
        .getByRole("group", { name: "备注", exact: true })
        .getByRole("button", { name: new RegExp(remarkName) }),
    ).toBeVisible()
    for (const [path, title, scope, name] of [
      ["/operations/accounts", "账号分组", "account", names.account],
      ["/operations/accounts", "标签", "account-tag", names.tag],
      ["/operations/proxies", "分组", "proxy", names.proxy],
      ["/studio/text-pool", "标签", "resource", names.resource],
      ["/studio/registration", "标签", "registration", names.registration],
    ] as const) {
      await page.goto(path)
      await page.getByRole("button", { name: `添加${title}`, exact: true }).click()
      const input = page.getByRole("group", { name: title, exact: true }).getByRole("textbox", {
        name: `添加${title}`,
      })
      await input.fill(name)
      const response = page.waitForResponse(
        (result) =>
          result.request().method() === "POST" && result.url().includes("/api/labels/catalog"),
      )
      await input.press("Enter")
      const result = await response
      expect(result.status()).toBe(201)
      expect(new URL(result.url()).searchParams.get("scope")).toBe(scope)
      created.push({ id: labelId.parse(await result.json()).id, page: path, scope })
      await expect(input).not.toBeVisible()
      await page.reload()
      await verify(title, name)
      if (scope === "proxy") {
        const row = page.getByRole("group", { name: title, exact: true })
        const unassigned = row.getByRole("button", { name: "未分组", exact: true })
        await unassigned.click()
        await expect(unassigned).toHaveAttribute("aria-pressed", "true")
        await row.getByRole("button", { name: "全部", exact: true }).click()
        await expect(unassigned).toHaveAttribute("aria-pressed", "false")
      }
    }
    await page.goto("/operations/accounts")
    await verify("账号分组", names.account)
    await verify("标签", names.tag)
    await page.getByRole("button", { name: "分配代理", exact: true }).click()
    await verify("代理分组", names.proxy)
    await verify("分配账号分组", names.account)
    await page.goto("/operations/account-pool")
    await page.getByRole("button", { name: "新增", exact: true }).click()
    await verify("账号分组", names.account)
    await verify("账号标签", names.tag)
    await page.goto("/operations/tasks")
    await verify("设备分组", names.device)
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
      for (const label of created) {
        const query = new URLSearchParams({ page: label.page, scope: label.scope })
        const body = await (await other.request.get(`/api/labels/catalog?${query}`)).json()
        expect(
          [...body.groups, ...body.remarks].some((item: { id: string }) => item.id === label.id),
        ).toBe(false)
        expect(
          (await other.request.delete(`/api/labels/catalog/${label.id}?${query}`)).status(),
        ).toBe(404)
      }
    } finally {
      await other.close()
    }

    await page.goto("/operations/devices")
    await expect(
      page
        .getByRole("group", { name: "分组", exact: true })
        .getByRole("button", { name: new RegExp(names.device) }),
    ).toBeVisible()
    await expect(
      page
        .getByRole("group", { name: "备注", exact: true })
        .getByRole("button", { name: new RegExp(names.remark) }),
    ).toBeVisible()
    for (const name of [
      names.account,
      names.tag,
      names.proxy,
      names.resource,
      names.registration,
    ]) {
      await expect(
        page
          .getByRole("group", { name: "分组", exact: true })
          .getByRole("button", { name: new RegExp(name) }),
      ).toHaveCount(0)
    }
    await page.screenshot({ path: "test-results/integration/labels-desktop.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/operations/accounts")
    const row = page.getByRole("group", { name: "账号分组", exact: true })
    await verify("账号分组", names.account)
    await verify("标签", names.tag)
    const bounds = await row.boundingBox()
    expect(bounds).not.toBeNull()
    const tags = await row.getByRole("button").all()
    for (const tag of tags) {
      const box = await tag.boundingBox()
      if (box !== null && bounds !== null) {
        expect(box.x).toBeGreaterThanOrEqual(bounds.x - 1)
        expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1)
      }
    }
    await page.screenshot({ path: "test-results/integration/labels-mobile.png", fullPage: true })
    await page.goto("/studio/video-pool")
    for (const name of Object.values(names)) {
      await expect(
        page
          .getByRole("group", { name: "账号分组", exact: true })
          .getByRole("button", { name, exact: true }),
      ).toHaveCount(0)
    }
  } finally {
    for (const label of created) {
      const query = new URLSearchParams({ page: label.page, scope: label.scope })
      expect((await page.request.delete(`/api/labels/catalog/${label.id}?${query}`)).status()).toBe(
        204,
      )
    }
  }
})
