import { describe, expect, it } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GroupIdSchema } from "../../lib/authorization"
import { ProxyConfigurationSchema } from "./configuration"
import { createSingBoxProbeTransport, isPublicIp, type ProbeNode } from "./probe"
import { ProxyIdSchema } from "./repository"

const binary = Bun.env["PROXY_PROBE_TEST_BINARY"]
const channel = Bun.env["PROXY_PROBE_TEST_CHANNEL"] ?? "us"
if (channel !== "us" && channel !== "cn") throw new Error("Invalid PROXY_PROBE_TEST_CHANNEL")
const networkTest = binary === undefined ? it.skip : it
const unusedPort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("missing fixture port")
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}
describe("real sing-box transport + public HTTPS IP lookup", () => {
  networkTest(
    "probes HTTP, SOCKS5, chained landing and V2 using a real isolated protocol fixture",
    async () => {
      if (binary === undefined) throw new Error("Missing probe binary")
      const directory = await mkdtemp(join(tmpdir(), "tk-mg-probe-fixture-"))
      await chmod(directory, 0o700)
      const uuid = crypto.randomUUID()
      const httpPort = await unusedPort()
      const socksPort = await unusedPort()
      const vmessPort = await unusedPort()
      const vlessPort = await unusedPort()
      const configPath = join(directory, "server.json")
      await writeFile(
        configPath,
        JSON.stringify({
          log: { disabled: true },
          inbounds: [
            {
              type: "http",
              tag: "http",
              listen: "127.0.0.1",
              listen_port: httpPort,
              users: [{ username: "fixture", password: "fixture" }],
            },
            {
              type: "socks",
              tag: "socks",
              listen: "127.0.0.1",
              listen_port: socksPort,
              users: [{ username: "fixture", password: "fixture" }],
            },
            {
              type: "vmess",
              tag: "vmess",
              listen: "127.0.0.1",
              listen_port: vmessPort,
              users: [{ uuid, alterId: 0 }],
            },
            {
              type: "vless",
              tag: "vless",
              listen: "127.0.0.1",
              listen_port: vlessPort,
              users: [{ uuid }],
            },
          ],
          outbounds: [{ type: "direct", tag: "fixture-egress" }],
          route: { final: "fixture-egress" },
        }),
        { mode: 0o600 },
      )
      const child = Bun.spawn([binary, "run", "-c", configPath], {
        stdout: "ignore",
        stderr: "ignore",
      })
      // Test-only resolver. Production always uses resolvePublicHost, with no environment bypass.
      const transport = createSingBoxProbeTransport(binary, async () => "127.0.0.1")
      const node = (protocol: "http" | "socks5" | "v2", port: number, extra = ""): ProbeNode => ({
        proxy: {
          id: ProxyIdSchema.parse(crypto.randomUUID()),
          groupId: GroupIdSchema.parse("11111111-1111-4111-8111-111111111111"),
          createdAt: new Date(),
          updatedAt: new Date(),
          credentialState: "configured",
          encryptedCredentials: "fixture",
          endpoint: `fixture:${port}`,
          name: "fixture",
          note: "",
          tags: [],
          status: "ready",
          configuration: ProxyConfigurationSchema.parse({
            protocol,
            host: "fixture.test",
            port,
            turbo: true,
          }),
        },
        secret: { username: "fixture", password: "fixture", extra },
      })
      const attempts = { http: 0, socks: 0 }
      const forwarders = []
      const forward = async (port: number, key: "http" | "socks") => {
        const sockets = new Set<ReturnType<typeof connect>>()
        const server = createServer((socket) => {
          attempts[key]++
          const upstream = connect(port, "127.0.0.1")
          sockets.add(socket)
          sockets.add(upstream)
          socket.on("error", () => upstream.destroy())
          upstream.on("error", () => socket.destroy())
          socket.on("close", () => {
            sockets.delete(socket)
            upstream.destroy()
          })
          upstream.on("close", () => {
            sockets.delete(upstream)
            socket.destroy()
          })
          socket.pipe(upstream).pipe(socket)
        })
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
        const address = server.address()
        if (address === null || typeof address === "string") throw new Error("missing forwarder")
        return { server, port: address.port, sockets }
      }
      try {
        await Bun.sleep(200)
        if (child.exitCode !== null) throw new Error("Protocol fixture did not start")
        const http = await forward(httpPort, "http")
        const socks = await forward(socksPort, "socks")
        forwarders.push(http, socks)
        const options = { channel, mode: "detailed", useTurbo: false } as const
        for (const [index, path] of [
          [node("http", http.port)],
          [node("socks5", socks.port)],
          [node("http", http.port), node("socks5", socks.port)],
          [
            node(
              "v2",
              vmessPort,
              JSON.stringify({
                type: "vmess",
                server: "fixture.test",
                server_port: vmessPort,
                uuid,
                security: "auto",
                alter_id: 0,
              }),
            ),
          ],
          [node("v2", vlessPort, `vless://${uuid}@fixture.test:${vlessPort}?security=none`)],
        ].entries()) {
          if (index > 0) await Bun.sleep(1200)
          const result = await transport.query(path, options, 15000)
          expect(isPublicIp(result.information.ip)).toBe(true)
          expect(result.information.country).toMatch(/^[A-Z]{2}$/)
          expect(result.information.ip).not.toBe("fixture.test")
        }
        expect(attempts.http).toBeGreaterThanOrEqual(2)
        expect(attempts.socks).toBeGreaterThanOrEqual(2)
        await expect(transport.query([node("http", http.port)], options, 1)).rejects.toThrow()
      } finally {
        await transport.close?.()
        child.kill("SIGKILL")
        await child.exited
        for (const item of forwarders) {
          for (const socket of item.sockets) socket.destroy()
          await new Promise<void>((resolve) => item.server.close(() => resolve()))
        }
        if (directory.startsWith(join(tmpdir(), "tk-mg-probe-fixture-")))
          await rm(directory, { recursive: true, force: true })
      }
    },
    120000,
  )
})
