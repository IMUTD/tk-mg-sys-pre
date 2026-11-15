import { createHash, createPrivateKey, createSign, createVerify, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"

import type { Hono } from "hono"
import type { Sql } from "postgres"
import { z } from "zod"

import { AuditOutcome, type AuditRepository, writeAuditEvent } from "./audit/service"
import { isLimitedHost } from "./box-service-limit"

const plans = [
  { months: 1, label: "一个月" },
  { months: 3, label: "三个月" },
  { months: 6, label: "六个月" },
  { months: 12, label: "一年" },
] as const

type PlanMonths = (typeof plans)[number]["months"]

const orderBody = z.object({
  externalId: z.string().trim().min(1).max(128),
  months: z.union([z.literal(1), z.literal(3), z.literal(6), z.literal(12)]),
})

const reconcileBody = z.object({
  outTradeNo: z.string().trim().min(1).max(64),
})

const refundBody = z.object({
  reason: z.string().trim().min(1).max(200),
})

const sessionUser = async (sql: Sql, token: string): Promise<string | null> => {
  const digest = createHash("sha256").update(token).digest("hex")
  const rows = await sql<{ id: string }[]>`
    select u.id
    from app_session s
    join app_user u on u.id = s.user_id
    where s.token_hash = ${digest}
      and s.revoked_at is null
      and s.expires_at > now()
      and u.enabled = true
  `
  return rows[0]?.id ?? null
}

const userFromRequest = async (sql: Sql, request: Request): Promise<string | null> => {
  const header = request.headers.get("cookie") ?? ""
  const matched = /(?:^|;\s*)tk_mg_session=([^;]+)/.exec(header)
  let token = ""
  try {
    token = matched === null ? "" : decodeURIComponent(matched[1] ?? "")
  } catch {
    return null
  }
  if (token === "") return null
  return sessionUser(sql, token)
}

type Viewer = {
  readonly id: string
  readonly platformAdmin: boolean
}

const viewerFromRequest = async (sql: Sql, request: Request): Promise<Viewer | null> => {
  const userId = await userFromRequest(sql, request)
  if (userId === null) return null
  const rows = await sql<{ is_platform: boolean }[]>`
    select is_platform
    from app_user
    where id = ${userId}::uuid
      and enabled
  `
  const row = rows[0]
  if (row === undefined) return null
  return {
    id: userId,
    // The platform is marked explicitly (migration 0081), not inferred from who created it.
    platformAdmin: row.is_platform,
  }
}

const moneyText = (value: string | number): string => {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return "0.00"
  return amount.toFixed(2)
}

const likePattern = (value: string): string =>
  `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`

const shanghaiDay = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const time = new Date(`${value}T00:00:00+08:00`)
  return Number.isNaN(time.getTime()) ? null : time
}

type ListQuery = {
  readonly from: Date | null
  readonly page: number
  readonly pageSize: number
  readonly q: string
  readonly toExclusive: Date | null
}

const listQuery = (read: (key: string) => string | undefined): ListQuery | { error: string } => {
  const q = (read("q") ?? "").trim().slice(0, 128)
  const fromText = read("from") ?? ""
  const toText = read("to") ?? ""
  const from = fromText === "" ? null : shanghaiDay(fromText)
  const to = toText === "" ? null : shanghaiDay(toText)
  if ((fromText !== "" && from === null) || (toText !== "" && to === null)) {
    return { error: "无效日期" }
  }
  if (from !== null && to !== null && from.getTime() > to.getTime()) {
    return { error: "开始日期晚于结束日期" }
  }
  return {
    from,
    page: Math.min(10000, Math.max(1, Number(read("page") ?? "1") || 1)),
    pageSize: Math.min(100, Math.max(1, Number(read("pageSize") ?? "20") || 1)),
    q,
    toExclusive: to === null ? null : new Date(to.getTime() + 24 * 60 * 60 * 1000),
  }
}

const loadLocalAlipay = (): void => {
  try {
    const text = readFileSync("/workspace/alipay.local.env", "utf8")
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed === "" || trimmed.startsWith("#")) continue
      const splitAt = trimmed.indexOf("=")
      if (splitAt <= 0) continue
      const key = trimmed.slice(0, splitAt).trim()
      const value = trimmed.slice(splitAt + 1).trim()
      if ((process.env[key] ?? "") === "") process.env[key] = value
    }
  } catch {
    // The sandbox file is optional. Compose environment variables remain the source when present.
  }
}

loadLocalAlipay()

const envValue = (key: string): string => process.env[key]?.trim() ?? ""

const priceOf = (months: PlanMonths): string => {
  const raw = envValue(`BOX_SERVICE_PRICE_${months}`) || defaultPrice(months)
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return defaultPrice(months)
  return value.toFixed(2)
}

const defaultPrice = (months: PlanMonths): string => {
  if (months === 1) return "100.00"
  if (months === 3) return "270.00"
  if (months === 6) return "500.00"
  return "900.00"
}

const pemBody = (value: string): string => {
  const normalized = value.replace(/\\n/g, "\n").trim()
  if (normalized.includes("BEGIN")) return normalized
  const lines = normalized.replace(/\s+/g, "").match(/.{1,64}/g) ?? []
  return lines.join("\n")
}

const privatePem = (value: string): string => {
  if (value.includes("BEGIN")) return value.replace(/\\n/g, "\n").trim()
  const body = pemBody(value)
  const pkcs8 = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`
  try {
    createPrivateKey(pkcs8)
    return pkcs8
  } catch {
    return `-----BEGIN RSA PRIVATE KEY-----\n${body}\n-----END RSA PRIVATE KEY-----\n`
  }
}

const publicPem = (value: string): string => {
  if (value.includes("BEGIN")) return value.replace(/\\n/g, "\n").trim()
  return `-----BEGIN PUBLIC KEY-----\n${pemBody(value)}\n-----END PUBLIC KEY-----\n`
}

const alipayConfig = (): {
  appId: string
  gateway: string
  notifyUrl: string
  privateKey: string
  publicKey: string
} | null => {
  const appId = envValue("ALIPAY_APP_ID")
  const privateKey = envValue("ALIPAY_PRIVATE_KEY")
  const publicKey = envValue("ALIPAY_PUBLIC_KEY")
  if (appId === "" || privateKey === "" || publicKey === "") return null
  return {
    appId,
    gateway: envValue("ALIPAY_GATEWAY") || "https://openapi.alipay.com/gateway.do",
    notifyUrl: boxNotifyUrl(
      envValue("BOX_SERVICE_ALIPAY_NOTIFY_URL"),
      envValue("ALIPAY_NOTIFY_URL"),
    ),
    privateKey,
    publicKey,
  }
}

// The mall shares the Alipay app but owns ALIPAY_NOTIFY_URL and ALIPAY_RETURN_URL
// (/api/pay/alipay/mall/notify). Box orders must call back here, so without a dedicated
// address reuse the mall's host with this module's path.
export const boxNotifyUrl = (dedicated: string, shared: string): string => {
  if (dedicated !== "") return dedicated
  if (shared === "") return ""
  try {
    return new URL("/api/pay/alipay/notify", shared).toString()
  } catch {
    return ""
  }
}

const alipayTimestamp = (): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ""
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`
}

const signedQuery = (params: Record<string, string>, privateKey: string): string => {
  const filled = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ""))
  const content = Object.keys(filled)
    .sort()
    .map((key) => `${key}=${filled[key]}`)
    .join("&")
  const signer = createSign("RSA-SHA256")
  signer.update(content, "utf8")
  const sign = signer.sign(privatePem(privateKey), "base64")
  return new URLSearchParams({ ...filled, sign }).toString()
}

const verifyParams = (params: Record<string, string>, publicKey: string): boolean => {
  const sign = params["sign"] ?? ""
  if (sign === "") return false
  const content = Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&")
  const verifier = createVerify("RSA-SHA256")
  verifier.update(content, "utf8")
  try {
    return verifier.verify(publicPem(publicKey), sign, "base64")
  } catch {
    return false
  }
}

const descendants = (db: Sql, userId: string) => db`
  with recursive down as (
    select id from app_user where parent_user_id = ${userId}::uuid and enabled
    union all
    select a.id from app_user a
    join down on a.parent_user_id = down.id
    where a.enabled
  )
  select id from down
`

// Boxes assigned to the viewer, their sub-accounts, or someone sharing a group with them.
// Unassigned boxes belong to nobody yet, so only the platform account sees them.
const visibleBox = (db: Sql, viewer: Viewer) =>
  viewer.platformAdmin
    ? db`d.external_id is not null and d.external_id <> ''`
    : db`
  d.external_id is not null
  and d.external_id <> ''
  and (
    d.assignee_user_id = ${viewer.id}::uuid
    or d.assignee_user_id in (${descendants(db, viewer.id)})
    or exists (
      select 1
      from user_group mine
      join user_group theirs on theirs.group_id = mine.group_id
      where mine.user_id = ${viewer.id}::uuid
        and theirs.user_id = d.assignee_user_id
    )
  )
`

const canSeeBox = async (sql: Sql, viewer: Viewer, externalId: string): Promise<boolean> => {
  const rows = await sql<{ id: string }[]>`
    select d.id::text as id
    from device d
    where d.external_id = ${externalId}
      and ${visibleBox(sql, viewer)}
    limit 1
  `
  return rows.length > 0
}

// Administrators see what their sub-accounts bought; the platform account sees everything.
const orderScope = (db: Sql, viewer: Viewer, buyer: ReturnType<Sql>) =>
  viewer.platformAdmin
    ? db``
    : db`and (${buyer} = ${viewer.id}::uuid or ${buyer} in (${descendants(db, viewer.id)}))`

// The page confirms the payment from the order number in the return address, so it must be
// there whether the address is configured or derived from the page's own origin.
export const paymentReturnUrl = (
  configured: string,
  origin: string,
  outTradeNo: string,
): string => {
  const base =
    configured !== "" ? configured : origin === "" ? "" : `${origin}/operations/box-service`
  if (base === "") return ""
  try {
    const url = new URL(base)
    url.searchParams.set("outTradeNo", outTradeNo)
    return url.toString()
  } catch {
    return base
  }
}

// Alipay stops accepting payment after this; local cleanup waits longer so a late notify
// for a payment made in time still lands.
const payTimeout = "30m"

// A stuck gateway must not hold the request. Refund retries are safe: the request number is fixed.
const alipayTimeoutMs = 10_000

const closePendingOrder = async (sql: Sql, outTradeNo: string): Promise<void> => {
  await sql`
    update box_service_order
    set status = 'closed'
    where out_trade_no = ${outTradeNo}
      and status = 'pending'
  `
}

const grantOrder = async (
  sql: Sql,
  outTradeNo: string,
  tradeNo: string,
  amount: string,
): Promise<
  | {
      readonly buyer: string
      readonly deviceMissing: boolean
      readonly externalId: string
      readonly result: "granted"
    }
  | { readonly result: "already" | "mismatch" | "missing" }
> =>
  sql.begin(async (tx) => {
    // A locally closed order still accepts Alipay's confirmation: the money has moved.
    const pending = await tx<{ buyer_user_id: string; external_id: string; months: number }[]>`
      update box_service_order
      set status = 'paid', alipay_trade_no = ${tradeNo}, paid_at = now()
      where out_trade_no = ${outTradeNo}
        and status in ('pending', 'closed')
        and amount = ${amount}
      returning buyer_user_id::text, external_id, months
    `
    if (pending.length === 0) {
      const existing = await tx<{ status: string }[]>`
        select status from box_service_order where out_trade_no = ${outTradeNo}
      `
      if (existing[0]?.status === "paid" || existing[0]?.status === "refunded")
        return { result: "already" }
      if (existing.length === 0) return { result: "missing" }
      return { result: "mismatch" }
    }
    const row = pending[0]
    if (row === undefined) return { result: "missing" }
    const updated = await tx<{ id: string }[]>`
      update device
      set service_until = case
            when service_until is not null and service_until > now()
              then service_until + make_interval(months => ${row.months})
            else now() + make_interval(months => ${row.months})
          end,
          updated_at = now()
      where external_id = ${row.external_id}
      returning id::text
    `
    // The money has moved even if the box was deleted meanwhile. Keep the order paid so Alipay
    // stops retrying, and record that the time never landed so it can be refunded or followed up.
    if (updated.length === 0)
      await tx`
        update box_service_order set device_missing = true where out_trade_no = ${outTradeNo}
      `
    return {
      buyer: row.buyer_user_id,
      deviceMissing: updated.length === 0,
      externalId: row.external_id,
      result: "granted",
    }
  })

// Takes back the months the order added. Whatever is left may already be in the past.
const revokeOrder = async (
  sql: Sql,
  outTradeNo: string,
  refundedBy: string,
  reason: string,
): Promise<{ readonly externalId: string; readonly months: number } | null> =>
  sql.begin(async (tx) => {
    const refunded = await tx<{ external_id: string; months: number }[]>`
      update box_service_order
      set status = 'refunded', refunded_at = now(), refunded_by = ${refundedBy}::uuid,
        refund_reason = ${reason}
      where out_trade_no = ${outTradeNo}
        and status = 'paid'
      returning external_id, months
    `
    const row = refunded[0]
    if (row === undefined) return null
    await tx`
      update device
      set service_until = service_until - make_interval(months => ${row.months}),
          updated_at = now()
      where external_id = ${row.external_id}
        and service_until is not null
    `
    return { externalId: row.external_id, months: row.months }
  })

const decodeAlipayBody = (body: Buffer, contentType: string): string => {
  const charset =
    /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase().replaceAll("_", "-") ?? "utf-8"
  if (charset === "gbk" || charset === "gb2312" || charset === "gb18030") {
    return new TextDecoder("gb18030").decode(body)
  }
  return new TextDecoder("utf-8").decode(body)
}

type AlipayReply = Readonly<Record<string, unknown>>

const replyText = (reply: AlipayReply, key: string): string => {
  const value = reply[key]
  return typeof value === "string" ? value : ""
}

// Calls an Alipay API and returns its response node once the gateway signature checks out.
const callAlipay = async (
  method: string,
  biz: Readonly<Record<string, string>>,
): Promise<AlipayReply | null> => {
  const config = alipayConfig()
  if (config === null) return null
  const params: Record<string, string> = {
    app_id: config.appId,
    biz_content: JSON.stringify(biz),
    charset: "utf-8",
    format: "JSON",
    method,
    sign_type: "RSA2",
    timestamp: alipayTimestamp(),
    version: "1.0",
  }
  const body = signedQuery(params, config.privateKey)
  const response = await fetch(config.gateway, {
    body,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(alipayTimeoutMs),
  })
  const rawBuf = Buffer.from(await response.arrayBuffer())
  const raw = rawBuf.toString("latin1")
  const key = `${method.replaceAll(".", "_")}_response`
  const matched = new RegExp(`"${key}":(\\{.*\\}),"sign":"([^"]+)"`, "s").exec(raw)
  if (matched === null) return null
  const verifier = createVerify("RSA-SHA256")
  verifier.update(Buffer.from(matched[1] ?? "", "latin1"))
  if (!verifier.verify(publicPem(config.publicKey), matched[2] ?? "", "base64")) return null
  const parsed = JSON.parse(
    decodeAlipayBody(rawBuf, response.headers.get("content-type") ?? ""),
  ) as Record<string, AlipayReply | undefined>
  return parsed[key] ?? null
}

type TradeQuery =
  | {
      readonly amount: string
      readonly kind: "found"
      readonly tradeNo: string
      readonly tradeStatus: string
    }
  // Alipay has no trade for this number: the buyer never got as far as paying.
  | { readonly kind: "absent" }

// Null means the answer is unknown (gateway down, timeout, bad signature); ask again later.
const queryTrade = async (outTradeNo: string): Promise<TradeQuery | null> => {
  const node = await callAlipay("alipay.trade.query", { out_trade_no: outTradeNo }).catch(
    () => null,
  )
  if (node === null) return null
  if (replyText(node, "sub_code") === "ACQ.TRADE_NOT_EXIST") return { kind: "absent" }
  if (replyText(node, "code") !== "10000" || replyText(node, "out_trade_no") !== outTradeNo)
    return null
  return {
    amount: replyText(node, "total_amount"),
    kind: "found",
    tradeNo: replyText(node, "trade_no"),
    tradeStatus: replyText(node, "trade_status"),
  }
}

const tradePaid = (status: string): boolean =>
  status === "TRADE_SUCCESS" || status === "TRADE_FINISHED"

// One full refund per order. Reusing the request number makes a retry return the earlier
// refund instead of paying out twice.
const refundTrade = async (
  outTradeNo: string,
  amount: string,
  reason: string,
): Promise<{ readonly ok: true } | { readonly error: string; readonly ok: false }> => {
  const node = await callAlipay("alipay.trade.refund", {
    out_request_no: `${outTradeNo}-refund`,
    out_trade_no: outTradeNo,
    refund_amount: amount,
    refund_reason: reason,
  })
  if (node === null) return { error: "支付宝没有返回退款结果", ok: false }
  if (replyText(node, "code") !== "10000") {
    return { error: replyText(node, "sub_msg") || "支付宝拒绝退款", ok: false }
  }
  if (Number(replyText(node, "refund_fee")) < Number(amount)) {
    return { error: "支付宝退款金额不足", ok: false }
  }
  return { ok: true }
}

const audit = async (
  repository: AuditRepository,
  input: Parameters<typeof writeAuditEvent>[1],
): Promise<void> => {
  try {
    await writeAuditEvent(repository, input)
  } catch {
    // Payment state is already committed; a lost audit row must not turn it into an error.
    console.error("box service audit failed")
  }
}

export type BoxService = {
  readonly sweepPendingOrders: () => Promise<void>
}

export const registerBoxService = (
  app: Hono,
  sql: Sql,
  auditRepository: AuditRepository,
): BoxService => {
  const grantAndAudit = async (
    outTradeNo: string,
    tradeNo: string,
    amount: string,
    source: "notify" | "reconcile" | "sweep",
  ) => {
    const granted = await grantOrder(sql, outTradeNo, tradeNo, amount)
    if (granted.result !== "granted") return granted.result
    await audit(auditRepository, {
      action: "box_service.order.paid",
      actorId: granted.buyer,
      metadata: { externalId: granted.externalId, source },
      outcome: AuditOutcome.Allowed,
      target: `box_service_order:${outTradeNo}`,
    })
    if (granted.deviceMissing) {
      console.error("box service order paid for a missing box", outTradeNo)
      await audit(auditRepository, {
        action: "box_service.order.device_missing",
        actorId: granted.buyer,
        metadata: { externalId: granted.externalId, source },
        outcome: AuditOutcome.Failed,
        target: `box_service_order:${outTradeNo}`,
      })
    }
    return granted.result
  }

  // Notifies get lost (wrong notify URL, restarts, network). Once the payment window is over,
  // ask Alipay about each order still pending and close only those it says were never paid.
  const sweepPendingOrders = async (): Promise<void> => {
    const stale = await sql<{ abandoned: boolean; expired: boolean; out_trade_no: string }[]>`
      select
        out_trade_no,
        created_at < now() - interval '2 hours' as expired,
        created_at < now() - interval '1 day' as abandoned
      from box_service_order
      where status = 'pending'
        and created_at < now() - interval '35 minutes'
      order by created_at
      limit 50
    `
    const configured = alipayConfig() !== null
    for (const order of stale) {
      const trade = configured ? await queryTrade(order.out_trade_no) : null
      if (trade?.kind === "found" && tradePaid(trade.tradeStatus)) {
        await grantAndAudit(order.out_trade_no, trade.tradeNo, trade.amount, "sweep").catch(
          (error: unknown) => console.error("box service sweep grant failed", error),
        )
        continue
      }
      const closed = trade?.kind === "found" && trade.tradeStatus === "TRADE_CLOSED"
      // Unknown answers wait for the next round; a closed order can still be paid later.
      const settled = trade !== null || !configured
      if (closed || (order.expired && settled) || order.abandoned)
        await closePendingOrder(sql, order.out_trade_no)
    }
  }

  app.get("/api/box-service", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    const boxes = await sql<
      {
        external_id: string
        host: string
        name: string
        service_until: Date | null
      }[]
    >`
      select d.external_id, d.name, d.host, d.service_until
      from device d
      where ${visibleBox(sql, viewer)}
      order by d.name
    `
    return context.json({
      alipayReady: alipayConfig() !== null,
      boxes: boxes.map((row) => ({
        externalId: row.external_id,
        host: row.host,
        limited: isLimitedHost(row.host),
        name: row.name,
        serviceUntil: row.service_until?.toISOString() ?? null,
      })),
      plans: plans.map((plan) => ({
        amount: priceOf(plan.months),
        label: plan.label,
        months: plan.months,
      })),
      platformAdmin: viewer.platformAdmin,
    })
  })

  app.post("/api/box-service/orders", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    const config = alipayConfig()
    if (config === null) return context.json({ error: "未配置支付宝" }, 503)
    const parsed = orderBody.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success) return context.json({ error: "请选择盒子和时长" }, 400)
    const visible = await canSeeBox(sql, viewer, parsed.data.externalId)
    if (!visible) return context.json({ error: "没有这台盒子" }, 404)
    const amount = priceOf(parsed.data.months)
    const outTradeNo = `bs${Date.now().toString(36)}${randomBytes(4).toString("hex")}`
    await sql`
      insert into box_service_order (out_trade_no, external_id, buyer_user_id, months, amount)
      values (
        ${outTradeNo},
        ${parsed.data.externalId},
        ${viewer.id}::uuid,
        ${parsed.data.months},
        ${amount}
      )
    `
    await audit(auditRepository, {
      action: "box_service.order.create",
      actorId: viewer.id,
      metadata: { amount, externalId: parsed.data.externalId, months: String(parsed.data.months) },
      outcome: AuditOutcome.Allowed,
      target: `box_service_order:${outTradeNo}`,
    })
    // ALIPAY_RETURN_URL leads back to the mall; box buyers return to their own page.
    const returnUrl = paymentReturnUrl(
      envValue("BOX_SERVICE_ALIPAY_RETURN_URL"),
      context.req.header("origin") ?? "",
      outTradeNo,
    )
    const params: Record<string, string> = {
      app_id: config.appId,
      biz_content: JSON.stringify({
        out_trade_no: outTradeNo,
        product_code: "FAST_INSTANT_TRADE_PAY",
        subject: `盒子使用时长 ${parsed.data.months} 个月`,
        timeout_express: payTimeout,
        total_amount: amount,
      }),
      charset: "utf-8",
      format: "JSON",
      method: "alipay.trade.page.pay",
      notify_url: config.notifyUrl,
      return_url: returnUrl,
      sign_type: "RSA2",
      timestamp: alipayTimestamp(),
      version: "1.0",
    }
    const payUrl = `${config.gateway}?${signedQuery(params, config.privateKey)}`
    return context.json({ outTradeNo, payUrl })
  })

  app.get("/api/box-service/orders", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    const status = context.req.query("status") ?? ""
    if (
      status !== "" &&
      status !== "pending" &&
      status !== "paid" &&
      status !== "closed" &&
      status !== "refunded"
    ) {
      return context.json({ error: "无效状态" }, 400)
    }
    const query = listQuery((key) => context.req.query(key))
    if ("error" in query) return context.json({ error: query.error }, 400)
    const { from, page, pageSize, q, toExclusive } = query
    const like = likePattern(q)
    const scope = () => orderScope(sql, viewer, sql`o.buyer_user_id`)
    const statusFilter = status === "" ? sql`` : sql`and o.status = ${status}`
    const fromFilter = from === null ? sql`` : sql`and o.created_at >= ${from}`
    const toFilter = toExclusive === null ? sql`` : sql`and o.created_at < ${toExclusive}`
    const keyword =
      q === ""
        ? sql``
        : sql`and (
            o.out_trade_no ilike ${like} escape '\\'
            or o.alipay_trade_no ilike ${like} escape '\\'
            or o.external_id ilike ${like} escape '\\'
            or coalesce(d.host, '') ilike ${like} escape '\\'
            or coalesce(d.name, '') ilike ${like} escape '\\'
            ${
              viewer.platformAdmin
                ? sql`or u.email ilike ${like} escape '\\' or coalesce(u.display_name, '') ilike ${like} escape '\\'`
                : sql``
            }
          )`
    const summaryRows = await sql<
      {
        paid_amount: string
        paid_count: number
        pending_count: number
        refunded_amount: string
        refunded_count: number
      }[]
    >`
      select
        coalesce(sum(o.amount::numeric) filter (where o.status = 'paid'), 0)::text as paid_amount,
        count(*) filter (where o.status = 'paid')::int as paid_count,
        count(*) filter (where o.status = 'pending')::int as pending_count,
        coalesce(sum(o.amount::numeric) filter (where o.status = 'refunded'), 0)::text
          as refunded_amount,
        count(*) filter (where o.status = 'refunded')::int as refunded_count
      from box_service_order o
      where true
        ${scope()}
    `
    const totalRows = await sql<{ total: number }[]>`
      select count(*)::int as total
      from box_service_order o
      left join device d on d.external_id = o.external_id
      join app_user u on u.id = o.buyer_user_id
      where true
        ${scope()}
        ${statusFilter}
        ${fromFilter}
        ${toFilter}
        ${keyword}
    `
    const rows = await sql<
      {
        alipay_trade_no: string
        amount: string
        buyer_email: string
        buyer_name: string
        created_at: Date
        external_id: string
        host: string
        months: number
        name: string
        device_missing: boolean
        out_trade_no: string
        paid_at: Date | null
        refund_reason: string
        refunded_at: Date | null
        status: string
      }[]
    >`
      select
        o.out_trade_no,
        o.alipay_trade_no,
        o.external_id,
        coalesce(d.host, '') as host,
        coalesce(d.name, '') as name,
        o.months,
        o.amount,
        o.status,
        o.paid_at,
        o.refunded_at,
        o.refund_reason,
        o.created_at,
        o.device_missing,
        u.email as buyer_email,
        coalesce(u.display_name, '') as buyer_name
      from box_service_order o
      left join device d on d.external_id = o.external_id
      join app_user u on u.id = o.buyer_user_id
      where true
        ${scope()}
        ${statusFilter}
        ${fromFilter}
        ${toFilter}
        ${keyword}
      order by o.created_at desc, o.out_trade_no desc
      limit ${pageSize}
      offset ${(page - 1) * pageSize}
    `
    const summary = summaryRows[0]
    return context.json({
      orders: rows.map((row) => ({
        alipayTradeNo: row.alipay_trade_no,
        amount: moneyText(row.amount),
        createdAt: row.created_at.toISOString(),
        deviceMissing: row.device_missing,
        externalId: row.external_id,
        host: row.host,
        months: row.months,
        name: row.name,
        outTradeNo: row.out_trade_no,
        paidAt: row.paid_at?.toISOString() ?? null,
        refundReason: row.refund_reason,
        refundedAt: row.refunded_at?.toISOString() ?? null,
        status: row.status,
        ...(viewer.platformAdmin ? { buyerEmail: row.buyer_email, buyerName: row.buyer_name } : {}),
      })),
      page,
      pageSize,
      scope: viewer.platformAdmin ? "all" : "own",
      summary: {
        paidAmount: moneyText(summary?.paid_amount ?? "0"),
        paidCount: summary?.paid_count ?? 0,
        pendingCount: summary?.pending_count ?? 0,
        refundedAmount: moneyText(summary?.refunded_amount ?? "0"),
        refundedCount: summary?.refunded_count ?? 0,
      },
      total: totalRows[0]?.total ?? 0,
    })
  })

  app.post("/api/box-service/orders/reconcile", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    const parsed = reconcileBody.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success) return context.json({ error: "无效订单" }, 400)
    const owned = await sql<{ status: string }[]>`
      select status
      from box_service_order
      where out_trade_no = ${parsed.data.outTradeNo}
        ${orderScope(sql, viewer, sql`buyer_user_id`)}
    `
    const local = owned[0]
    if (local === undefined) return context.json({ error: "没有这张订单" }, 404)
    // The notify may have landed first; no need to ask Alipay again.
    if (local.status === "paid" || local.status === "refunded") return context.json({ ok: true })
    // `pending: true` means Alipay may still confirm it; the page keeps asking for a while.
    const trade = await queryTrade(parsed.data.outTradeNo)
    if (trade === null || trade.kind === "absent")
      return context.json({ error: "还没有查到支付结果", pending: true }, 409)
    if (trade.tradeStatus === "TRADE_CLOSED") {
      await closePendingOrder(sql, parsed.data.outTradeNo)
      return context.json({ error: "订单已关闭" }, 409)
    }
    if (!tradePaid(trade.tradeStatus))
      return context.json({ error: "订单未支付", pending: true }, 409)
    try {
      const result = await grantAndAudit(
        parsed.data.outTradeNo,
        trade.tradeNo,
        trade.amount,
        "reconcile",
      )
      if (result === "mismatch" || result === "missing") {
        return context.json({ error: "订单金额不一致" }, 409)
      }
    } catch {
      return context.json({ error: "发放时长失败" }, 500)
    }
    return context.json({ ok: true })
  })

  app.post("/api/box-service/orders/:outTradeNo/refund", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    if (!viewer.platformAdmin) return context.json({ error: "只有系统账号能退款" }, 403)
    if (alipayConfig() === null) return context.json({ error: "未配置支付宝" }, 503)
    const parsed = refundBody.safeParse(await context.req.json().catch(() => null))
    if (!parsed.success) return context.json({ error: "请填写退款原因" }, 400)
    const outTradeNo = context.req.param("outTradeNo")
    const orders = await sql<{ amount: string; status: string }[]>`
      select amount, status from box_service_order where out_trade_no = ${outTradeNo}
    `
    const order = orders[0]
    if (order === undefined) return context.json({ error: "没有这张订单" }, 404)
    if (order.status === "refunded") return context.json({ ok: true })
    if (order.status !== "paid") return context.json({ error: "只有已支付的订单能退款" }, 409)
    const refunded = await refundTrade(outTradeNo, order.amount, parsed.data.reason).catch(
      () => ({ error: "支付宝退款请求失败或超时，可以重试", ok: false }) as const,
    )
    if (!refunded.ok) {
      await audit(auditRepository, {
        action: "box_service.order.refund",
        actorId: viewer.id,
        metadata: { error: refunded.error },
        outcome: AuditOutcome.Failed,
        target: `box_service_order:${outTradeNo}`,
      })
      return context.json({ error: refunded.error }, 502)
    }
    const revoked = await revokeOrder(sql, outTradeNo, viewer.id, parsed.data.reason)
    if (revoked !== null)
      await audit(auditRepository, {
        action: "box_service.order.refund",
        actorId: viewer.id,
        metadata: {
          amount: moneyText(order.amount),
          externalId: revoked.externalId,
          months: String(revoked.months),
          reason: parsed.data.reason,
        },
        outcome: AuditOutcome.Allowed,
        target: `box_service_order:${outTradeNo}`,
      })
    return context.json({ ok: true })
  })

  // Fee records are written by init-tool into box_fee; this side only reads them.
  // They are charged per box, so they belong to whoever the box is assigned to now.
  app.get("/api/box-service/fees", async (context) => {
    const viewer = await viewerFromRequest(sql, context.req.raw)
    if (viewer === null) return context.json({ error: "未登录" }, 401)
    const query = listQuery((key) => context.req.query(key))
    if ("error" in query) return context.json({ error: query.error }, 400)
    const { from, page, pageSize, q, toExclusive } = query
    const empty = {
      available: false,
      fees: [],
      page,
      pageSize,
      scope: viewer.platformAdmin ? "all" : "own",
      summary: { amount: "0.00", count: 0 },
      total: 0,
    }
    const table = await sql<{ present: boolean }[]>`
      select to_regclass('public.box_fee') is not null as present
    `
    if (table[0]?.present !== true) return context.json(empty)
    const like = likePattern(q)
    const scope = viewer.platformAdmin
      ? sql``
      : sql`and (
          d.assignee_user_id = ${viewer.id}::uuid
          or d.assignee_user_id in (${descendants(sql, viewer.id)})
        )`
    const fromFilter = from === null ? sql`` : sql`and f.created_at >= ${from}`
    const toFilter = toExclusive === null ? sql`` : sql`and f.created_at < ${toExclusive}`
    const keyword =
      q === ""
        ? sql``
        : sql`and (
            f.box_id ilike ${like} escape '\\'
            or f.note ilike ${like} escape '\\'
            or coalesce(d.host, '') ilike ${like} escape '\\'
            or coalesce(d.name, '') ilike ${like} escape '\\'
            ${
              viewer.platformAdmin
                ? sql`or coalesce(u.email, '') ilike ${like} escape '\\'
                    or coalesce(u.display_name, '') ilike ${like} escape '\\'`
                : sql``
            }
          )`
    const filtered = () => sql`
      from box_fee f
      left join device d on d.external_id = f.box_id
      left join app_user u on u.id = d.assignee_user_id
      where true
        ${scope}
        ${fromFilter}
        ${toFilter}
        ${keyword}
    `
    const totals = await sql<{ amount: string; count: number }[]>`
      select coalesce(sum(f.amount_yuan), 0)::text as amount, count(*)::int as count
      ${filtered()}
    `
    const rows = await sql<
      {
        amount_yuan: number
        box_id: string
        created_at: Date
        host: string
        id: string
        name: string
        note: string
        owner_email: string
        owner_name: string
      }[]
    >`
      select
        f.id::text as id,
        f.box_id,
        f.amount_yuan,
        f.note,
        f.created_at,
        coalesce(d.host, '') as host,
        coalesce(d.name, '') as name,
        coalesce(u.email, '') as owner_email,
        coalesce(u.display_name, '') as owner_name
      ${filtered()}
      order by f.created_at desc, f.id desc
      limit ${pageSize}
      offset ${(page - 1) * pageSize}
    `
    return context.json({
      ...empty,
      available: true,
      fees: rows.map((row) => ({
        amount: moneyText(row.amount_yuan),
        boxId: row.box_id,
        createdAt: row.created_at.toISOString(),
        host: row.host,
        id: row.id,
        name: row.name,
        note: row.note,
        ...(viewer.platformAdmin ? { ownerEmail: row.owner_email, ownerName: row.owner_name } : {}),
      })),
      summary: {
        amount: moneyText(totals[0]?.amount ?? "0"),
        count: totals[0]?.count ?? 0,
      },
      total: totals[0]?.count ?? 0,
    })
  })

  app.post("/api/pay/alipay/notify", async (context) => {
    const config = alipayConfig()
    if (config === null) return context.text("failure")
    const body = await context.req.parseBody()
    const params: Record<string, string> = {}
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") params[key] = value
    }
    if (params["app_id"] !== config.appId) return context.text("failure")
    if (!verifyParams(params, config.publicKey)) return context.text("failure")
    const status = params["trade_status"] ?? ""
    const outTradeNo = params["out_trade_no"] ?? ""
    if (status === "TRADE_CLOSED") {
      await closePendingOrder(sql, outTradeNo)
      return context.text("success")
    }
    if (!tradePaid(status)) return context.text("success")
    try {
      const result = await grantAndAudit(
        outTradeNo,
        params["trade_no"] ?? "",
        params["total_amount"] ?? "",
        "notify",
      )
      if (result === "mismatch" || result === "missing") return context.text("failure")
    } catch {
      return context.text("failure")
    }
    return context.text("success")
  })

  return { sweepPendingOrders }
}
