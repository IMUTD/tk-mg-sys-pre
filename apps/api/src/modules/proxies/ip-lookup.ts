import { setTimeout as sleep } from "node:timers/promises"
import ipaddr from "ipaddr.js"
import type { DetectOptions, ProxyCheck } from "./configuration"
import {
  boundedJson,
  isPublicIp,
  normalizeIpInformation,
  ProbeProviders,
  ProxyProbeError,
  resolvePublicHost,
} from "./probe"
import type { ProbeSnapshot } from "./repository"

type Information = NonNullable<ProxyCheck["results"][number]["response_body"]>
export interface IpLookupTransport {
  close?(): Promise<void>
  query(
    ip: string,
    options: DetectOptions,
    timeoutMs: number,
  ): Promise<{
    readonly information: Information
    readonly delay: number
  }>
}
export const ipLookupUrl = (ip: string, channel: DetectOptions["channel"]): string => {
  if (!isPublicIp(ip)) throw new ProxyProbeError("proxy_address_not_public")
  const url = new URL(ProbeProviders[channel])
  if (channel === "us") url.searchParams.set("q", ip)
  else url.pathname += `/${encodeURIComponent(ip)}`
  return url.toString()
}
const sameIp = (left: string, right: string): boolean =>
  ipaddr.process(left).toString() === ipaddr.process(right).toString()

const resolveIp = async (host: string, resolve: typeof resolvePublicHost): Promise<string> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ProxyProbeError("ip_lookup_timeout")), 5000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export const createIpLookupTransport = (
  request: (url: string, options: RequestInit) => Promise<Response> = fetch,
  intervalMs = 750,
): IpLookupTransport => {
  const controllers = new Set<AbortController>()
  const cooldowns = new Map<DetectOptions["channel"], number>()
  let nextStart = 0
  let closed = false
  return {
    close: async () => {
      closed = true
      for (const controller of controllers) controller.abort()
    },
    query: async (ip, options, timeoutMs) => {
      const url = ipLookupUrl(ip, options.channel)
      if (closed || controllers.size >= 4) throw new ProxyProbeError("probe_capacity_exceeded")
      if ((cooldowns.get(options.channel) ?? 0) > Date.now())
        throw new ProxyProbeError("ip_provider_rate_limited")
      const controller = new AbortController()
      controllers.add(controller)
      const started = Date.now()
      const wait = Math.max(0, nextStart - started)
      nextStart = started + wait + intervalMs
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        if (wait > 0) await sleep(wait, undefined, { signal: controller.signal })
        if ((cooldowns.get(options.channel) ?? 0) > Date.now())
          throw new ProxyProbeError("ip_provider_rate_limited")
        const response = await request(url, {
          redirect: "error",
          signal: controller.signal,
          headers: { "User-Agent": "tk-mg-ip-information/1.0", Accept: "application/json" },
        })
        if (!response.ok) {
          await response.body?.cancel()
          if (response.status === 429) {
            const value = response.headers.get("retry-after") ?? ""
            const seconds = /^\d+$/.test(value) ? Number(value) : 0
            const until = seconds > 0 ? Date.now() + seconds * 1000 : Date.parse(value)
            cooldowns.set(options.channel, Math.max(Date.now() + 10000, until || 0))
            throw new ProxyProbeError("ip_provider_rate_limited")
          }
          throw new ProxyProbeError("ip_provider_failed")
        }
        const information = normalizeIpInformation(options.channel, await boundedJson(response))
        // Reject a provider accidentally returning the server's own address.
        if (!sameIp(information.ip, ip)) throw new ProxyProbeError("ip_information_mismatch")
        return { information, delay: Date.now() - started }
      } catch (error) {
        if (error instanceof ProxyProbeError) throw error
        if (controller.signal.aborted) throw new ProxyProbeError("ip_lookup_timeout")
        throw new ProxyProbeError("ip_information_failed")
      } finally {
        clearTimeout(timer)
        controllers.delete(controller)
      }
    },
  }
}

export const detectProxyIp = async (
  snapshot: ProbeSnapshot,
  options: DetectOptions,
  transport: IpLookupTransport,
  resolve = resolvePublicHost,
): Promise<ProxyCheck> => {
  const result: ProxyCheck = {
    detection_type: "ip_lookup",
    connectivity_checked: false,
    ok: false,
    message: "ip_information_failed",
    check_time: Date.now(),
    channel: options.channel,
    mode: options.mode,
    use_turbo: false,
    accelerator_id: null,
    include_response: options.mode === "detailed",
    successes: 0,
    failures: 1,
    status: 0,
    results: [],
  }
  try {
    const configuration = snapshot.proxy.configuration
    if (configuration === undefined) throw new ProxyProbeError("invalid_proxy_configuration")
    const ip = await resolveIp(configuration.host, resolve)
    if (!isPublicIp(ip)) throw new ProxyProbeError("proxy_address_not_public")
    result.target_ip = ip
    const checked = await transport.query(ip, options, 10000)
    if (!isPublicIp(checked.information.ip) || !sameIp(checked.information.ip, ip))
      throw new ProxyProbeError("ip_information_mismatch")
    const expected = configuration.region.split(",").filter(Boolean)
    const ok = expected.length === 0 || expected.includes(checked.information.country)
    return {
      ...result,
      ok,
      message: ok ? "ip_information_found" : "proxy_region_mismatch",
      successes: ok ? 1 : 0,
      failures: ok ? 0 : 1,
      status: 200,
      results: [
        {
          ok,
          delay: checked.delay,
          status: 200,
          url: ipLookupUrl(ip, options.channel),
          response_body: checked.information,
        },
      ],
    }
  } catch (error) {
    result.message = error instanceof ProxyProbeError ? error.code : "ip_information_failed"
    if (result.message === "ip_provider_rate_limited") result.status = 429
    return result
  }
}
