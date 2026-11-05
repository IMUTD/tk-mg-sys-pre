import { defineConfig, devices } from "@playwright/test"

// biome-ignore lint/style/noDefaultExport: Playwright requires a default config export.
export default defineConfig({
  testDir: "./e2e/integration",
  testMatch: "identity-verification.spec.ts",
  outputDir: "/tmp/tk-mg-identity-playwright",
  workers: 1,
  retries: 0,
  use: { baseURL: "http://127.0.0.1:4189", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
