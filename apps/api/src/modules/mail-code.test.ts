import { describe, expect, it } from "bun:test"

import { extractTikTokCode, maskEmail, parseMailClock, resolveMailLogin } from "./mail-code"

const rawMail = (body: string, to = "user@outlook.com"): Buffer =>
  Buffer.from(
    [
      "From: TikTok <verify@account.tiktok.com>",
      `To: ${to}`,
      "Subject: Your verification code",
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n"),
  )

const emptyAccount = { clientId: "", email: "", identifier: "", token: "" }

describe("mail code", () => {
  it("uses a pasted internal token and leaves the account token alone", () => {
    const got = resolveMailLogin(
      { clientId: "internal", email: "internal", refreshToken: "internal" },
      { refreshToken: "account.ms_token" },
      { clientId: "client-1", email: "a@outlook.com", refreshToken: "pasted-token" },
      { ...emptyAccount, token: "account-token" },
    )
    expect(got).toEqual({ clientId: "client-1", email: "a@outlook.com", refreshToken: "pasted-token" })
  })

  it("uses the account for an external field that is constrained to the account", () => {
    const account = {
      clientId: "account-client",
      email: "a@outlook.com",
      identifier: "a@outlook.com",
      token: "account-token",
    }
    const got = resolveMailLogin(
      { clientId: "external", email: "external", refreshToken: "external" },
      { clientId: "account.ms_client_id", email: "account.email", refreshToken: "account.ms_token" },
      { clientId: "typed-client", email: "typed@b.c", refreshToken: "typed-token" },
      account,
    )
    expect(got).toEqual({
      clientId: "account-client",
      email: "a@outlook.com",
      refreshToken: "account-token",
    })
    expect(
      resolveMailLogin(
        { clientId: "internal", email: "internal", refreshToken: "internal" },
        { refreshToken: "account.ms_token" },
        { clientId: "client-1", email: "a@outlook.com", refreshToken: "" },
        { ...emptyAccount, token: "account-token" },
      ),
    ).toBeNull()
  })

  it("does not use the account when an external field has no account constraint", () => {
    expect(
      resolveMailLogin(
        { clientId: "internal", email: "internal", refreshToken: "external" },
        { clientId: "literal", email: "literal", refreshToken: "" },
        { clientId: "client-1", email: "a@outlook.com", refreshToken: "typed-token" },
        { ...emptyAccount, clientId: "account-client", email: "a@outlook.com", token: "account-token" },
      ),
    ).toBeNull()
  })

  it("masks the mailbox and accepts the clock", () => {
    expect(maskEmail("daphne@outlook.com")).toBe("d***@outlook.com")
    expect(
      parseMailClock({ folder: "INBOX, Junk", interval: "5", lookback: "30", timeout: "120" }),
    ).toEqual({
      folder: "INBOX,Junk",
      folders: ["INBOX", "Junk"],
      interval: 5,
      lookback: 30,
      timeout: 120,
    })
    expect(parseMailClock({ folder: "", interval: "5", lookback: "30", timeout: "120" })).toBeNull()
  })

  it("keeps a single TikTok code and drops two codes", async () => {
    expect(await extractTikTokCode(rawMail("Your code is 123456"), "user@outlook.com")).toBe("123456")
    expect(await extractTikTokCode(rawMail("codes 123456 and 654321"), "user@outlook.com")).toBe(
      "multi",
    )
    expect(await extractTikTokCode(rawMail("Your code is 123456"), "other@outlook.com")).toBe("skip")
  })
})
