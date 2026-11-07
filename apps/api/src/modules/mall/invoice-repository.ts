import type { Sql, TransactionSql } from "postgres"
import {
  type InvoiceCreateInput,
  type InvoiceFile,
  type InvoiceFilter,
  type InvoiceIssueInput,
  type InvoiceQuota,
  MallError,
  type MallInvoice,
  type Page,
  yuanToCents,
} from "./model"
import { lockWallet } from "./wallet-lock"

export type InvoiceRepository = {
  createInvoice(
    actorId: string,
    groupId: string,
    input: InvoiceCreateInput,
  ): Promise<{ readonly invoice: MallInvoice; readonly replayed: boolean }>
  invoiceFile(invoiceId: string, groupId?: string): Promise<InvoiceFile>
  invoiceQuota(groupId: string): Promise<InvoiceQuota>
  issueInvoice(
    actorId: string,
    invoiceId: string,
    input: InvoiceIssueInput,
  ): Promise<{ readonly invoice: MallInvoice; readonly replayed: boolean }>
  listInvoices(filter: InvoiceFilter): Promise<Page<MallInvoice>>
  rejectInvoice(
    actorId: string,
    invoiceId: string,
    reason: string,
  ): Promise<{ readonly invoice: MallInvoice; readonly replayed: boolean }>
}

type InvoiceRow = Omit<MallInvoice, "amountCents" | "createdAt" | "reviewedAt" | "updatedAt"> & {
  readonly amountCents: string
  readonly createdAt: Date
  readonly reviewedAt: Date | null
  readonly updatedAt: Date
}

const COLUMNS = (client: Sql) => client`
  i.id, i.group_id as "groupId", g.name as "groupName", i.amount_cents as "amountCents",
  i.invoice_type as "invoiceType", i.title_type as "titleType", i.title, i.tax_number as "taxNumber",
  i.remark, i.status, i.invoice_number as "invoiceNumber", i.reject_reason as "rejectReason",
  i.reviewed_at as "reviewedAt", i.created_at as "createdAt", i.updated_at as "updatedAt",
  coalesce(nullif(u.display_name, ''), u.email) as "applicantName",
  exists (select 1 from mall_invoice_file f where f.invoice_id = i.id) as "hasFile"
`

const toInvoice = (row: InvoiceRow): MallInvoice => ({
  ...row,
  amountCents: Number(row.amountCents),
  createdAt: row.createdAt.toISOString(),
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
})

const likePattern = (value: string): string => `%${value.replace(/[\\%_]/g, "\\$&")}%`

/** 可开票额度：真实收到的钱（人工和支付宝充值），减去待审和已开的发票。驳回的额度退回。 */
const quotaOf = async (client: Sql | TransactionSql, groupId: string): Promise<InvoiceQuota> => {
  const rows = await client<{ readonly invoiced: string; readonly paid: string }[]>`
    select
      coalesce((
        select sum(amount_cents) from mall_order
        where group_id = ${groupId} and type = 'points' and status = 'paid'
      ), 0) as paid,
      coalesce((
        select sum(amount_cents) from mall_invoice
        where group_id = ${groupId} and status in ('pending', 'issued')
      ), 0) as invoiced
  `
  const paid = Number(rows[0]?.paid ?? 0)
  const invoiced = Number(rows[0]?.invoiced ?? 0)
  return { availableCents: Math.max(paid - invoiced, 0), invoicedCents: invoiced, paidCents: paid }
}

export const createPostgresInvoiceRepository = (client: Sql): InvoiceRepository => {
  const load = async (
    invoiceId: string,
    sql: Sql | TransactionSql = client,
  ): Promise<MallInvoice> => {
    const rows = await sql<InvoiceRow[]>`
      select ${COLUMNS(client)}
      from mall_invoice i
      join access_group g on g.id = i.group_id
      join app_user u on u.id = i.created_by
      where i.id = ${invoiceId}
    `
    const row = rows[0]
    if (row === undefined) throw new MallError("invoice_not_found")
    return toInvoice(row)
  }

  return {
    createInvoice: (actorId, groupId, input) =>
      client.begin(async (transaction) => {
        const amountCents = yuanToCents(input.amountYuan)
        // 和入账共用钱包锁，并发申请不会一起越过额度。
        await lockWallet(transaction, groupId)
        const existing = await transaction<{ readonly amountCents: string; readonly id: string }[]>`
          select id, amount_cents as "amountCents" from mall_invoice
          where group_id = ${groupId} and idempotency_key = ${input.idempotencyKey}
        `
        const replay = existing[0]
        if (replay !== undefined) {
          if (Number(replay.amountCents) !== amountCents) {
            throw new MallError("idempotency_conflict")
          }
          return { invoice: await load(replay.id, transaction), replayed: true }
        }
        const quota = await quotaOf(transaction, groupId)
        if (amountCents > quota.availableCents) throw new MallError("invoice_over_quota")
        const rows = await transaction<{ readonly id: string }[]>`
          insert into mall_invoice
            (group_id, created_by, amount_cents, invoice_type, title_type, title, tax_number, remark,
             idempotency_key)
          values
            (${groupId}, ${actorId}, ${amountCents}, ${input.invoiceType}, ${input.titleType},
             ${input.title}, ${input.taxNumber}, ${input.remark}, ${input.idempotencyKey})
          returning id
        `
        return { invoice: await load(rows[0]?.id ?? "", transaction), replayed: false }
      }),
    invoiceFile: async (invoiceId, groupId) => {
      const rows = await client<
        { readonly content: Uint8Array; readonly fileName: string; readonly groupId: string }[]
      >`
        select f.content, f.file_name as "fileName", i.group_id as "groupId"
        from mall_invoice_file f
        join mall_invoice i on i.id = f.invoice_id
        where f.invoice_id = ${invoiceId}
      `
      const row = rows[0]
      if (row === undefined || (groupId !== undefined && row.groupId !== groupId)) {
        throw new MallError("invoice_not_found")
      }
      return { content: row.content, fileName: row.fileName }
    },
    invoiceQuota: (groupId) => quotaOf(client, groupId),
    issueInvoice: (actorId, invoiceId, input) =>
      client.begin(async (transaction) => {
        const rows = await transaction<
          { readonly invoiceNumber: string; readonly status: MallInvoice["status"] }[]
        >`
          select status, invoice_number as "invoiceNumber" from mall_invoice
          where id = ${invoiceId} for update
        `
        const current = rows[0]
        if (current === undefined) throw new MallError("invoice_not_found")
        if (current.status === "issued" && current.invoiceNumber === input.invoiceNumber) {
          // 上次可能是响应丢了，也可能当时没传文件。重试带了文件就补上，已有的不覆盖。
          if (input.file !== null) {
            await transaction`
              insert into mall_invoice_file (invoice_id, file_name, content)
              values (${invoiceId}, ${input.file.fileName}, ${Buffer.from(input.file.content)})
              on conflict (invoice_id) do nothing
            `
          }
          return { invoice: await load(invoiceId, transaction), replayed: true }
        }
        if (current.status !== "pending") throw new MallError("invoice_not_pending")
        await transaction`
          update mall_invoice
          set status = 'issued', invoice_number = ${input.invoiceNumber}, reviewed_by = ${actorId},
              reviewed_at = now(), updated_at = now()
          where id = ${invoiceId}
        `
        if (input.file !== null) {
          await transaction`
            insert into mall_invoice_file (invoice_id, file_name, content)
            values (${invoiceId}, ${input.file.fileName}, ${Buffer.from(input.file.content)})
          `
        }
        return { invoice: await load(invoiceId, transaction), replayed: false }
      }),
    listInvoices: async (filter) => {
      const pattern =
        filter.keyword === undefined || filter.keyword.length === 0
          ? null
          : likePattern(filter.keyword)
      const conditions = client`
        where true
        ${filter.groupId === undefined ? client`` : client`and i.group_id = ${filter.groupId}`}
        ${filter.status === undefined ? client`` : client`and i.status = ${filter.status}`}
        ${filter.invoiceType === undefined ? client`` : client`and i.invoice_type = ${filter.invoiceType}`}
        ${filter.titleType === undefined ? client`` : client`and i.title_type = ${filter.titleType}`}
        ${
          pattern === null
            ? client``
            : client`and (i.title ilike ${pattern} or i.tax_number ilike ${pattern}
                or i.invoice_number ilike ${pattern})`
        }
      `
      const [rows, totals] = await Promise.all([
        client<InvoiceRow[]>`
          select ${COLUMNS(client)}
          from mall_invoice i
          join access_group g on g.id = i.group_id
          join app_user u on u.id = i.created_by
          ${conditions}
          order by i.created_at desc, i.id desc
          limit ${filter.pageSize} offset ${(filter.page - 1) * filter.pageSize}
        `,
        client<{ readonly total: string }[]>`
          select count(*) as total from mall_invoice i ${conditions}
        `,
      ])
      return { items: rows.map(toInvoice), total: Number(totals[0]?.total ?? 0) }
    },
    rejectInvoice: (actorId, invoiceId, reason) =>
      client.begin(async (transaction) => {
        const rows = await transaction<{ readonly status: MallInvoice["status"] }[]>`
          select status from mall_invoice where id = ${invoiceId} for update
        `
        const current = rows[0]
        if (current === undefined) throw new MallError("invoice_not_found")
        if (current.status === "rejected") {
          return { invoice: await load(invoiceId, transaction), replayed: true }
        }
        if (current.status !== "pending") throw new MallError("invoice_not_pending")
        await transaction`
          update mall_invoice
          set status = 'rejected', reject_reason = ${reason}, reviewed_by = ${actorId},
              reviewed_at = now(), updated_at = now()
          where id = ${invoiceId}
        `
        return { invoice: await load(invoiceId, transaction), replayed: false }
      }),
  }
}
