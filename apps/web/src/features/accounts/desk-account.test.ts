import { describe, expect, it } from "vitest"
import { accountWrite, applyCredential } from "./desk-account"
import { createBackupAccount } from "./myt-account"

describe("account API mapping", () => {
  it("separates resource secrets from public extra without mutating the edited account", () => {
    const account = createBackupAccount({
      id: 1,
      app: "tiktok",
      backType: "2",
      createTime: "2026-10-06 12:00:00",
      deviceId: 1,
      deviceSeq: 1,
      password: "account-secret",
      proxyId: null,
      tag: "primary",
      username: "account",
    })
    account.tagBucket = ["secondary"]
    account.extra.task_param_copy.parsed_reg_resource = {
      email: "account@example.test",
      emailPassword: "email-secret",
      msToken: "token-secret",
      pop3Password: "pop3-secret",
    }
    const original = structuredClone(account)
    const payload = accountWrite(account)
    expect(payload.tags).toEqual(["primary", "secondary"])
    expect(payload.resourceSecrets).toEqual({
      emailPassword: "email-secret",
      msToken: "token-secret",
      pop3Password: "pop3-secret",
    })
    expect(payload.extra.task_param_copy.parsed_reg_resource).toEqual({
      email: "account@example.test",
    })
    expect(payload.secret).toBe("account-secret")
    expect(account).toEqual(original)
  })

  it("preserves public binding fields when loading encrypted credentials", () => {
    const account = createBackupAccount({
      id: 1,
      app: "tiktok",
      backType: "2",
      createTime: "2026-10-06 12:00:00",
      deviceId: 1,
      deviceSeq: 1,
      password: "",
      proxyId: null,
      tag: "primary",
      username: "account",
    })
    account.extra.task_param_copy.parsed_reg_resource = { email: "account@example.test" }
    const loaded = applyCredential(account, {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      password: "account-secret",
      totp: "totp-secret",
      emailPassword: "email-secret",
      msToken: "",
      pop3Password: "",
    })
    expect(loaded.password).toBe("account-secret")
    expect(loaded.totp).toBe("totp-secret")
    expect(loaded.extra.task_param_copy.parsed_reg_resource).toEqual({
      email: "account@example.test",
      emailPassword: "email-secret",
    })
    expect(account.password).toBe("")
  })
})
