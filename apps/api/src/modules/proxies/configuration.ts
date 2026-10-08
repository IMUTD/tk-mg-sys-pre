import { isIP } from "node:net"
import { z } from "zod"

export const ProxyConfigurationSchema = z.strictObject({
  protocol: z.enum(["http", "socks5", "v2"]).default("socks5"),
  host: z.string().trim().max(253).default(""),
  port: z.number().int().min(1).max(65535).default(1080),
  kind: z.enum(["static", "dynamic"]).default("static"),
  save: z.boolean().default(false),
  tun: z.boolean().default(false),
  safe: z.boolean().default(false),
  turbo: z.boolean().default(false),
  acceleratorId: z.string().uuid().nullable().default(null),
  acceleratorIds: z.array(z.string().uuid()).max(10).default([]),
  region: z
    .string()
    .trim()
    .regex(/^([A-Za-z]{2}(,[A-Za-z]{2})*)?$/)
    .default(""),
  expiredAt: z.iso.datetime({ offset: true }).nullable().default(null),
  refreshUrl: z.string().max(2000).default(""),
  favorite: z.boolean().default(false),
  v2Protocol: z.enum(["vmess", "vless"]).nullable().default(null),
})
export type ProxyConfiguration = z.infer<typeof ProxyConfigurationSchema>
export const ProxySecretSchema = z.strictObject({
  username: z.string().max(512).default(""),
  password: z.string().max(512).default(""),
  extra: z.string().max(20000).default(""),
  refreshUrl: z.string().max(2000).optional(),
})
export type ProxySecret = z.infer<typeof ProxySecretSchema>
export class ProxyConfigurationError extends Error {
  constructor(public readonly code = "invalid_proxy_configuration") {
    super(code)
    this.name = "ProxyConfigurationError"
  }
}

export const parseCredentials = (raw: string): ProxySecret => {
  if (raw.startsWith("{")) {
    const result = ProxySecretSchema.safeParse(JSON.parse(raw))
    if (!result.success) throw new ProxyConfigurationError()
    return result.data
  }
  const separator = raw.indexOf(":")
  return {
    username: separator < 0 ? raw : raw.slice(0, separator),
    password: separator < 0 ? "" : raw.slice(separator + 1),
    extra: "",
  }
}

export const validHost = (host: string): boolean =>
  isIP(host) !== 0 ||
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i.test(host)

// Only a whitelisted outbound is accepted, never an executable/full sing-box config.
const OutboundSchema = z.strictObject({
  type: z.enum(["vmess", "vless"]),
  server: z.string().min(1).max(253),
  server_port: z.number().int().min(1).max(65535),
  uuid: z.string().uuid(),
  security: z.enum(["auto", "none", "zero", "aes-128-gcm", "chacha20-poly1305"]).optional(),
  alter_id: z.number().int().min(0).max(65535).optional(),
  flow: z.enum(["", "xtls-rprx-vision"]).optional(),
  tls: z
    .strictObject({
      enabled: z.boolean(),
      server_name: z.string().max(253).optional(),
      utls: z
        .strictObject({
          enabled: z.boolean(),
          fingerprint: z.enum([
            "chrome",
            "firefox",
            "edge",
            "safari",
            "ios",
            "android",
            "random",
            "randomized",
          ]),
        })
        .optional(),
      reality: z
        .strictObject({
          enabled: z.boolean(),
          public_key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          short_id: z.string().regex(/^(?:[0-9a-fA-F]{2}){0,8}$/),
        })
        .optional(),
    })
    .optional(),
  transport: z
    .discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("ws"),
        path: z.string().max(2000).optional(),
        headers: z.strictObject({ Host: z.string().max(253) }).optional(),
      }),
      z.strictObject({ type: z.literal("grpc"), service_name: z.string().max(2000).optional() }),
    ])
    .optional(),
})
export type V2Outbound = z.infer<typeof OutboundSchema>

export const parseV2Outbound = (raw: string): V2Outbound => {
  try {
    let candidate: unknown
    if (raw.startsWith("{")) {
      candidate = JSON.parse(raw)
    } else if (raw.startsWith("vmess://")) {
      const link = z
        .object({
          add: z.string(),
          port: z.coerce.number(),
          id: z.string(),
          aid: z.coerce.number().default(0),
          scy: z.string().default("auto"),
          net: z.enum(["tcp", "ws", "grpc"]).default("tcp"),
          tls: z.enum(["", "tls"]).default(""),
          sni: z.string().default(""),
          host: z.string().default(""),
          path: z.string().default(""),
        })
        .parse(JSON.parse(Buffer.from(raw.slice(8), "base64").toString("utf8")))
      candidate = {
        type: "vmess",
        server: link.add,
        server_port: link.port,
        uuid: link.id,
        security: link.scy,
        alter_id: link.aid,
        ...(link.tls === "tls"
          ? { tls: { enabled: true, server_name: link.sni || link.add } }
          : {}),
        ...(link.net === "ws"
          ? {
              transport: {
                type: "ws",
                path: link.path || "/",
                ...(link.host ? { headers: { Host: link.host } } : {}),
              },
            }
          : {}),
        ...(link.net === "grpc" ? { transport: { type: "grpc", service_name: link.path } } : {}),
      }
    } else {
      const link = new URL(raw)
      if (link.protocol !== "vless:") throw new ProxyConfigurationError()
      const parameters = link.searchParams
      const network = parameters.get("type") ?? "tcp"
      const security = parameters.get("security") ?? "none"
      if (
        !["tcp", "ws", "grpc"].includes(network) ||
        !["none", "tls", "reality"].includes(security)
      )
        throw new ProxyConfigurationError("unsupported_v2_transport")
      candidate = {
        type: "vless",
        server: link.hostname.replace(/^\[|\]$/g, ""),
        server_port: Number(link.port || 443),
        uuid: decodeURIComponent(link.username),
        ...(parameters.get("flow") ? { flow: parameters.get("flow") } : {}),
        ...(security !== "none"
          ? {
              tls: {
                enabled: true,
                server_name: parameters.get("sni") || link.hostname,
                ...(parameters.get("fp")
                  ? { utls: { enabled: true, fingerprint: parameters.get("fp") } }
                  : {}),
                ...(security === "reality"
                  ? {
                      reality: {
                        enabled: true,
                        public_key: parameters.get("pbk"),
                        short_id: parameters.get("sid") ?? "",
                      },
                    }
                  : {}),
              },
            }
          : {}),
        ...(network === "ws"
          ? {
              transport: {
                type: "ws",
                path: parameters.get("path") || "/",
                ...(parameters.get("host") ? { headers: { Host: parameters.get("host") } } : {}),
              },
            }
          : {}),
        ...(network === "grpc"
          ? {
              transport: {
                type: "grpc",
                service_name: parameters.get("serviceName") ?? "",
              },
            }
          : {}),
      }
    }
    const result = OutboundSchema.parse(candidate)
    if (!validHost(result.server)) throw new ProxyConfigurationError()
    if (result.type === "vless" && (result.security !== undefined || result.alter_id !== undefined))
      throw new ProxyConfigurationError()
    if (result.type === "vmess" && result.flow !== undefined) throw new ProxyConfigurationError()
    return result
  } catch (error) {
    if (error instanceof ProxyConfigurationError) throw error
    throw new ProxyConfigurationError("invalid_v2_configuration")
  }
}

export const legacyConfiguration = (endpoint: string): ProxyConfiguration => {
  try {
    const url = new URL(endpoint.includes("://") ? endpoint : `socks5://${endpoint}`)
    return ProxyConfigurationSchema.parse({
      protocol: url.protocol === "http:" || url.protocol === "https:" ? "http" : "socks5",
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || (url.protocol === "http:" ? 80 : 1080)),
    })
  } catch {
    throw new ProxyConfigurationError()
  }
}
export const normalizeConfiguration = (
  configuration: ProxyConfiguration,
  secret?: ProxySecret,
): ProxyConfiguration => {
  let next = { ...configuration, region: configuration.region.toUpperCase() }
  if (next.protocol === "v2") {
    next = { ...next, turbo: true, kind: "static", save: false }
    if (secret !== undefined) {
      const outbound = parseV2Outbound(secret.extra)
      next = {
        ...next,
        host: outbound.server,
        port: outbound.server_port,
        v2Protocol: outbound.type,
      }
    }
    if (next.v2Protocol === null) throw new ProxyConfigurationError("v2_credentials_required")
  } else {
    next.v2Protocol = null
  }
  if (!validHost(next.host)) throw new ProxyConfigurationError("invalid_proxy_host")
  return next
}
export const proxyEndpoint = (configuration: ProxyConfiguration): string =>
  `${configuration.host.includes(":") ? `[${configuration.host}]` : configuration.host}:${configuration.port}`

export const ProxyCheckSchema = z.object({
  detection_type: z.enum(["ip_lookup", "proxy_connectivity"]).optional(),
  target_ip: z.string().optional(),
  connectivity_checked: z.boolean().optional(),
  ok: z.boolean(),
  message: z.string(),
  check_time: z.number(),
  channel: z.enum(["cn", "us"]),
  mode: z.enum(["quick", "detailed"]),
  use_turbo: z.boolean(),
  include_response: z.boolean(),
  successes: z.number(),
  failures: z.number(),
  status: z.number(),
  results: z.array(
    z.object({
      ok: z.boolean(),
      delay: z.number(),
      status: z.number(),
      url: z.string(),
      response_body: z
        .object({
          ip: z.string(),
          country: z.string(),
          countryName: z.string().optional(),
          region: z.string().optional(),
          city: z.string().optional(),
          isp: z.string().optional(),
          asn: z.string().optional(),
        })
        .optional(),
    }),
  ),
  accelerator_id: z.string().uuid().nullable().optional(),
})
export type ProxyCheck = z.infer<typeof ProxyCheckSchema>
export const DetectOptionsSchema = z.strictObject({
  channel: z.enum(["cn", "us"]).default("us"),
  mode: z.enum(["quick", "detailed"]).default("quick"),
  useTurbo: z.boolean().default(false),
})
export type DetectOptions = z.infer<typeof DetectOptionsSchema>
