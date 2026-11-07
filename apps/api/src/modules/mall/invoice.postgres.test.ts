import { afterEach, describe, expect, it } from "bun:test"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { MallError, type MallErrorCode } from "./model"
import { createPostgresMallRepository } from "./repository"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const groupA = "11111111-1111-4111-8111-111111111111"
const groupB = "22222222-2222-4222-8222-222222222222"
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})

const setup = async (rechargeYuan = "100") => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  await sql`insert into access_group(id,name) values (${groupA},'一组'),(${groupB},'二组')`
  await sql`insert into app_user(id,email,display_name,password_hash,role)
    values (${actor},'a@example.test','一组管理员','unused','administrator')`
  const repository = createPostgresMallRepository(sql)
  await repository.recharge(actor, {
    amountYuan: rechargeYuan,
    groupId: groupA,
    idempotencyKey: crypto.randomUUID(),
    remark: "打款",
  })
  return { repository, sql }
}

const company = (amountYuan: string, idempotencyKey: string = crypto.randomUUID()) => ({
  amountYuan,
  idempotencyKey,
  invoiceType: "normal" as const,
  remark: "",
  taxNumber: "91310000MA1K123456",
  title: "上海某公司",
  titleType: "company" as const,
})

const expectCode = async (run: Promise<unknown>, code: MallErrorCode) => {
  try {
    await run
  } catch (error) {
    if (error instanceof MallError) {
      expect(error.code).toBe(code)
      return
    }
    throw error
  }
  throw new Error(`expected ${code}`)
}

describe("invoice PostgreSQL", () => {
  databaseTest(
    "limits requests to money actually received and frees a rejected amount",
    async () => {
      const { repository } = await setup("100")
      expect(await repository.invoiceQuota(groupA)).toEqual({
        availableCents: 10000,
        invoicedCents: 0,
        paidCents: 10000,
      })
      const { invoice } = await repository.createInvoice(actor, groupA, company("60"))
      expect(invoice).toMatchObject({
        amountCents: 6000,
        applicantName: "一组管理员",
        groupName: "一组",
        hasFile: false,
        status: "pending",
      })
      await expectCode(
        repository.createInvoice(actor, groupA, company("40.01")),
        "invoice_over_quota",
      )
      await repository.rejectInvoice(actor, invoice.id, "抬头不对")
      expect((await repository.invoiceQuota(groupA)).availableCents).toBe(10000)
      // 另一个分组没有收过钱，不能开票。
      await expectCode(repository.createInvoice(actor, groupB, company("1")), "invoice_over_quota")
    },
    60000,
  )

  databaseTest(
    "does not count points given by adjustment or spending",
    async () => {
      const { repository } = await setup("100")
      await repository.adjust(actor, {
        delta: 50000,
        groupId: groupA,
        idempotencyKey: crypto.randomUUID(),
        remark: "赠送",
      })
      expect((await repository.invoiceQuota(groupA)).paidCents).toBe(10000)
    },
    60000,
  )

  databaseTest(
    "cannot go over quota under concurrent requests and replays one key",
    async () => {
      const { repository } = await setup("100")
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, () => repository.createInvoice(actor, groupA, company("30"))),
      )
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(3)
      expect((await repository.invoiceQuota(groupA)).availableCents).toBe(1000)

      const key = crypto.randomUUID()
      const first = await repository.createInvoice(actor, groupA, company("5", key))
      const again = await repository.createInvoice(actor, groupA, company("5", key))
      expect(again).toMatchObject({ invoice: { id: first.invoice.id }, replayed: true })
      await expectCode(
        repository.createInvoice(actor, groupA, company("6", key)),
        "idempotency_conflict",
      )
    },
    60000,
  )

  databaseTest(
    "issues once with its file and only from pending",
    async () => {
      const { repository } = await setup()
      const { invoice } = await repository.createInvoice(actor, groupA, company("10"))
      const content = new TextEncoder().encode("%PDF-1.7 fixture")
      const issued = await repository.issueInvoice(actor, invoice.id, {
        file: { content, fileName: "发票-N1.pdf" },
        invoiceNumber: "N1",
      })
      expect(issued).toMatchObject({
        invoice: { hasFile: true, invoiceNumber: "N1", status: "issued" },
        replayed: false,
      })
      expect(
        await repository.issueInvoice(actor, invoice.id, { file: null, invoiceNumber: "N1" }),
      ).toMatchObject({ replayed: true })
      await expectCode(
        repository.issueInvoice(actor, invoice.id, { file: null, invoiceNumber: "N2" }),
        "invoice_not_pending",
      )
      await expectCode(repository.rejectInvoice(actor, invoice.id, "晚了"), "invoice_not_pending")

      const file = await repository.invoiceFile(invoice.id, groupA)
      expect(new TextDecoder().decode(file.content)).toBe("%PDF-1.7 fixture")
      await expectCode(repository.invoiceFile(invoice.id, groupB), "invoice_not_found")
      await expectCode(repository.invoiceFile(crypto.randomUUID()), "invoice_not_found")
      // 已开的发票继续占额度。
      expect((await repository.invoiceQuota(groupA)).invoicedCents).toBe(1000)
    },
    60000,
  )

  databaseTest(
    "adds a file on a retry without replacing one already stored",
    async () => {
      const { repository } = await setup()
      const { invoice } = await repository.createInvoice(actor, groupA, company("10"))
      const pdf = (text: string) => ({
        content: new TextEncoder().encode(`%PDF-${text}`),
        fileName: "发票-N1.pdf",
      })
      await repository.issueInvoice(actor, invoice.id, { file: null, invoiceNumber: "N1" })
      const added = await repository.issueInvoice(actor, invoice.id, {
        file: pdf("first"),
        invoiceNumber: "N1",
      })
      expect(added).toMatchObject({ invoice: { hasFile: true }, replayed: true })
      await repository.issueInvoice(actor, invoice.id, { file: pdf("second"), invoiceNumber: "N1" })
      const stored = await repository.invoiceFile(invoice.id)
      expect(new TextDecoder().decode(stored.content)).toBe("%PDF-first")
    },
    60000,
  )

  databaseTest(
    "lets only one review win when issuing and rejecting race",
    async () => {
      const { repository } = await setup()
      const { invoice } = await repository.createInvoice(actor, groupA, company("10"))
      const results = await Promise.allSettled([
        repository.issueInvoice(actor, invoice.id, { file: null, invoiceNumber: "N1" }),
        repository.rejectInvoice(actor, invoice.id, "驳回"),
      ])
      expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1)
    },
    60000,
  )

  databaseTest(
    "filters by status, type and group and enforces the shape in the database",
    async () => {
      const { repository, sql } = await setup()
      const { invoice } = await repository.createInvoice(actor, groupA, company("10"))
      await repository.createInvoice(actor, groupA, {
        ...company("1"),
        taxNumber: "",
        title: "张三",
        titleType: "personal",
      })
      const page = { page: 1, pageSize: 20 }
      expect((await repository.listInvoices({ ...page, groupId: groupA })).total).toBe(2)
      expect((await repository.listInvoices({ ...page, groupId: groupB })).total).toBe(0)
      expect((await repository.listInvoices({ ...page, titleType: "personal" })).total).toBe(1)
      expect((await repository.listInvoices({ ...page, status: "issued" })).total).toBe(0)
      expect((await repository.listInvoices({ ...page, keyword: "91310000" })).total).toBe(1)
      expect((await repository.listInvoices({ ...page, keyword: "100%" })).total).toBe(0)
      await expect(
        sql`update mall_invoice set tax_number = '' where id = ${invoice.id}`.then(() => "ok"),
      ).rejects.toThrow("mall_invoice_tax_check")
    },
    60000,
  )
})
