import { createHash } from "node:crypto"
import { Resolver, lookup } from "node:dns/promises"
import { setTimeout as sleep } from "node:timers/promises"

import type { Hono } from "hono"
import { stream } from "hono/streaming"
import { convert } from "html-to-text"
import { ImapFlow } from "imapflow"
import { simpleParser } from "mailparser"
import type { Sql } from "postgres"

import type { SecretCipher } from "../lib/crypto"

const phrases = {
  account: "没有账号",
  folder: "Outlook IMAP 连接失败",
  invalid: "参数无效",
  timeout: "等待验证码超时",
  token: "微软令牌交换失败",
  tokenMissing: "没有邮箱令牌",
} as const

type Phrase = (typeof phrases)[keyof typeof phrases]

export class MailFailure extends Error {
  constructor(readonly phrase: Phrase) {
    super(phrase)
    this.name = "MailFailure"
  }
}

export type MailClock = {
  readonly folder: string
  readonly folders: readonly string[]
  readonly interval: number
  readonly lookback: number
  readonly timeout: number
}

const bearer = (header: string | undefined): string => {
  const value = header ?? ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : ""
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && error.code === "23505"

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "")

const readInt = (value: unknown, min: number, max: number): number | null => {
  const text = typeof value === "number" && Number.isInteger(value) ? String(value) : value
  if (typeof text !== "string" || !/^\d+$/.test(text)) return null
  const parsed = Number(text)
  if (parsed < min || parsed > max) return null
  return parsed
}

export const parseMailClock = (body: unknown): MailClock | null => {
  const raw = record(body)
  if (raw === null) return null
  const timeout = readInt(raw["timeout"], 1, 1800)
  const interval = readInt(raw["interval"], 1, 60)
  const lookback = readInt(raw["lookback"], 0, 300)
  const folders = textOf(raw["folder"])
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (
    timeout === null ||
    interval === null ||
    lookback === null ||
    folders.length === 0 ||
    folders.some((item) => item.length > 80 || /[\r\n]/.test(item))
  ) {
    return null
  }
  return { folder: folders.join(","), folders, interval, lookback, timeout }
}

export const maskEmail = (email: string): string => {
  const at = email.lastIndexOf("@")
  if (at <= 0) return `${email.slice(0, 1)}***`
  return `${email.slice(0, 1)}***${email.slice(at)}`
}

const isTikTok = (address: string | undefined): boolean => {
  const domain = address?.split("@")[1]?.toLowerCase()
  return domain === "tiktok.com" || domain?.endsWith(".tiktok.com") === true
}

export const extractTikTokCode = async (
  source: Buffer,
  recipient: string,
): Promise<string | "multi" | "skip"> => {
  const mail = await simpleParser(source, {
    skipHtmlToText: true,
    skipImageLinks: true,
    skipTextToHtml: true,
  })
  const to = [mail.to].flatMap((value) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value],
  )
  if (mail.from?.value.length !== 1 || !isTikTok(mail.from.value[0]?.address)) return "skip"
  if (!to.some((item) => item.value.some((address) => address.address?.toLowerCase() === recipient.toLowerCase())))
    return "skip"
  const html = typeof mail.html === "string" ? mail.html : ""
  const body =
    mail.text ||
    (html.length > 0
      ? convert(html, {
          selectors: [
            { options: { ignoreHref: true }, selector: "a" },
            { format: "skip", selector: "img" },
            { format: "skip", selector: "script" },
            { format: "skip", selector: "style" },
          ],
        })
      : "")
  const text = `${mail.subject ?? ""}\n${body}`
  if (!/verification|verify|login|log in|sign in|code|验证码|验证代码/i.test(text)) return "skip"
  const codes = new Set(
    Array.from(text.matchAll(/(?<![\p{L}\p{N}_])[0-9]{6}(?![\p{L}\p{N}_])/gu), (match) => match[0]),
  )
  if (codes.size > 1) return "multi"
  return codes.values().next().value ?? "skip"
}

const roundLine = (
  round: number,
  parts: readonly string[],
  code: string,
): string => {
  const head = `获取验证码第 ${round} 次，${parts.join("，")}`
  return code.length > 0 ? `${head}，取到验证码 ${code}` : head
}

const folderPart = (
  folder: string,
  candidates: number,
  early: number,
  multi: number,
  unmatched: number,
): string => {
  const notes = [
    early > 0 ? `${early} 封早于范围` : "",
    multi > 0 ? "验证码不唯一" : "",
    unmatched > 0 ? `${unmatched} 封未匹配` : "",
  ].filter((item) => item.length > 0)
  const count = `${folder} 候选 ${candidates}`
  return notes.length === 0 ? count : `${count}，${notes.join("，")}`
}

const outlookHost = "outlook.office365.com"

const redactLog = (error: unknown): string => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[mailbox]")
    .replace(/[A-Za-z0-9._~+/-]{20,}/g, "[redacted]")
    .slice(0, 180)
}

const outlookClient = async (email: string, accessToken: string): Promise<ImapFlow> => {
  const resolver = new Resolver()
  resolver.setServers(["223.5.5.5", "119.29.29.29"])
  let address = ""
  let last: unknown
  for (let attempt = 0; attempt < 4 && address.length === 0; attempt += 1) {
    try {
      const found = await resolver.resolve4(outlookHost)
      address = found.find((item) => item.length > 0) ?? ""
    } catch (error) {
      last = error
    }
    if (address.length === 0) {
      try {
        const found = await lookup(outlookHost, { family: 4 })
        address = found.address
      } catch (error) {
        last = error
      }
    }
    if (address.length === 0) await sleep(300)
  }
  if (address.length === 0) {
    console.error("mail code dns", redactLog(last))
    throw new MailFailure(phrases.folder)
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const client = new ImapFlow({
      auth: { accessToken, user: email },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      host: address,
      logger: false,
      port: 993,
      secure: true,
      servername: outlookHost,
      socketTimeout: 20_000,
    })
    try {
      await client.connect()
      return client
    } catch (error) {
      last = error
      client.close()
    }
  }
  console.error("mail code imap", redactLog(last))
  throw new MailFailure(phrases.folder)
}

const exchangeToken = async (clientId: string, refreshToken: string): Promise<string> => {
  let response: Response
  try {
    response = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        scope: "https://outlook.office.com/IMAP.AccessAsUser.All offline_access",
      }),
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new MailFailure(phrases.token)
  }
  if (!response.ok) throw new MailFailure(phrases.token)
  const payload = record(await response.json().catch(() => null))
  const access = textOf(payload?.["access_token"])
  if (access.length === 0) throw new MailFailure(phrases.token)
  return access
}

const pollCode = async (
  email: string,
  accessToken: string,
  clock: MailClock,
  cutoff: number,
  onRound: (text: string) => Promise<void>,
): Promise<string> => {
  const client = await outlookClient(email, accessToken)
  const deadline = AbortSignal.timeout(clock.timeout * 1000)
  const close = () => {
    client.close()
  }
  client.on("error", close)
  deadline.addEventListener("abort", close, { once: true })
  try {
    const seen = new Set<string>()
    let round = 0
    while (!deadline.aborted) {
      round += 1
      const parts: string[] = []
      let opened = 0
      for (const folder of clock.folders) {
        let mailbox: { uidValidity: bigint | number }
        try {
          mailbox = await client.mailboxOpen(folder, { readOnly: true })
          opened += 1
        } catch (error) {
          console.error("mail code folder", folder, redactLog(error))
          continue
        }
        const uids = await client.search(
          { from: "tiktok.com", since: new Date(cutoff - 86_400_000) },
          { uid: true },
        )
        const list = Array.isArray(uids) ? [...uids].sort((left, right) => right - left) : []
        let early = 0
        let multi = 0
        let unmatched = 0
        let found = ""
        for (const uid of list) {
          const key = `${folder}\0${mailbox.uidValidity}\0${uid}`
          if (seen.has(key)) continue
          const full = await client.fetchOne(String(uid), { internalDate: true, source: true }, { uid: true })
          if (full === false || full.source === undefined) continue
          seen.add(key)
          if (!(full.internalDate instanceof Date) || full.internalDate.getTime() < cutoff) {
            early += 1
            continue
          }
          const extracted = await extractTikTokCode(full.source, email)
          if (extracted === "multi") {
            multi += 1
            continue
          }
          if (extracted === "skip") {
            unmatched += 1
            continue
          }
          found = extracted
          break
        }
        parts.push(folderPart(folder, list.length, early, multi, unmatched))
        if (found.length > 0) {
          await onRound(roundLine(round, parts, found))
          return found
        }
      }
      if (opened === 0) throw new MailFailure(phrases.folder)
      await onRound(roundLine(round, parts, ""))
      if (deadline.aborted) break
      await sleep(clock.interval * 1000, undefined, { signal: deadline }).catch(() => undefined)
    }
    throw new MailFailure(phrases.timeout)
  } catch (error) {
    if (error instanceof MailFailure) throw error
    if (deadline.aborted) throw new MailFailure(phrases.timeout)
    console.error("mail code imap", redactLog(error))
    throw new MailFailure(phrases.folder)
  } finally {
    deadline.removeEventListener("abort", close)
    client.close()
  }
}

type MailEvent = {
  readonly code?: string
  readonly error?: string
  readonly event: "error" | "log" | "ok"
  readonly text: string
}

const sourceValue = (
  source: string,
  account: { readonly clientId: string; readonly email: string; readonly identifier: string; readonly token: string },
): string => {
  switch (source) {
    case "account.email":
      return account.email
    case "account.identifier":
      return account.identifier
    case "account.ms_client_id":
      return account.clientId
    case "account.ms_token":
      return account.token
    default:
      return ""
  }
}

const internalScopes = {
  clientId: "internal",
  email: "internal",
  refreshToken: "internal",
} as const

const accountConstrained = (source: unknown): boolean => textOf(source).startsWith("account.")

export const resolveMailLogin = (
  scopes: Record<string, unknown>,
  sources: Record<string, unknown>,
  literals: Record<string, unknown>,
  account: { readonly clientId: string; readonly email: string; readonly identifier: string; readonly token: string },
): { readonly clientId: string; readonly email: string; readonly refreshToken: string } | null => {
  const readField = (key: "clientId" | "email" | "refreshToken", sourceKey: string): string => {
    if (scopes[key] !== "external") return textOf(literals[key])
    const source = textOf(sources[sourceKey])
    if (!accountConstrained(source)) return ""
    return sourceValue(source, account)
  }
  const email = readField("email", "email")
  const clientId = readField("clientId", "clientId")
  const refreshToken = readField("refreshToken", "refreshToken")
  if (email.length === 0 || clientId.length === 0 || refreshToken.length === 0) return null
  return { clientId, email, refreshToken }
}

const mailFromTaskParameters = (
  parameters: unknown,
  sequence?: number,
): { readonly literals: Record<string, unknown>; readonly scopes: Record<string, unknown>; readonly sources: Record<string, unknown> } | null => {
  if (!Array.isArray(parameters)) return null
  const rows = parameters.map((item) => record(item))
  const indexed = sequence === undefined ? undefined : rows[sequence]
  const found =
    indexed?.["skill"] === "FetchMailCode"
      ? indexed
      : rows.find((item) => item?.["skill"] === "FetchMailCode")
  if (found === undefined || found === null) return null
  return {
    literals: record(found["input"]) ?? {},
    scopes: record(found["scopes"]) ?? { ...internalScopes },
    sources: record(found["sources"]) ?? {},
  }
}

const mailNeedsAccount = (scopes: Record<string, unknown>, sources: Record<string, unknown>): boolean =>
  (["clientId", "email", "refreshToken"] as const).some(
    (key) => scopes[key] === "external" && accountConstrained(sources[key]),
  )

const loadMailLogin = async (
  sql: Sql,
  cipher: SecretCipher,
  token: string,
  taskId: string,
): Promise<
  | { accountId: string | null; clientId: string; createdAt: Date; email: string; groupId: string; refreshToken: string }
  | { error: Phrase }
> => {
  const rows = await sql<
    { accountId: string | null; createdAt: Date; groupId: string }[]
  >`
    select t.group_id::text as "groupId", t.account_id::text as "accountId", t.created_at as "createdAt"
    from execution_task t
    join device_agent a on a.device_id = t.device_id
    where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)}
  `
  const task = rows[0]
  if (task === undefined) return { error: phrases.invalid }
  const steps = await sql<
    {
      dispatchParameters: unknown
      scopes: unknown
      sources: unknown
      stepParameters: unknown
      taskParameters: unknown
    }[]
  >`
    select s.parameters as "stepParameters", t.parameters as "taskParameters",
      ds.parameters as "dispatchParameters", ds.scopes, ds.sources
    from execution_task t
    join execution_task_step s on s.task_id = t.id and s.kind = 'FetchMailCode'
    left join operation_dispatch_step ds on ds.item_id = t.dispatch_item_id
      and ds.stage_position = t.stage_position
      and ds.repeat_index = t.repeat_index
      and ds.sequence = s.sequence
      and ds.skill = 'FetchMailCode'
    where t.id = ${taskId}::uuid
    order by s.sequence
    limit 1
  `
  const step = steps[0]
  const hasDispatch = step?.dispatchParameters != null && step.scopes != null
  const carried = mailFromTaskParameters(step?.taskParameters)
  const scopes = hasDispatch ? (record(step?.scopes) ?? {}) : (carried?.scopes ?? { ...internalScopes })
  const sources = hasDispatch ? (record(step?.sources) ?? {}) : (carried?.sources ?? {})
  const literals = hasDispatch
    ? (record(step?.dispatchParameters) ?? {})
    : (carried?.literals ?? record(step?.stepParameters) ?? {})
  if (mailNeedsAccount(scopes, sources) && task.accountId === null) {
    return { error: phrases.account }
  }
  const accounts =
    !mailNeedsAccount(scopes, sources) || task.accountId === null
      ? []
      : await sql<{ extra: unknown; identifier: string }[]>`
          select identifier, extra from operation_account
          where id = ${task.accountId}::uuid and group_id = ${task.groupId}::uuid and deleted = false
        `
  const stored = accounts[0]
  const extra = record(stored?.extra) ?? {}
  const parsed = record(record(extra["task_param_copy"])?.["parsed_reg_resource"])
  const emailField = textOf(parsed?.["email"])
  let sealedToken = ""
  const sealed = textOf(extra["sealed"])
  if (sealed.length > 0) {
    try {
      sealedToken = textOf(record(JSON.parse(cipher.decrypt(sealed)))?.["msToken"])
    } catch {
      sealedToken = ""
    }
  }
  const account = {
    clientId: textOf(parsed?.["msClientId"]),
    email: emailField.length > 0 ? emailField : textOf(stored?.identifier).trim(),
    identifier: textOf(stored?.identifier).trim(),
    token: sealedToken,
  }
  const resolved = resolveMailLogin(scopes, sources, literals, account)
  if (resolved === null) return { error: phrases.tokenMissing }
  return { accountId: task.accountId, createdAt: task.createdAt, groupId: task.groupId, ...resolved }
}

export const registerMailCode = (app: Hono, sql: Sql, cipher: SecretCipher | undefined) => {
  app.post("/agent/mail-code", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = record(await context.req.json().catch(() => null))
    const taskId = textOf(body?.["taskId"])
    const stepId = textOf(body?.["stepId"])
    if (token === "" || !isUuid(taskId) || !isUuid(stepId)) return context.json({ error: phrases.invalid }, 401)
    if (cipher === undefined) return context.json({ error: phrases.invalid }, 500)
    const rows = await sql<
      {
        accountId: string | null
        createdAt: Date
        dispatchItemId: string | null
        groupId: string
        kind: string
        repeatIndex: number
        sequence: number
        stagePosition: number
      }[]
    >`
      select t.group_id::text as "groupId", t.account_id::text as "accountId", t.created_at as "createdAt",
        t.dispatch_item_id::text as "dispatchItemId", t.stage_position as "stagePosition",
        t.repeat_index as "repeatIndex", s.kind, s.sequence
      from execution_task t
      join execution_task_step s on s.task_id = t.id and s.id = ${stepId}::uuid
      join device_agent a on a.device_id = t.device_id
      where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)} and s.kind = 'FetchMailCode'
    `
    const task = rows[0]
    if (task === undefined) return context.json({ error: phrases.invalid }, 404)
    context.header("cache-control", "no-cache")
    context.header("content-type", "application/x-ndjson; charset=utf-8")
    context.header("x-accel-buffering", "no")
    return stream(context, async (out) => {
      const write = async (event: MailEvent) => {
        await out.write(`${JSON.stringify(event)}\n`)
      }
      const fail = async (phrase: Phrase, rowId: string | null) => {
        if (rowId !== null) {
          await sql`
            update mail_code_fetch
            set status = 'failed', error_code = ${phrase}, finished_at = now()
            where id = ${rowId}::uuid and status = 'waiting'
          `
        }
        await write({ error: phrase, event: "error", text: `获取验证码失败：${phrase}` })
      }
      const clock = parseMailClock(body)
      if (clock === null) {
        await write({ error: phrases.invalid, event: "error", text: `获取验证码失败：${phrases.invalid}` })
        return
      }
      const saved = await sql<{ code: string }[]>`
        select code from mail_code_fetch
        where task_id = ${taskId}::uuid and status = 'succeeded'
        order by created_at desc
        limit 1
      `
      const remembered = saved[0]?.code ?? ""
      if (/^[0-9]{6}$/.test(remembered)) {
        await write({
          code: remembered,
          event: "ok",
          text: `获取验证码成功，验证码 ${remembered}`,
        })
        return
      }
      const dispatch =
        task.dispatchItemId === null
          ? []
          : await sql<{ parameters: unknown; scopes: unknown; sources: unknown }[]>`
              select parameters, scopes, sources
              from operation_dispatch_step
              where item_id = ${task.dispatchItemId}::uuid
                and stage_position = ${task.stagePosition}
                and repeat_index = ${task.repeatIndex}
                and sequence = ${task.sequence}
                and skill = 'FetchMailCode'
            `
      const step = dispatch[0]
      const hasDispatch = step !== undefined
      const stepRows = await sql<{ parameters: unknown; taskParameters: unknown }[]>`
        select s.parameters, t.parameters as "taskParameters"
        from execution_task_step s
        join execution_task t on t.id = s.task_id
        where s.id = ${stepId}::uuid and s.task_id = ${taskId}::uuid
      `
      const carried = mailFromTaskParameters(stepRows[0]?.taskParameters, task.sequence)
      const scopes = hasDispatch ? (record(step?.scopes) ?? {}) : (carried?.scopes ?? { ...internalScopes })
      const sources = hasDispatch ? (record(step?.sources) ?? {}) : (carried?.sources ?? {})
      const literals = hasDispatch
        ? (record(step?.parameters) ?? {})
        : (carried?.literals ?? record(stepRows[0]?.parameters) ?? {})
      const needsAccount = mailNeedsAccount(scopes, sources)
      if (needsAccount && task.accountId === null) {
        await fail(phrases.account, null)
        return
      }
      const accounts =
        needsAccount && task.accountId !== null
          ? await sql<{ extra: unknown; identifier: string }[]>`
              select identifier, extra from operation_account
              where id = ${task.accountId}::uuid and group_id = ${task.groupId}::uuid and deleted = false
            `
          : []
      const stored = accounts[0]
      const extra = record(stored?.extra) ?? {}
      const parsed = record(record(extra["task_param_copy"])?.["parsed_reg_resource"])
      const emailField = textOf(parsed?.["email"])
      let token = ""
      const sealed = textOf(extra["sealed"])
      if (sealed.length > 0) {
        try {
          token = textOf(record(JSON.parse(cipher.decrypt(sealed)))?.["msToken"])
        } catch {
          token = ""
        }
      }
      const account = {
        clientId: textOf(parsed?.["msClientId"]),
        email: emailField.length > 0 ? emailField : textOf(stored?.identifier).trim(),
        identifier: textOf(stored?.identifier).trim(),
        token,
      }
      const resolved = resolveMailLogin(scopes, sources, literals, account)
      if (resolved === null) {
        await fail(phrases.tokenMissing, null)
        return
      }
      await sql`
        update mail_code_fetch
        set status = 'failed', error_code = ${phrases.timeout}, finished_at = now()
        where step_id = ${stepId}::uuid and status = 'waiting'
          and created_at < now() - make_interval(secs => ${clock.timeout + 60})
      `
      let rowId = ""
      try {
        const inserted = await sql<{ id: string }[]>`
          insert into mail_code_fetch (
            group_id, task_id, step_id, account_id, status, timeout_seconds, interval_seconds,
            lookback_seconds, folder
          ) values (
            ${task.groupId}::uuid, ${taskId}::uuid, ${stepId}::uuid, ${task.accountId}::uuid, 'waiting',
            ${clock.timeout}, ${clock.interval}, ${clock.lookback}, ${clock.folder}
          )
          returning id::text as id
        `
        rowId = inserted[0]?.id ?? ""
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        await fail(phrases.invalid, null)
        return
      }
      if (rowId.length === 0) {
        await fail(phrases.invalid, null)
        return
      }
      const { clientId, email, refreshToken } = resolved
      try {
        await write({
          event: "log",
          text: `获取验证码开始，邮箱 ${maskEmail(email)}，等待 ${clock.timeout} 秒，间隔 ${clock.interval} 秒，邮件夹 ${clock.folder}`,
        })
        const cutoff = Math.floor(task.createdAt.getTime() / 1000) * 1000 - clock.lookback * 1000
        const access = await exchangeToken(clientId, refreshToken)
        const code = await pollCode(email, access, clock, cutoff, async (text) => {
          await write({ event: "log", text })
        })
        await sql`
          update mail_code_fetch
          set status = 'succeeded', code = ${code}, finished_at = now()
          where id = ${rowId}::uuid and status = 'waiting'
        `
        await write({ code, event: "ok", text: `获取验证码成功，验证码 ${code}` })
      } catch (error) {
        const phrase = error instanceof MailFailure ? error.phrase : phrases.folder
        if (!(error instanceof MailFailure)) console.error("mail code failed", error instanceof Error ? error.name : "unknown")
        await fail(phrase, rowId)
      }
    })
  })

  app.post("/agent/mail-material", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = record(await context.req.json().catch(() => null))
    const taskId = textOf(body?.["taskId"])
    if (token === "" || !isUuid(taskId)) return context.json({ error: phrases.invalid }, 401)
    if (cipher === undefined) return context.json({ error: phrases.invalid }, 500)
    const login = await loadMailLogin(sql, cipher, token, taskId)
    if ("error" in login) return context.json({ error: login.error }, login.error === phrases.invalid ? 404 : 400)
    return context.json({
      clientId: login.clientId,
      createdAt: login.createdAt.toISOString(),
      email: login.email,
      refreshToken: login.refreshToken,
    })
  })

  app.post("/agent/mail-result", async (context) => {
    const token = bearer(context.req.header("authorization"))
    const body = record(await context.req.json().catch(() => null))
    const taskId = textOf(body?.["taskId"])
    const stepId = textOf(body?.["stepId"])
    if (token === "" || !isUuid(taskId) || !isUuid(stepId)) return context.json({ error: phrases.invalid }, 401)
    const timeout = readInt(body?.["timeout"], 1, 1800) ?? 120
    const interval = readInt(body?.["interval"], 1, 60) ?? 5
    const lookbackRaw = readInt(body?.["lookback"], 0, 7200) ?? 30
    const lookback = Math.min(lookbackRaw, 300)
    const folder = textOf(body?.["folder"]) || "INBOX,Junk"
    const code = textOf(body?.["code"])
    const phrase = textOf(body?.["error"])
    const rows = await sql<{ accountId: string | null; groupId: string }[]>`
      select t.group_id::text as "groupId", t.account_id::text as "accountId"
      from execution_task t
      join execution_task_step s on s.task_id = t.id and s.id = ${stepId}::uuid
      join device_agent a on a.device_id = t.device_id
      where t.id = ${taskId}::uuid and a.token_hash = ${hashToken(token)} and s.kind = 'FetchMailCode'
    `
    const task = rows[0]
    if (task === undefined) return context.json({ error: phrases.invalid }, 404)
    if (/^[0-9]{6}$/.test(code)) {
      await sql`
        insert into mail_code_fetch (
          group_id, task_id, step_id, account_id, status, code, timeout_seconds, interval_seconds,
          lookback_seconds, folder, finished_at
        ) values (
          ${task.groupId}::uuid, ${taskId}::uuid, ${stepId}::uuid, ${task.accountId}::uuid, 'succeeded',
          ${code}, ${timeout}, ${interval}, ${lookback}, ${folder}, now()
        )
      `
      return context.json({ ok: true })
    }
    const errorCode = phrase.length > 0 ? phrase : phrases.timeout
    await sql`
      insert into mail_code_fetch (
        group_id, task_id, step_id, account_id, status, error_code, timeout_seconds, interval_seconds,
        lookback_seconds, folder, finished_at
      ) values (
        ${task.groupId}::uuid, ${taskId}::uuid, ${stepId}::uuid, ${task.accountId}::uuid, 'failed',
        ${errorCode}, ${timeout}, ${interval}, ${lookback}, ${folder}, now()
      )
    `
    return context.json({ ok: true })
  })
}
