import { mkdir } from "node:fs/promises"
import { expect, type Page, test } from "@playwright/test"

const login = async (page: Page, email: string) => {
  await page.goto("/login")
  await page.getByRole("textbox", { name: "邮箱" }).fill(email)
  await page.getByLabel("密码", { exact: true }).fill("identity-fixture-only")
  await page.getByRole("button", { name: "登录", exact: true }).click()
}

test("real browser uploads, binds, platform unbinds and the old session loses access", async ({
  page,
  browser,
}) => {
  await mkdir("/tmp/tk-mg-identity-qa", { recursive: true })
  const oversized = await page.request.post("/api/identity-verification/attempts", {
    data: Buffer.alloc(3_200_000),
  })
  expect(oversized.status()).toBe(413)
  await login(page, "tenant@identity.test")
  await expect(page).toHaveURL(/\/identity-verification$/)
  await expect(page.getByRole("button", { name: "提交认证" })).toBeDisabled()
  await expect(page.locator(".ant-message-notice")).toHaveCount(0)
  await page.screenshot({ path: "/tmp/tk-mg-identity-qa/upload-desktop.png", fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.locator(".ant-card").evaluate((element) => element.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(390)
  await page.screenshot({ path: "/tmp/tk-mg-identity-qa/upload-mobile.png", fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  const syntheticImage = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAUAAAADICAIAAAAWZq/8AAAACXBIWXMAAAPoAAAD6AG1e1JrAAACXElEQVR4nO3TMQ0AMAzAsPIn3XHoM0WyEeTJLJA1vwOAOwNDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRi26wHx0T3G59D1qQAAAABJRU5ErkJggg==",
    "base64",
  )
  await page.getByLabel("身份证人像面", { exact: true }).setInputFiles({
    name: "synthetic.png",
    mimeType: "image/png",
    buffer: Buffer.concat([syntheticImage, Buffer.alloc(2_000_000 - syntheticImage.length)]),
  })
  await page.getByRole("checkbox").check()
  await page.getByRole("button", { name: "提交认证" }).click()
  await expect(page).toHaveURL(/\/overview$/)
  await page.goto("/identity-verification")
  await expect(page.getByText("110***********002X")).toBeVisible()
  await page.screenshot({ path: "/tmp/tk-mg-identity-qa/verified-desktop.png", fullPage: true })
  await page.getByRole("link", { name: "盒子时长", exact: true }).click()
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4189" })
  try {
    const platform = await context.newPage()
    await login(platform, "platform@identity.test")
    await expect(platform).toHaveURL(/\/overview$/)
    await expect(platform.locator(".ant-message-notice")).toHaveCount(0)
    await platform.getByRole("link", { name: "实名认证管理", exact: true }).click()
    await expect(platform.getByText("110***********002X")).toBeVisible()
    await platform.screenshot({
      path: "/tmp/tk-mg-identity-qa/platform-desktop.png",
      fullPage: true,
    })
    await platform.getByRole("button", { name: "解除绑定", exact: true }).click()
    await platform.getByLabel("解绑原因", { exact: true }).fill("测试管理员申请更换身份资料")
    await platform.getByLabel("我的登录密码", { exact: true }).fill("identity-fixture-only")
    await platform.screenshot({ path: "/tmp/tk-mg-identity-qa/unbind-dialog.png", fullPage: true })
    await platform.getByRole("button", { name: "确认解绑", exact: true }).click()
    await expect(platform.getByRole("dialog")).toHaveCount(0)
    await expect(platform.getByText("已解绑", { exact: true })).toBeVisible()
    await platform.getByRole("button", { name: "记录", exact: true }).click()
    await expect(
      platform.getByRole("dialog").getByText("测试管理员申请更换身份资料", { exact: true }),
    ).toBeVisible()
    await platform.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click()
    await page.getByRole("link", { name: "任务列表", exact: true }).click()
    await expect(page).toHaveURL(/\/login$/)
    await login(page, "tenant@identity.test")
    await expect(page).toHaveURL(/\/identity-verification$/)
    await expect(page.getByText("已解绑", { exact: true })).toBeVisible()
    await page.screenshot({ path: "/tmp/tk-mg-identity-qa/unbound-desktop.png", fullPage: true })
  } finally {
    await context.close()
  }
})
