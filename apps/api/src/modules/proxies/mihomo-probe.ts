import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { DetectOptions, ProxyCheck, V2Outbound } from "./configuration"
import { parseV2Outbound } from "./configuration"
import {
  boundedJson,
  isPublicIp,
  normalizeIpInformation,
  type ProbeNode,
  ProbeProviders,
  ProxyProbeError,
  resolvePublicHost,
} from "./probe"
import type { ProbeSnapshot, StoredProxy } from "./repository"

export const connectivityUrl = "https://www.gstatic.com/generate_204"

// Agent relay ports stay on the box. The backend probe only takes an ephemeral loopback port.
export const isAgentRelayPort = (port: number): boolean =>
  (port >= 10801 && port <= 10824) || (port >= 24010 && port <= 24240)

const availablePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => {
        if (address === null || typeof address === "string")
          reject(new ProxyProbeError("probe_start_failed"))
        else resolve(address.port)
      })
    })
  })

const relayPort = async (): Promise<number> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await availablePort()
    if (!isAgentRelayPort(port)) return port
  }
  throw new ProxyProbeError("probe_start_failed")
}

const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port })
    const finish = (ok: boolean): void => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(100)
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
    socket.once("timeout", () => finish(false))
  })

const v2Proxy = (
  outbound: V2Outbound,
  name: string,
  server: string,
  hostname: string,
): Record<string, unknown> => {
  const network = outbound.transport?.type ?? "tcp"
  const proxy: Record<string, unknown> = {
    name,
    type: outbound.type,
    server,
    port: outbound.server_port,
    uuid: outbound.uuid,
    udp: true,
    network,
  }
  if (outbound.type === "vmess") {
    proxy.alterId = outbound.alter_id ?? 0
    proxy.cipher = outbound.security ?? "auto"
  }
  if (outbound.flow) proxy.flow = outbound.flow
  if (outbound.tls?.enabled) {
    proxy.tls = true
    proxy.servername = outbound.tls.server_name || hostname
    if (outbound.tls.utls?.enabled) proxy["client-fingerprint"] = outbound.tls.utls.fingerprint
    if (outbound.tls.reality?.enabled) {
      proxy["reality-opts"] = {
        "public-key": outbound.tls.reality.public_key,
        "short-id": outbound.tls.reality.short_id,
      }
    }
  }
  if (outbound.transport?.type === "ws") {
    proxy["ws-opts"] = {
      path: outbound.transport.path || "/",
      ...(outbound.transport.headers ? { headers: { Host: outbound.transport.headers.Host } } : {}),
    }
  }
  if (outbound.transport?.type === "grpc") {
    proxy["grpc-opts"] = { "grpc-service-name": outbound.transport.service_name ?? "" }
  }
  return proxy
}

const toMihomoProxy = async (
  node: ProbeNode,
  name: string,
  resolve: typeof resolvePublicHost,
): Promise<Record<string, unknown>> => {
  const configuration = node.proxy.configuration
  if (configuration === undefined) throw new ProxyProbeError("invalid_proxy_configuration")
  const server = await resolve(configuration.host)
  if (configuration.protocol === "v2") {
    const outbound = parseV2Outbound(node.secret.extra)
    if (outbound.server !== configuration.host || outbound.server_port !== configuration.port)
      throw new ProxyProbeError("invalid_proxy_configuration")
    return v2Proxy(outbound, name, server, configuration.host)
  }
  const proxy: Record<string, unknown> = {
    name,
    type: configuration.protocol === "socks5" ? "socks5" : "http",
    server,
    port: configuration.port,
    udp: configuration.protocol === "socks5",
  }
  if (node.secret.username.length > 0) {
    proxy.username = node.secret.username
    proxy.password = node.secret.password
  }
  return proxy
}

export const buildMihomoProbeConfig = async (
  nodes: readonly ProbeNode[],
  port: number,
  username: string,
  password: string,
  resolve: typeof resolvePublicHost = resolvePublicHost,
): Promise<Record<string, unknown>> => {
  if (nodes.length === 0 || nodes.length > 2 || isAgentRelayPort(port) || port < 1)
    throw new ProxyProbeError("invalid_proxy_configuration")
  const exit = await toMihomoProxy(nodes[0] as ProbeNode, "land", resolve)
  const proxies = [exit]
  if (nodes[1] !== undefined) {
    proxies.unshift(await toMihomoProxy(nodes[1], "dialer", resolve))
    exit["dialer-proxy"] = "dialer"
  }
  return {
    port,
    "bind-address": "127.0.0.1",
    "allow-lan": false,
    mode: "rule",
    "log-level": "silent",
    ipv6: false,
    "geo-auto-update": false,
    "find-process-mode": "off",
    authentication: [`${username}:${password}`],
    proxies,
    "proxy-groups": [{ name: "PROXY", type: "select", proxies: ["land"] }],
    rules: ["MATCH,PROXY"],
  }
}

export type DialProbeResult = {
  readonly connectivity: {
    readonly ok: boolean
    readonly delay: number
    readonly status: number
    readonly url: string
  }
  readonly information: NonNullable<ProxyCheck["results"][number]["response_body"]> | null
  readonly informationDelay: number
}

export interface RelayProbeTransport {
  close?(): Promise<void>
  query(
    nodes: readonly ProbeNode[],
    options: DetectOptions,
    timeoutMs: number,
  ): Promise<DialProbeResult>
}

const onlineStatus = (status: number): boolean => status === 200 || status === 204

export const createMihomoProbeTransport = (
  binary: string,
  resolveHost: typeof resolvePublicHost = resolvePublicHost,
): RelayProbeTransport => {
  const children = new Set<ReturnType<typeof Bun.spawn>>()
  let active = 0
  let closed = false
  return {
    close: async () => {
      closed = true
      for (const child of children) child.kill("SIGKILL")
      await Promise.all([...children].map((child) => child.exited))
    },
    query: async (nodes, options, timeoutMs) => {
      if (closed || active >= 4) throw new ProxyProbeError("probe_capacity_exceeded")
      active += 1
      const began = Date.now()
      let directory = ""
      let child: ReturnType<typeof Bun.spawn> | undefined
      let rejectDeadline: (error: Error) => void = () => undefined
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = reject
      })
      void deadline.catch(() => undefined)
      const timer = setTimeout(() => {
        child?.kill("SIGKILL")
        rejectDeadline(new ProxyProbeError("proxy_probe_timeout"))
      }, timeoutMs)
      try {
        directory = await mkdtemp(join(tmpdir(), "tk-mg-relay-probe-"))
        await chmod(directory, 0o700)
        const port = await relayPort()
        const username = crypto.randomUUID()
        const password = crypto.randomUUID()
        const config = await Promise.race([
          buildMihomoProbeConfig(nodes, port, username, password, resolveHost),
          deadline,
        ])
        if (closed) throw new ProxyProbeError("probe_capacity_exceeded")
        const configPath = join(directory, "config.yaml")
        await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
        child = Bun.spawn([binary, "-d", directory, "-f", configPath], {
          cwd: directory,
          stdout: "ignore",
          stderr: "ignore",
        })
        children.add(child)
        let ready = false
        while (Date.now() - began < 3000 && child.exitCode === null) {
          if (await canConnect(port)) {
            ready = true
            break
          }
          await Bun.sleep(30)
        }
        if (!ready) throw new ProxyProbeError("probe_start_failed")
        const proxy = `http://${username}:${password}@127.0.0.1:${port}`
        const remaining = (): number => Math.max(1, timeoutMs - (Date.now() - began))
        const connectivityStarted = Date.now()
        const connectivityResponse = await Promise.race([
          fetch(connectivityUrl, {
            proxy,
            redirect: "error",
            signal: AbortSignal.timeout(remaining()),
            headers: { "User-Agent": "tk-mg-relay-probe/1.0" },
          }),
          deadline,
        ])
        await connectivityResponse.body?.cancel()
        const connectivity = {
          ok: onlineStatus(connectivityResponse.status),
          delay: Date.now() - connectivityStarted,
          status: connectivityResponse.status,
          url: connectivityUrl,
        }
        if (!connectivity.ok) return { connectivity, information: null, informationDelay: 0 }
        const lookupStarted = Date.now()
        const lookup = await Promise.race([
          fetch(ProbeProviders[options.channel], {
            proxy,
            redirect: "error",
            signal: AbortSignal.timeout(remaining()),
            headers: { "User-Agent": "tk-mg-relay-probe/1.0", Accept: "application/json" },
          }),
          deadline,
        ])
        if (!lookup.ok) {
          await lookup.body?.cancel()
          if (lookup.status === 429) throw new ProxyProbeError("ip_provider_rate_limited")
          return { connectivity, information: null, informationDelay: Date.now() - lookupStarted }
        }
        const information = normalizeIpInformation(
          options.channel,
          await Promise.race([boundedJson(lookup), deadline]),
        )
        if (!isPublicIp(information.ip)) throw new ProxyProbeError("invalid_ip_information")
        return { connectivity, information, informationDelay: Date.now() - lookupStarted }
      } catch (error) {
        if (error instanceof ProxyProbeError) throw error
        const code =
          error !== null && typeof error === "object" && "code" in error ? String(error.code) : ""
        if (code === "ENOENT") throw new ProxyProbeError("probe_start_failed")
        throw new ProxyProbeError("proxy_connection_failed")
      } finally {
        clearTimeout(timer)
        active -= 1
        if (child !== undefined) {
          child.kill("SIGKILL")
          await child.exited
          children.delete(child)
        }
        if (directory.startsWith(join(tmpdir(), "tk-mg-relay-probe-")))
          await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

const chainCandidates = (snapshot: ProbeSnapshot): StoredProxy[][] => {
  const configuration = snapshot.proxy.configuration
  if (configuration === undefined) throw new ProxyProbeError("invalid_proxy_configuration")
  const ids = [
    ...(configuration.acceleratorId === null ? [] : [configuration.acceleratorId]),
    ...configuration.acceleratorIds.filter((id) => id !== configuration.acceleratorId),
  ]
  if (ids.length === 0) return [[snapshot.proxy]]
  return ids.map((id) => {
    const accelerator = snapshot.nodes.find((node) => node.id === id)
    if (accelerator === undefined) throw new ProxyProbeError("invalid_accelerator")
    return [snapshot.proxy, accelerator]
  })
}

export const detectDial = async (
  snapshot: ProbeSnapshot,
  options: DetectOptions,
  transport: RelayProbeTransport,
  decrypt: (proxy: StoredProxy) => { username: string; password: string; extra: string },
): Promise<ProxyCheck> => {
  const started = Date.now()
  const chained = (snapshot.proxy.configuration?.acceleratorId ?? null) !== null ||
    (snapshot.proxy.configuration?.acceleratorIds.length ?? 0) > 0
  const result: ProxyCheck = {
    detection_type: "proxy_connectivity",
    connectivity_checked: true,
    ok: false,
    message: "proxy_connection_failed",
    check_time: started,
    channel: options.channel,
    mode: options.mode,
    use_turbo: chained,
    include_response: options.mode === "detailed",
    successes: 0,
    failures: 1,
    status: 0,
    results: [],
    accelerator_id: null,
  }
  try {
    let attempts = 0
    for (const path of chainCandidates(snapshot)) {
      const remaining = 25000 - (Date.now() - started)
      if (remaining < 1000 || attempts >= 10) break
      attempts += 1
      try {
        const checked = await transport.query(
          path.map((proxy) => ({ proxy, secret: decrypt(proxy) })),
          options,
          Math.min(15000, remaining),
        )
        const expected = snapshot.proxy.configuration?.region.split(",").filter(Boolean) ?? []
        const country = checked.information?.country
        const regionOk =
          expected.length === 0 || (country !== undefined && expected.includes(country))
        const online = checked.connectivity.ok
        const ipOk = checked.information !== null
        const ok = online && ipOk && regionOk
        const message = !online
          ? "proxy_connection_failed"
          : !ipOk
            ? "proxy_online_ip_failed"
            : regionOk
              ? "proxy_online"
              : "proxy_region_mismatch"
        const ipResult =
          checked.information === null
            ? []
            : [
                {
                  ok: ipOk && regionOk,
                  delay: checked.informationDelay,
                  status: 200,
                  url: ProbeProviders[options.channel],
                  response_body: checked.information,
                },
              ]
        return {
          ...result,
          ok,
          message,
          status: online ? 200 : checked.connectivity.status,
          successes: ok ? 1 : 0,
          failures: ok ? 0 : 1,
          target_ip: checked.information?.ip,
          accelerator_id: path[1]?.id ?? null,
          results: [
            ...ipResult,
            {
              ok: online,
              delay: checked.connectivity.delay,
              status: checked.connectivity.status,
              url: checked.connectivity.url,
            },
          ],
        }
      } catch (error) {
        result.message = error instanceof ProxyProbeError ? error.code : "proxy_connection_failed"
        if (result.message === "ip_provider_rate_limited") {
          result.status = 429
          break
        }
      }
    }
  } catch (error) {
    result.message = error instanceof ProxyProbeError ? error.code : "proxy_connection_failed"
  }
  return result
}
