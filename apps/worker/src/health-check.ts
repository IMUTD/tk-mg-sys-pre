// biome-ignore-all lint/complexity/useLiteralKeys: Bun.env is index-signature typed.
const healthFile = Bun.file(Bun.env["TK_MG_WORKER_HEALTH_FILE"] ?? "/tmp/tk-mg-worker-ready")

if (!(await healthFile.exists()) || (await healthFile.text()).trim() !== "ready") {
  process.exitCode = 1
}

export {}
