import { afterEach, describe, expect, it } from "bun:test"
import { createSign, createVerify, generateKeyPairSync } from "node:crypto"

import {
  createMigratedTestDatabase,
  hasConfiguredTestDatabase,
  type MigratedTestDatabase,
} from "../../db/test-database"
import { createInMemoryAuditRepository } from "../audit/service"
import { type AlipayConfig, alipayConfigFromEnvironment, createAlipayGateway } from "./alipay"
import { MallError } from "./model"
import { createPostgresMallRepository } from "./repository"
import { createMallService } from "./service"

const databaseTest = hasConfiguredTestDatabase ? it : it.skip
const group = "11111111-1111-4111-8111-111111111111"
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

const merchantKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const alipayKeys = generateKeyPairSync("rsa", { modulusLength: 2048 })
const pem = {
  alipayPrivate: alipayKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  alipayPublic: alipayKeys.publicKey.export({ format: "pem", type: "spki" }).toString(),
  merchantPrivate: merchantKeys.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
}

const config: AlipayConfig = {
  appId: "2021000000000001",
  gateway: "https://gateway.invalid/gateway.do",
  notifyUrl: "https://example.test/api/pay/alipay/mall/notify",
  privateKey: pem.merchantPrivate,
  publicKey: pem.alipayPublic,
  returnUrl: "",
}

const signAs = (privateKey: string, content: string): string => {
  const signer = createSign("RSA-SHA256")
  signer.update(content, "utf8")
  return signer.sign(privateKey, "base64")
}

const notifyParams = (
  fields: Record<string, string>,
  privateKey: string = pem.alipayPrivate,
): Record<string, string> => {
  const params = { app_id: config.appId, ...fields }
  const content = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key as keyof typeof params]}`)
    .join("&")
  return { ...params, sign: signAs(privateKey, content), sign_type: "RSA2" }
}

const gatewayReply = (node: Record<string, string>, privateKey = pem.alipayPrivate): Response => {
  const body = JSON.stringify(node)
  const text = `{"alipay_trade_query_response":${body},"sign":"${signAs(privateKey, body)}"}`
  return new Response(text, { headers: { "content-type": "application/json;charset=utf-8" } })
}

let database: MigratedTestDatabase | null = null
afterEach(async () => {
  await database?.close()
  database = null
})

const setup = async (
  reply: (orderNo: string) => Response | Promise<Response> = () => new Response("oops"),
) => {
  database = await createMigratedTestDatabase()
  const sql = database.client
  await sql`insert into access_group(id,name) values (${group},'一组')`
  await sql`insert into app_user(id,email,display_name,password_hash,role)
    values (${actor},'a@example.test','一组管理员','unused','administrator')`
  const repository = createPostgresMallRepository(sql)
  const auditRepository = createInMemoryAuditRepository()
  const service = createMallService({
    alipay: createAlipayGateway(config, (async (_url: string, init: RequestInit) => {
      const biz = new URLSearchParams(String(init.body)).get("biz_content") ?? "{}"
      return reply((JSON.parse(biz) as { out_trade_no: string }).out_trade_no)
    }) as unknown as typeof fetch),
    auditRepository,
    repository,
  })
  const balance = async () => (await repository.listWallets([group]))[0]?.balance ?? 0
  const create = (amountYuan = "12.50", idempotencyKey: string = crypto.randomUUID()) =>
    service.createRecharge(actor, group, { amountYuan, idempotencyKey })
  const paid = (orderNo: string, overrides: Record<string, string> = {}) =>
    notifyParams({
      out_trade_no: orderNo,
      total_amount: "12.50",
      trade_no: `T${orderNo}`,
      trade_status: "TRADE_SUCCESS",
      ...overrides,
    })
  return { auditRepository, balance, create, paid, repository, service, sql }
}

describe("alipay configuration", () => {
  const complete = {
    ALIPAY_APP_ID: "1",
    ALIPAY_NOTIFY_URL: "https://example.test/notify",
    ALIPAY_PRIVATE_KEY: pem.merchantPrivate,
    ALIPAY_PUBLIC_KEY: pem.alipayPublic,
  }

  it("stays off until the app id, both keys and the notify URL are set", () => {
    expect(alipayConfigFromEnvironment({})).toBeNull()
    expect(alipayConfigFromEnvironment({ ALIPAY_APP_ID: "1", ALIPAY_PRIVATE_KEY: "k" })).toBeNull()
    expect(alipayConfigFromEnvironment({ ...complete, ALIPAY_NOTIFY_URL: "" })).toBeNull()
    expect(alipayConfigFromEnvironment(complete)?.gateway).toBe(
      "https://openapi.alipay.com/gateway.do",
    )
  })

  it("stays off when a key cannot be parsed, without logging it", () => {
    const secret = "not-a-real-key-value"
    const logged: unknown[] = []
    const original = console.error
    console.error = (...items: unknown[]) => logged.push(...items)
    try {
      expect(alipayConfigFromEnvironment({ ...complete, ALIPAY_PRIVATE_KEY: secret })).toBeNull()
      expect(alipayConfigFromEnvironment({ ...complete, ALIPAY_PUBLIC_KEY: secret })).toBeNull()
    } finally {
      console.error = original
    }
    expect(logged).toHaveLength(2)
    expect(JSON.stringify(logged)).not.toContain(secret)
  })

  it("accepts a PKCS1 private key as bare base64", () => {
    const der = merchantKeys.privateKey.export({ format: "der", type: "pkcs1" }).toString("base64")
    const gateway = createAlipayGateway({ ...config, privateKey: der })
    expect(gateway.payUrl({ amountYuan: "1.00", outTradeNo: "A", subject: "s" })).toContain("sign=")
    expect(alipayConfigFromEnvironment({ ...complete, ALIPAY_PRIVATE_KEY: der })).not.toBeNull()
  })

  it("signs a pay URL that the merchant public key verifies, keeping the amount exact", () => {
    const gateway = createAlipayGateway(config)
    const url = new URL(
      gateway.payUrl({ amountYuan: "12.50", outTradeNo: "A1", subject: "积分充值 1,250" }),
    )
    const params = Object.fromEntries(url.searchParams)
    expect(params["method"]).toBe("alipay.trade.page.pay")
    expect(JSON.parse(params["biz_content"] ?? "{}")).toMatchObject({
      out_trade_no: "A1",
      total_amount: "12.50",
    })
    const { sign = "", sign_type: signType, ...rest } = params
    expect(signType).toBe("RSA2")
    // 请求签名覆盖 sign_type，回调验签不覆盖，所以这里自己拼。
    const content = Object.entries({ ...rest, sign_type: signType ?? "" })
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&")
    const verifier = createVerify("RSA-SHA256")
    verifier.update(content, "utf8")
    expect(verifier.verify(merchantKeys.publicKey, sign, "base64")).toBe(true)
  })

  it("accepts keys given as bare base64, as the Alipay console shows them", () => {
    const bare = (value: string) => value.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")
    const gateway = createAlipayGateway({
      ...config,
      privateKey: bare(pem.merchantPrivate),
      publicKey: bare(pem.alipayPublic),
    })
    expect(gateway.payUrl({ amountYuan: "1.00", outTradeNo: "A", subject: "s" })).toContain("sign=")
    const params = notifyParams({ out_trade_no: "A" })
    expect(gateway.verifyNotify(params)).toBe(true)
  })
})

describe("alipay notify verification", () => {
  const gateway = createAlipayGateway(config)

  it("rejects a forged signature, a tampered field and another app", () => {
    const good = notifyParams({ out_trade_no: "A1", total_amount: "1.00" })
    expect(gateway.verifyNotify(good)).toBe(true)
    expect(gateway.verifyNotify({ ...good, total_amount: "999.00" })).toBe(false)
    expect(gateway.verifyNotify({ ...good, sign: "" })).toBe(false)
    expect(gateway.verifyNotify(notifyParams({ out_trade_no: "A1" }, pem.merchantPrivate))).toBe(
      false,
    )
    expect(gateway.verifyNotify({ ...good, app_id: "other" })).toBe(false)
  })
})

describe("alipay query reply", () => {
  it("uses only the signed node, ignoring a forged one appended after it", async () => {
    const signed = JSON.stringify({ code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" })
    const forged = JSON.stringify({
      code: "10000",
      out_trade_no: "A1",
      total_amount: "1.00",
      trade_no: "FORGED",
      trade_status: "TRADE_SUCCESS",
    })
    const body = `{"alipay_trade_query_response":${signed},"sign":"${signAs(pem.alipayPrivate, signed)}","alipay_trade_query_response":${forged}}`
    const gateway = createAlipayGateway(
      config,
      (async () => new Response(body)) as unknown as typeof fetch,
    )
    expect(await gateway.query("A1")).toEqual({ kind: "absent" })
  })
})

describe("alipay recharge PostgreSQL", () => {
  databaseTest(
    "credits points once however many notifies arrive",
    async () => {
      const { auditRepository, balance, create, paid, repository, service } = await setup()
      const order = await create()
      expect(order).toMatchObject({ amountCents: 1250, points: 1250, status: "unpaid" })
      expect(order.payUrl).toContain("gateway.invalid")
      expect(await balance()).toBe(0)

      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.handleAlipayNotify(paid(order.orderNo))),
      )
      expect(results.every((item) => item === "success")).toBe(true)
      expect(await balance()).toBe(1250)
      const ledger = await repository.listLedger({ groupId: group, page: 1, pageSize: 20 })
      expect(ledger.total).toBe(1)
      expect(ledger.items[0]).toMatchObject({ delta: 1250, type: "recharge" })
      const events = auditRepository.all().filter((event) => event.action === "mall.alipay.paid")
      expect(events).toHaveLength(1)
      // 支付宝充值算真实收款，可以开票。
      expect((await repository.invoiceQuota(group)).paidCents).toBe(1250)
    },
    60000,
  )

  databaseTest(
    "refuses a forged notify, a wrong amount and an unknown order",
    async () => {
      const { balance, create, paid, repository, service } = await setup()
      const order = await create()
      const forged = notifyParams(
        { out_trade_no: order.orderNo, total_amount: "12.50", trade_status: "TRADE_SUCCESS" },
        pem.merchantPrivate,
      )
      expect(await service.handleAlipayNotify(forged)).toBe("failure")
      for (const total_amount of ["0.01", "12.51", "abc", ""]) {
        expect(await service.handleAlipayNotify(paid(order.orderNo, { total_amount }))).toBe(
          "failure",
        )
      }
      expect(await service.handleAlipayNotify(paid("A-missing"))).toBe("failure")
      expect(await balance()).toBe(0)
      expect((await repository.findRecharge(group, order.orderNo)).status).toBe("unpaid")
    },
    60000,
  )

  databaseTest(
    "ignores a waiting notify, closes on TRADE_CLOSED and still credits a late payment",
    async () => {
      const { balance, create, paid, repository, service } = await setup()
      const order = await create()
      const waiting = paid(order.orderNo, { trade_status: "WAIT_BUYER_PAY" })
      expect(await service.handleAlipayNotify(waiting)).toBe("success")
      expect(await balance()).toBe(0)
      const closed = paid(order.orderNo, { trade_status: "TRADE_CLOSED" })
      expect(await service.handleAlipayNotify(closed)).toBe("success")
      expect((await repository.findRecharge(group, order.orderNo)).status).toBe("closed")
      // 钱到了就要入账，本地关单不能吞掉它。
      expect(await service.handleAlipayNotify(paid(order.orderNo))).toBe("success")
      expect(await balance()).toBe(1250)
      // 已经入账后再来一个关闭通知，不能把状态改回去。
      expect(await service.handleAlipayNotify(closed)).toBe("success")
      expect((await repository.findRecharge(group, order.orderNo)).status).toBe("paid")
    },
    60000,
  )

  databaseTest(
    "reuses one order for one key and never reissues a paid one",
    async () => {
      const { create, paid, service } = await setup()
      const key = crypto.randomUUID()
      const first = await create("12.50", key)
      const again = await create("12.50", key)
      expect(again.orderNo).toBe(first.orderNo)
      let conflict: unknown
      await create("13.00", key).catch((error: unknown) => {
        conflict = error
      })
      expect((conflict as MallError).code).toBe("idempotency_conflict")
      await service.handleAlipayNotify(paid(first.orderNo))
      expect(await create("12.50", key)).toMatchObject({ payUrl: null, status: "paid" })
    },
    60000,
  )

  databaseTest(
    "finds a payment whose notify was lost when the buyer asks",
    async () => {
      let orderNo = ""
      const env = await setup(() =>
        gatewayReply({
          code: "10000",
          out_trade_no: orderNo,
          total_amount: "12.50",
          trade_no: "T1",
          trade_status: "TRADE_SUCCESS",
        }),
      )
      orderNo = (await env.create()).orderNo
      expect(await env.service.rechargeStatus(group, orderNo)).toMatchObject({ status: "paid" })
      expect(await env.balance()).toBe(1250)
      let missing: unknown
      await env.service.rechargeStatus(group, "A-other").catch((error: unknown) => {
        missing = error
      })
      expect(missing).toBeInstanceOf(MallError)
    },
    60000,
  )

  databaseTest(
    "does not trust an unsigned or badly signed query reply",
    async () => {
      let orderNo = ""
      const body = () => ({
        code: "10000",
        out_trade_no: orderNo,
        total_amount: "12.50",
        trade_no: "T1",
        trade_status: "TRADE_SUCCESS",
      })
      let reply: () => Response = () => gatewayReply(body(), pem.merchantPrivate)
      const env = await setup(() => reply())
      orderNo = (await env.create()).orderNo
      expect((await env.service.rechargeStatus(group, orderNo)).status).toBe("unpaid")
      reply = () => {
        throw new Error("network down")
      }
      expect((await env.service.rechargeStatus(group, orderNo)).status).toBe("unpaid")
      expect(await env.balance()).toBe(0)
    },
    60000,
  )

  databaseTest(
    "sweep credits lost payments, closes abandoned orders and leaves recent or unknown ones",
    async () => {
      const replies = new Map<string, () => Response>()
      const env = await setup((orderNo) => replies.get(orderNo)?.() ?? new Response("oops"))
      const age = (orderNo: string, minutes: number) =>
        env.sql`update mall_order set created_at = now() - make_interval(mins => ${minutes})
          where order_no = ${orderNo}`
      const lost = (await env.create()).orderNo
      const abandoned = (await env.create()).orderNo
      const onCashier = (await env.create()).orderNo
      const unknown = (await env.create()).orderNo
      const recent = (await env.create()).orderNo
      await age(lost, 40)
      await age(abandoned, 121)
      await age(onCashier, 40)
      await age(unknown, 40)
      replies.set(lost, () =>
        gatewayReply({
          code: "10000",
          out_trade_no: lost,
          total_amount: "12.50",
          trade_no: "T2",
          trade_status: "TRADE_SUCCESS",
        }),
      )
      const notExist = () => gatewayReply({ code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" })
      replies.set(abandoned, notExist)
      // 还在收银台：支付宝这时查不到交易，不能关。
      replies.set(onCashier, notExist)
      await env.service.sweepRecharges()
      expect(await env.balance()).toBe(1250)
      expect((await env.repository.findRecharge(group, lost)).status).toBe("paid")
      // 查不到结果的不能关，买家可能已经付了。
      expect((await env.repository.findRecharge(group, unknown)).status).toBe("unpaid")
      expect((await env.repository.findRecharge(group, onCashier)).status).toBe("unpaid")
      expect((await env.repository.findRecharge(group, abandoned)).status).toBe("closed")
      expect((await env.repository.findRecharge(group, recent)).status).toBe("unpaid")

      // 关单后才付款且回调丢失：下一轮补查仍要入账。
      replies.set(abandoned, () =>
        gatewayReply({
          code: "10000",
          out_trade_no: abandoned,
          total_amount: "12.50",
          trade_no: "T3",
          trade_status: "TRADE_SUCCESS",
        }),
      )
      await env.service.sweepRecharges()
      expect((await env.repository.findRecharge(group, abandoned)).status).toBe("paid")
      expect(await env.balance()).toBe(2500)
    },
    60000,
  )

  databaseTest(
    "gives up on an order with no answer after a day, and stops rechecking after two",
    async () => {
      const env = await setup()
      const age = (orderNo: string, minutes: number) =>
        env.sql`update mall_order set created_at = now() - make_interval(mins => ${minutes})
          where order_no = ${orderNo}`
      const dayOld = (await env.create()).orderNo
      const longClosed = (await env.create()).orderNo
      await age(dayOld, 24 * 60 + 1)
      await age(longClosed, 49 * 60)
      await env.repository.closeRecharge(longClosed)
      await env.service.sweepRecharges()
      expect((await env.repository.findRecharge(group, dayOld)).status).toBe("closed")
      const stale = await env.repository.staleRecharges(35)
      expect(stale.map((item) => item.orderNo)).toEqual([dayOld])
    },
    60000,
  )

  databaseTest(
    "keeps sweeping the other orders when one of them throws",
    async () => {
      const env = await setup()
      const bad = (await env.create()).orderNo
      const good = (await env.create()).orderNo
      for (const [orderNo, minutes] of [
        [bad, 50],
        [good, 40],
      ] as const) {
        await env.sql`update mall_order set created_at = now() - make_interval(mins => ${minutes})
          where order_no = ${orderNo}`
      }
      const failing = createMallService({
        alipay: createAlipayGateway(config, (async (_url: string, init: RequestInit) => {
          const biz = JSON.parse(
            new URLSearchParams(String(init.body)).get("biz_content") ?? "{}",
          ) as { out_trade_no: string }
          return gatewayReply({
            code: "10000",
            out_trade_no: biz.out_trade_no,
            total_amount: "12.50",
            trade_no: `T${biz.out_trade_no}`,
            trade_status: "TRADE_SUCCESS",
          })
        }) as unknown as typeof fetch),
        auditRepository: env.auditRepository,
        repository: {
          ...env.repository,
          settleRecharge: async (orderNo, tradeNo, amount) => {
            if (orderNo === bad) throw new Error("database hiccup")
            return env.repository.settleRecharge(orderNo, tradeNo, amount)
          },
        },
      })
      await failing.sweepRecharges()
      expect((await env.repository.findRecharge(group, good)).status).toBe("paid")
      expect((await env.repository.findRecharge(group, bad)).status).toBe("unpaid")
    },
    60000,
  )
})
