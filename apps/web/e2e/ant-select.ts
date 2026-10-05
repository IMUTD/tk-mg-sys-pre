import type { Page } from "@playwright/test"

export const chooseAntOption = async (page: Page, label: string, option: string): Promise<void> => {
  await page.getByLabel(label, { exact: true }).click()
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText(option, { exact: true })
    .click()
}
