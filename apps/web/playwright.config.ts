import { defineConfig, devices } from "@playwright/test"

// biome-ignore lint/style/noDefaultExport: Playwright requires a default config export.
export default defineConfig({
  outputDir: "/tmp/tk-mg-playwright-results",
  testDir: "./e2e",
  testIgnore: "**/integration/**",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
