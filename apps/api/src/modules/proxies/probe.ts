import { lookup } from "node:dns/promises"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import countries from "i18n-iso-countries"
import englishCountries from "i18n-iso-countries/langs/en.json"
import ipaddr from "ipaddr.js"
import { z } from "zod"
import {
  type DetectOptions,
  type ProxyCheck,
  type ProxySecret,
  parseV2Outbound,
} from "./configuration"
import type { ProbeSnapshot, StoredProxy } from "./repository"

export const ProbeProviders = {
  us: "https://api.ipapi.is/",
  cn: "https://api.ip.sb/geoip",
} as const
export class ProxyProbeError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = "ProxyProbeError"
  }
}
export const isPublicIp = (value: string): boolean => {
  try {
    return ipaddr.process(value).range() === "unicast"
  } catch {
    return false
  }
}
export const resolvePublicHost = async (
  host: string,
  resolve = (name: string) => lookup(name, { all: true, verbatim: true }),
): Promise<string> => {
  const records = ipaddr.isValid(host) ? [{ address: host }] : await resolve(host)
  if (records.length === 0 || records.some((record) => !isPublicIp(record.address)))
    throw new ProxyProbeError("proxy_address_not_public")
  // Pin resolution in the outbound, including detoured nodes, to prevent DNS rebinding.
  const address = records[0]?.address
  if (address === undefined) throw new ProxyProbeError("proxy_address_not_public")
  return address
}

const ShortText = z.string().max(256)
countries.registerLocale(englishCountries)
const AnonymousIpapiSchema = z.object({
  ip: z.string(),
  country: ShortText,
  region: ShortText,
  city: ShortText,
  company: ShortText,
  asn: ShortText,
})
const IpapiSchema = z.object({
  ip: z.string(),
  location: z.object({
    country_code: z.string().length(2),
    country: ShortText,
    state: ShortText.optional(),
    city: ShortText.optional(),
  }),
  asn: z.object({ asn: z.number().int().optional(), org: ShortText.optional() }).optional(),
  company: z.object({ name: ShortText.optional() }).optional(),
})
const IpsbSchema = z.object({
  ip: z.string(),
  country_code: z.string().length(2),
  country: ShortText.optional(),
  region: ShortText.optional(),
  city: ShortText.optional(),
  isp: ShortText.optional(),
  asn: z.number().int().optional(),
  asn_organization: ShortText.optional(),
})
export const normalizeIpInformation = (
  channel: DetectOptions["channel"],
  payload: unknown,
): NonNullable<ProxyCheck["results"][number]["response_body"]> => {
  let information: NonNullable<ProxyCheck["results"][number]["response_body"]>
  if (channel === "us") {
    const structured = IpapiSchema.safeParse(payload)
    if (!structured.success) {
      const data = AnonymousIpapiSchema.parse(payload)
      const code = countries.getAlpha2Code(data.country, "en")
      if (code === undefined) throw new ProxyProbeError("invalid_ip_information")
      information = {
        ip: data.ip,
        country: code,
        countryName: data.country,
        region: data.region,
        city: data.city,
        isp: data.company,
        asn: data.asn,
      }
    } else {
      const data = structured.data
      information = {
        ip: data.ip,
        country: data.location.country_code.toUpperCase(),
        countryName: data.location.country,
        region: data.location.state ?? "",
        city: data.location.city ?? "",
        isp: data.asn?.org ?? data.company?.name ?? "",
        asn: data.asn?.asn === undefined ? "" : `AS${data.asn.asn}`,
      }
    }
  } else {
    const data = IpsbSchema.parse(payload)
    information = {
      ip: data.ip,
      country: data.country_code.toUpperCase(),
      countryName: data.country ?? "",
      region: data.region ?? "",
      city: data.city ?? "",
      isp: data.isp ?? data.asn_organization ?? "",
      asn: data.asn === undefined ? "" : `AS${data.asn}`,
    }
  }
  if (!isPublicIp(information.ip)) throw new ProxyProbeError("invalid_ip_information")
  return information
}
export const boundedJson = async (response: Response): Promise<unknown> => {
  const reader = response.body?.getReader()
  if (reader === undefined) throw new ProxyProbeError("empty_ip_information")
  let size = 0
  const chunks: Uint8Array[] = []
  try {
    while (true) {
      const item = await reader.read()
      if (item.done) break
      size += item.value.byteLength
      if (size > 65536) throw new ProxyProbeError("ip_information_too_large")
      chunks.push(item.value)
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
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
export type ProbeNode = { readonly proxy: StoredProxy; readonly secret: ProxySecret }
export const buildProbeConfig = async (
  nodes: readonly ProbeNode[],
  port: number,
  username: string,
  password: string,
  resolve = resolvePublicHost,
): Promise<Record<string, unknown>> => {
  const outbounds = []
  for (const [index, node] of nodes.entries()) {
    const configuration = node.proxy.configuration
    if (configuration === undefined) throw new ProxyProbeError("invalid_proxy_configuration")
    const server = await resolve(configuration.host)
    const base =
      configuration.protocol === "v2"
        ? parseV2Outbound(node.secret.extra)
        : {
            type: configuration.protocol === "socks5" ? "socks" : "http",
            server: configuration.host,
            server_port: configuration.port,
            ...(configuration.protocol === "socks5" ? { version: "5" } : {}),
            ...(node.secret.username.length > 0
              ? {
                  username: node.secret.username,
                  password: node.secret.password,
                }
              : {}),
          }
    if (base.server !== configuration.host || base.server_port !== configuration.port)
      throw new ProxyProbeError("invalid_proxy_configuration")
    outbounds.push({
      ...base,
      // TLS SNI remains the original hostname even though the socket address is pinned.
      ...("tls" in base && base.tls !== undefined
        ? {
            tls: {
              ...base.tls,
              server_name: base.tls.server_name || configuration.host,
            },
          }
        : {}),
      server,
      tag: `node-${index}`,
      connect_timeout: "8s",
      ...(index + 1 < nodes.length ? { detour: `node-${index + 1}` } : {}),
    })
  }
  return {
    log: { disabled: true },
    inbounds: [
      {
        type: "http",
        tag: "probe",
        listen: "127.0.0.1",
        listen_port: port,
        users: [{ username, password }],
      },
    ],
    outbounds,
    route: {
      rules: [
        { domain: ["api.ipapi.is", "api.ip.sb"], port: 443, action: "route", outbound: "node-0" },
        { action: "reject" },
      ],
    },
  }
}
export interface ProxyProbeTransport {
  close?(): Promise<void>
  query(
    nodes: readonly ProbeNode[],
    options: DetectOptions,
    timeoutMs: number,
  ): Promise<{
    readonly information: NonNullable<ProxyCheck["results"][number]["response_body"]>
    readonly delay: number
  }>
}
export const createSingBoxProbeTransport = (
  binary: string,
  resolveHost = resolvePublicHost,
): ProxyProbeTransport => {
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
      active++
      const began = Date.now()
      let directory: string
      try {
        directory = await mkdtemp(join(tmpdir(), "tk-mg-probe-"))
      } catch {
        active--
        throw new ProxyProbeError("probe_start_failed")
      }
      let child: ReturnType<typeof Bun.spawn> | undefined
      let rejectDeadline: (error: Error) => void = () => undefined
      const deadline = new Promise<never>((_, reject) => {
        rejectDeadline = reject
      })
      // A very short timeout may expire before filesystem/port setup reaches Promise.race.
      void deadline.catch(() => undefined)
      const timer = setTimeout(() => {
        child?.kill("SIGKILL")
        rejectDeadline(new ProxyProbeError("proxy_probe_timeout"))
      }, timeoutMs)
      try {
        await chmod(directory, 0o700)
        const port = await availablePort()
        const username = crypto.randomUUID()
        const password = crypto.randomUUID()
        const config = await Promise.race([
          buildProbeConfig(nodes, port, username, password, resolveHost),
          deadline,
        ])
        if (closed) throw new ProxyProbeError("probe_capacity_exceeded")
        const configPath = join(directory, "config.json")
        await writeFile(configPath, JSON.stringify(config), { mode: 0o600 })
        child = Bun.spawn([binary, "run", "-c", configPath], {
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
        const response = await Promise.race([
          fetch(ProbeProviders[options.channel], {
            proxy: `http://${username}:${password}@127.0.0.1:${port}`,
            redirect: "error",
            signal: AbortSignal.timeout(Math.max(1, timeoutMs - (Date.now() - began))),
            headers: { "User-Agent": "tk-mg-proxy-probe/1.0", Accept: "application/json" },
          }),
          deadline,
        ])
        if (!response.ok) {
          await response.body?.cancel()
          throw new ProxyProbeError(
            response.status === 429 ? "ip_provider_rate_limited" : "ip_provider_failed",
          )
        }
        return {
          information: normalizeIpInformation(
            options.channel,
            await Promise.race([boundedJson(response), deadline]),
          ),
          delay: Date.now() - began,
        }
      } catch (error) {
        if (error instanceof ProxyProbeError) throw error
        throw new ProxyProbeError("proxy_connection_failed")
      } finally {
        clearTimeout(timer)
        active--
        if (child !== undefined) {
          child.kill("SIGKILL")
          await child.exited
          children.delete(child)
        }
        if (directory.startsWith(join(tmpdir(), "tk-mg-probe-")))
          await rm(directory, { recursive: true, force: true })
      }
    },
  }
}

const candidateIds = (proxy: StoredProxy): readonly string[] => [
  ...(proxy.configuration?.acceleratorIds ?? []),
  ...(proxy.configuration?.acceleratorId ? [proxy.configuration.acceleratorId] : []),
]
function* paths(
  proxy: StoredProxy,
  nodes: readonly StoredProxy[],
  prefix: readonly StoredProxy[] = [],
): Generator<readonly StoredProxy[]> {
  if (prefix.length >= 8 || prefix.some((node) => node.id === proxy.id))
    throw new ProxyProbeError("accelerator_cycle")
  const next = [...prefix, proxy]
  const candidates = candidateIds(proxy)
  if (candidates.length === 0) {
    yield next
    return
  }
  for (const id of candidates) {
    const candidate = nodes.find((node) => node.id === id)
    if (candidate === undefined) throw new ProxyProbeError("invalid_accelerator")
    yield* paths(candidate, nodes, next)
  }
}
export const detectProxy = async (
  snapshot: ProbeSnapshot,
  options: DetectOptions,
  transport: ProxyProbeTransport,
  decrypt: (value: string) => ProxySecret,
): Promise<ProxyCheck> => {
  const started = Date.now()
  const result: ProxyCheck = {
    ok: false,
    message: "proxy_connection_failed",
    check_time: started,
    channel: options.channel,
    mode: options.mode,
    use_turbo: options.useTurbo,
    include_response: options.mode === "detailed",
    successes: 0,
    failures: 1,
    status: 0,
    results: [],
  }
  try {
    if (options.useTurbo && candidateIds(snapshot.proxy).length === 0)
      throw new ProxyProbeError("accelerator_required")
    const candidates = options.useTurbo ? paths(snapshot.proxy, snapshot.nodes) : [[snapshot.proxy]]
    let attempts = 0
    for (const path of candidates) {
      const remaining = 25000 - (Date.now() - started)
      if (remaining < 1000 || attempts++ >= 10) break
      try {
        const checked = await transport.query(
          path.map((proxy) => ({
            proxy,
            secret: decrypt(proxy.encryptedCredentials),
          })),
          options,
          Math.min(10000, remaining),
        )
        const expected = snapshot.proxy.configuration?.region.split(",").filter(Boolean) ?? []
        const ok = expected.length === 0 || expected.includes(checked.information.country)
        return {
          ...result,
          ok,
          message: ok ? "成功" : "proxy_region_mismatch",
          status: 200,
          successes: ok ? 1 : 0,
          failures: ok ? 0 : 1,
          accelerator_id: path[1]?.id ?? null,
          results: [
            {
              ok,
              delay: checked.delay,
              status: 200,
              url: ProbeProviders[options.channel],
              response_body: checked.information,
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
