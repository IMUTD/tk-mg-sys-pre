import { GroupIdSchema, type UserId } from "../../lib/authorization"
import type { SecretCipher } from "../../lib/crypto"
import type { AuditRepository } from "../audit/service"
import { writeAuditEvent } from "../audit/service"
import {
  type OperationProxy,
  type ProxyCreateInput,
  type ProxyFilter,
  ProxyIdSchema,
  type ProxyPage,
  type ProxyRepository,
  type ProxyUpdateInput,
  toPublicProxy,
} from "./repository"

type Dependencies = {
  readonly auditRepository?: AuditRepository
  readonly cipher: SecretCipher
  readonly repository: ProxyRepository
}
export interface ProxyService {
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
export const createProxyService = (dependencies: Dependencies): ProxyService => ({
  create: async (actorId, rawGroupId, input) => {
    const proxy = await dependencies.repository.create({
      ...input,
      encryptedCredentials: dependencies.cipher.encrypt(input.credentials),
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
    const credentials =
      input.credentials === undefined
        ? {}
        : { encryptedCredentials: dependencies.cipher.encrypt(input.credentials) }
    const proxy = await dependencies.repository.update(
      GroupIdSchema.parse(rawGroupId),
      ProxyIdSchema.parse(rawProxyId),
      { ...input, ...credentials },
    )
    if (proxy !== null)
      await audit(dependencies.auditRepository, actorId, "proxy.update", `proxy:${proxy.id}`)
    return proxy === null ? null : toPublicProxy(proxy)
  },
})
