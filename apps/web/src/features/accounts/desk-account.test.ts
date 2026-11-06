import { describe, expect, it } from "vitest"
import type { OperationAccount } from "./api"
import { accountWrite, applyCredential, toDeskAccount } from "./desk-account"
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

  it("keeps an unregistered account unregistered when the desk edits it", () => {
    const source: OperationAccount = {
      app: "tiktok",
      avatar: "",
      backupKey: "",
      backupName: "hmga0d5d4",
      backupSlot: "",
      backupType: null,
      createdAt: new Date("2026-10-14T00:00:00Z"),
      credentialState: "none",
      deleted: false,
      deletedAt: null,
      deviceId: null,
      deviceInstanceId: null,
      deviceName: null,
      extra: {},
      favorite: 0,
      follower: 0,
      following: 0,
      groupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      hasPassword: false,
      hasTotp: false,
      hasTransferKey: false,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      identifier: "pool@example.test",
      instanceIndex: null,
      instanceLabel: null,
      name: "pool@example.test",
      note: "",
      online: false,
      platformUid: "",
      proxyId: null,
      proxyName: null,
      region: "",
      status: "unregistered",
      tags: ["测试"],
      transferred: false,
      updatedAt: new Date("2026-10-14T00:00:00Z"),
    }
    const desk = toDeskAccount(source, 0)
    expect(desk.backupName).toBe("hmga0d5d4")
    expect(desk.status).toBe("4")
    expect(accountWrite(desk).status).toBe("unregistered")
  })
})
