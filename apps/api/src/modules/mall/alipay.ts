import { createPrivateKey, createPublicKey, createSign, createVerify } from "node:crypto"

export type AlipayConfig = {
  readonly appId: string
  readonly gateway: string
  readonly notifyUrl: string
  readonly privateKey: string
  readonly publicKey: string
  readonly returnUrl: string
}

/** 超过这个时间支付宝不再收款。本地要多等一会儿再关单，迟到的回调才能落账。 */
export const ALIPAY_PAY_TIMEOUT = "30m"
const REQUEST_TIMEOUT_MS = 10_000

const pemBody = (value: string): string =>
  value
    .replace(/-----[^-]+-----/g, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "")

/** 控制台给的裸 base64 可能是 PKCS8，也可能是支付宝密钥工具生成的 PKCS1，两种都要认。 */
const privateKeyOf = (value: string) => {
  if (value.includes("BEGIN")) return createPrivateKey(value.replace(/\\n/g, "\n"))
  const key = Buffer.from(pemBody(value), "base64")
  try {
    return createPrivateKey({ format: "der", key, type: "pkcs8" })
  } catch {
    return createPrivateKey({ format: "der", key, type: "pkcs1" })
  }
}

const publicKeyOf = (value: string) =>
  createPublicKey(
    value.includes("BEGIN")
      ? value.replace(/\\n/g, "\n")
      : {
          format: "der",
          key: Buffer.from(pemBody(value), "base64"),
          type: "spki",
        },
  )

/**
 * 应用 ID、两把密钥和回调地址都配好才启用，没配时页面只显示人工充值，下单接口返回 503。
 * 没有回调地址时付了款也要等补查才到账；密钥解析不了时每笔下单都会失败。
 * 这两种情况都在启动时拦下来，日志里不带密钥内容。
 */
export const alipayConfigFromEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
): AlipayConfig | null => {
  const read = (key: string): string => environment[key]?.trim() ?? ""
  const appId = read("ALIPAY_APP_ID")
  const privateKey = read("ALIPAY_PRIVATE_KEY")
  const publicKey = read("ALIPAY_PUBLIC_KEY")
  if (appId === "" || privateKey === "" || publicKey === "") return null
  const notifyUrl = read("ALIPAY_NOTIFY_URL")
  if (notifyUrl === "") {
    console.error("alipay disabled: ALIPAY_NOTIFY_URL is required")
    return null
  }
  try {
    privateKeyOf(privateKey)
    publicKeyOf(publicKey)
  } catch {
    console.error("alipay disabled: ALIPAY_PRIVATE_KEY or ALIPAY_PUBLIC_KEY cannot be parsed")
    return null
  }
  return {
    appId,
    gateway: read("ALIPAY_GATEWAY") || "https://openapi.alipay.com/gateway.do",
    notifyUrl,
    privateKey,
    publicKey,
    returnUrl: read("ALIPAY_RETURN_URL"),
  }
}

const shanghaiTimestamp = (): string => {
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

const canonical = (params: Readonly<Record<string, string>>): string =>
  Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== "")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&")

const signedQuery = (params: Readonly<Record<string, string>>, privateKey: string): string => {
  const filled = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== ""))
  const signer = createSign("RSA-SHA256")
  // 请求签名要带上 sign_type，回调验签时才去掉。
  signer.update(
    Object.keys(filled)
      .sort()
      .map((key) => `${key}=${filled[key]}`)
      .join("&"),
    "utf8",
  )
  const sign = signer.sign(privateKeyOf(privateKey), "base64")
  return new URLSearchParams({ ...filled, sign }).toString()
}

export type TradeQuery =
  | {
      readonly amount: string
      readonly kind: "found"
      readonly tradeNo: string
      readonly tradeStatus: string
    }
  /** 支付宝没有这笔交易：买家没走到付款那一步。 */
  | { readonly kind: "absent" }

export type AlipayGateway = {
  /** null 表示现在不知道结果（网关故障、超时、验签失败），以后再查。 */
  query(outTradeNo: string): Promise<TradeQuery | null>
  payUrl(input: {
    readonly amountYuan: string
    readonly outTradeNo: string
    readonly subject: string
  }): string
  verifyNotify(params: Readonly<Record<string, string>>): boolean
}

export const isTradePaid = (status: string): boolean =>
  status === "TRADE_SUCCESS" || status === "TRADE_FINISHED"

const decodeBody = (body: Buffer, contentType: string): string => {
  const charset =
    /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase().replaceAll("_", "-") ?? "utf-8"
  return charset === "gbk" || charset === "gb2312" || charset === "gb18030"
    ? new TextDecoder("gb18030").decode(body)
    : new TextDecoder("utf-8").decode(body)
}

const textOf = (node: Readonly<Record<string, unknown>>, key: string): string => {
  const value = node[key]
  return typeof value === "string" ? value : ""
}

export const createAlipayGateway = (
  config: AlipayConfig,
  fetchImpl: typeof fetch = fetch,
): AlipayGateway => ({
  payUrl: ({ amountYuan, outTradeNo, subject }) => {
    const query = signedQuery(
      {
        app_id: config.appId,
        biz_content: JSON.stringify({
          out_trade_no: outTradeNo,
          product_code: "FAST_INSTANT_TRADE_PAY",
          subject,
          timeout_express: ALIPAY_PAY_TIMEOUT,
          total_amount: amountYuan,
        }),
        charset: "utf-8",
        format: "JSON",
        method: "alipay.trade.page.pay",
        notify_url: config.notifyUrl,
        return_url: config.returnUrl,
        sign_type: "RSA2",
        timestamp: shanghaiTimestamp(),
        version: "1.0",
      },
      config.privateKey,
    )
    return `${config.gateway}?${query}`
  },
  query: async (outTradeNo) => {
    try {
      const method = "alipay.trade.query"
      const response = await fetchImpl(config.gateway, {
        body: signedQuery(
          {
            app_id: config.appId,
            biz_content: JSON.stringify({ out_trade_no: outTradeNo }),
            charset: "utf-8",
            format: "JSON",
            method,
            sign_type: "RSA2",
            timestamp: shanghaiTimestamp(),
            version: "1.0",
          },
          config.privateKey,
        ),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      const raw = Buffer.from(await response.arrayBuffer())
      // 验签要用原始字节：响应可能是 GBK，先解码再验会失败。
      const matched = /"alipay_trade_query_response":(\{.*\}),"sign":"([^"]+)"/s.exec(
        raw.toString("latin1"),
      )
      if (matched === null) return null
      const verifier = createVerify("RSA-SHA256")
      const signed = Buffer.from(matched[1] ?? "", "latin1")
      verifier.update(signed)
      if (!verifier.verify(publicKeyOf(config.publicKey), matched[2] ?? "", "base64")) return null
      // 只解析验过签的那段。整体解析时，后面追加的同名字段会覆盖验过的内容。
      const node = JSON.parse(
        decodeBody(signed, response.headers.get("content-type") ?? ""),
      ) as Readonly<Record<string, unknown>>
      if (textOf(node, "sub_code") === "ACQ.TRADE_NOT_EXIST") return { kind: "absent" }
      if (textOf(node, "code") !== "10000" || textOf(node, "out_trade_no") !== outTradeNo) {
        return null
      }
      return {
        amount: textOf(node, "total_amount"),
        kind: "found",
        tradeNo: textOf(node, "trade_no"),
        tradeStatus: textOf(node, "trade_status"),
      }
    } catch {
      return null
    }
  },
  verifyNotify: (params) => {
    const { app_id: appId, sign = "" } = params
    if (sign === "" || appId !== config.appId) return false
    const verifier = createVerify("RSA-SHA256")
    verifier.update(canonical(params), "utf8")
    try {
      return verifier.verify(publicKeyOf(config.publicKey), sign, "base64")
    } catch {
      return false
    }
  },
})
