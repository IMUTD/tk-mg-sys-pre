import { defineConfig, devices } from "@playwright/test"

// biome-ignore lint/style/noDefaultExport: Playwright requires a default config export.
export default defineConfig({
  testDir: "./e2e/integration",
  outputDir: "./test-results/integration",
  workers: 1,
  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "https://127.0.0.1:18443",
    // Only the isolated acceptance environment uses a self-signed test certificate.
    ignoreHTTPSErrors: true,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
