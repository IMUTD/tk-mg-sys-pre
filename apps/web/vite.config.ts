import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

const apiProxyEnvironmentVariable = "VITE_API_PROXY"

// biome-ignore lint/style/noDefaultExport: Vite requires a default config export.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        changeOrigin: true,
        target: process.env[apiProxyEnvironmentVariable] ?? "http://127.0.0.1:3000",
      },
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "e2e/**"],
    fileParallelism: true,
    globals: true,
    maxWorkers: 2,
    setupFiles: [resolve(import.meta.dirname, "src/test/setup.ts")],
    testTimeout: 15000,
  },
})
