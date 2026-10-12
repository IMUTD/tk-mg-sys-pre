import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type DetectOptions,
  legacyConfiguration,
  normalizeConfiguration,
  type ProxyCheck,
  type ProxySecret,
  parseCredentials,
  proxyEndpoint,
} from "./configuration"
import { detectDial, type RelayProbeTransport } from "./mihomo-probe"
import { ProxyProbeError } from "./probe"
import {
  type OperationProxy,
  ProxyConflictError,
  type ProxyCreateInput,
  type ProxyFilter,
  ProxyIdSchema,
  type ProxyPage,
  type ProxyRepository,
  type ProxyUpdateInput,
  type StoredProxy,
  toPublicProxy,
} from "./repository"

type Dependencies = {
  readonly auditRepository?: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: ProxyRepository
  readonly dialTransport?: RelayProbeTransport
}
export interface ProxyService {
  credentials?(actorId: UserId, groupId: string, proxyId: string): Promise<ProxySecret | null>
  detect?(
    actorId: UserId,
    groupId: string,
    proxyId: string,
    options: DetectOptions,
  ): Promise<ProxyCheck | null>
  create(
    actorId: UserId,
    groupId: string,
    input: Omit<ProxyCreateInput, "groupId"> & { readonly credentials: string },
  ): Promise<OperationProxy>
  delete(actorId: UserId, groupId: string, ids: readonly string[]): Promise<number>
  list(filter: Omit<ProxyFilter, "groupId"> & { readonly groupId: string }): Promise<ProxyPage>
  update(
    actorId: UserId,
    groupId: string,
    proxyId: string,
    input: ProxyUpdateInput & { readonly credentials?: string | undefined },
  ): Promise<OperationProxy | null>
}
const audit = async (
  repo: AuditRepository | undefined,
  actorId: UserId,
  action: string,
  target: string,
): Promise<void> => {
  if (repo !== undefined)
    await writeAuditEvent(repo, { action, actorId, outcome: "allowed", target })
}
const encryptCredentials = (cipher: SecretCipher, secret: ProxySecret): string =>
  secret.username === "" &&
  secret.password === "" &&
  secret.extra === "" &&
  (secret.refreshUrl ?? "") === ""
    ? ""
    : cipher.encrypt(JSON.stringify(secret))
const storedCredentials = (cipher: SecretCipher, proxy: StoredProxy): ProxySecret => {
  const secret = parseCredentials(
    proxy.encryptedCredentials === "" ? "" : cipher.decrypt(proxy.encryptedCredentials),
  )
  return { ...secret, refreshUrl: secret.refreshUrl || proxy.configuration?.refreshUrl || "" }
}
export const createProxyService = (dependencies: Dependencies): ProxyService => ({
  create: async (actorId, rawGroupId, input) => {
    const rawConfiguration = input.configuration ?? legacyConfiguration(input.endpoint)
    const parsed = parseCredentials(input.credentials)
    const secret = { ...parsed, refreshUrl: parsed.refreshUrl ?? rawConfiguration.refreshUrl }
    const configuration = normalizeConfiguration({ ...rawConfiguration, refreshUrl: "" }, secret)
    const proxy = await dependencies.repository.create({
      ...input,
      configuration,
      endpoint: proxyEndpoint(configuration),
      encryptedCredentials: encryptCredentials(dependencies.cipher, secret),
      groupId: GroupIdSchema.parse(rawGroupId),
    })
    await audit(dependencies.auditRepository, actorId, "proxy.create", `proxy:${proxy.id}`)
    return toPublicProxy(proxy)
  },
  delete: async (actorId, rawGroupId, ids) => {
    const count = await dependencies.repository.delete(
      GroupIdSchema.parse(rawGroupId),
      ids.map((id) => ProxyIdSchema.parse(id)),
    )
    await audit(dependencies.auditRepository, actorId, "proxy.delete", `group:${rawGroupId}`)
    return count
  },
  list: async (filter) =>
    dependencies.repository.list({ ...filter, groupId: GroupIdSchema.parse(filter.groupId) }),
  update: async (actorId, rawGroupId, rawProxyId, input) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const proxyId = ProxyIdSchema.parse(rawProxyId)
    const current = await dependencies.repository.get?.(groupId, proxyId)
    if (current === null) return null
    const currentSecret =
      current === undefined ? undefined : storedCredentials(dependencies.cipher, current)
    const suppliedSecret =
      input.credentials === undefined ? undefined : parseCredentials(input.credentials)
    let secret =
      suppliedSecret === undefined
        ? currentSecret
        : {
            ...suppliedSecret,
            refreshUrl: suppliedSecret.refreshUrl ?? currentSecret?.refreshUrl ?? "",
          }
    if (suppliedSecret?.refreshUrl === undefined && input.configuration?.refreshUrl) {
      secret = { ...(secret ?? parseCredentials("")), refreshUrl: input.configuration.refreshUrl }
    }
    const legacyRefreshUrl = (current?.configuration?.refreshUrl.length ?? 0) > 0
    const configuration =
      input.configuration === undefined &&
      input.endpoint === undefined &&
      input.credentials === undefined &&
      !legacyRefreshUrl
        ? undefined
        : normalizeConfiguration(
            {
              ...(input.configuration ??
                (input.endpoint === undefined
                  ? (current?.configuration ?? legacyConfiguration(current?.endpoint ?? ""))
                  : legacyConfiguration(input.endpoint))),
              refreshUrl: "",
            },
            secret,
          )
    const credentials =
      input.credentials === undefined && !input.configuration?.refreshUrl && !legacyRefreshUrl
        ? {}
        : {
            encryptedCredentials:
              current !== undefined &&
              secret?.username === currentSecret?.username &&
              secret?.password === currentSecret?.password &&
              secret?.extra === currentSecret?.extra &&
              secret?.refreshUrl === currentSecret?.refreshUrl &&
              !legacyRefreshUrl
                ? current.encryptedCredentials
                : encryptCredentials(dependencies.cipher, secret ?? parseCredentials("")),
          }
    const proxy = await dependencies.repository.update(groupId, proxyId, {
      ...input,
      ...credentials,
      expectedRevision:
        input.expectedRevision ?? (configuration === undefined ? undefined : current?.revision),
      ...(configuration === undefined
        ? {}
        : {
            configuration,
            endpoint: proxyEndpoint(configuration),
          }),
    })
    if (proxy !== null)
      await audit(dependencies.auditRepository, actorId, "proxy.update", `proxy:${proxy.id}`)
    return proxy === null ? null : toPublicProxy(proxy)
  },
  credentials: async (actorId, rawGroupId, rawProxyId) => {
    const proxy = await dependencies.repository.get?.(
      GroupIdSchema.parse(rawGroupId),
      ProxyIdSchema.parse(rawProxyId),
    )
    if (proxy === undefined || proxy === null) return null
    await audit(dependencies.auditRepository, actorId, "proxy.credentials", `proxy:${proxy.id}`)
    return storedCredentials(dependencies.cipher, proxy)
  },
  detect: async (actorId, rawGroupId, rawProxyId, options) => {
    const groupId = GroupIdSchema.parse(rawGroupId)
    const snapshot = await dependencies.repository.startProbe?.(
      groupId,
      ProxyIdSchema.parse(rawProxyId),
      true,
    )
    if (snapshot === undefined || snapshot === null) return null
    const transport = dependencies.dialTransport ?? {
      query: async () => {
        throw new ProxyProbeError("probe_start_failed")
      },
    }
    const result = await detectDial(snapshot, options, transport, (proxy) =>
      storedCredentials(dependencies.cipher, proxy),
    )
    const persisted = await dependencies.repository.finishProbe?.(groupId, snapshot, result)
    await audit(dependencies.auditRepository, actorId, "proxy.detect", `proxy:${snapshot.proxy.id}`)
    if (!persisted) {
      throw new ProxyConflictError("proxy_configuration_changed")
    }
    return result
  },
})
