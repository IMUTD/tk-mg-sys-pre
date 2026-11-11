import { describe, expect, it } from "bun:test"

import { readAnchor, readStepSources } from "./account-anchor"

const account = { key: "id" as const, table: "operation_account" as const }

describe("account anchor", () => {
  it("accepts the account number or the login name", () => {
    expect(readAnchor(undefined)).toBeNull()
    expect(readAnchor(null)).toBeNull()
    expect(readAnchor({ key: "id", table: "operation_account" })).toEqual(account)
    expect(readAnchor({ key: "identifier", table: "operation_account" })).toEqual({
      key: "identifier",
      table: "operation_account",
    })
    expect(readAnchor({ key: "region", table: "operation_account" })).toBe("invalid")
    expect(readAnchor({ key: "id", table: "operation_proxy" })).toBe("invalid")
  })

  it("keeps an internal value literal", () => {
    expect(
      readStepSources({ text: "hi" }, { text: "internal" }, undefined, null, "SendText"),
    ).toEqual({
      text: "literal",
    })
    expect(
      readStepSources(
        { text: "hi" },
        { text: "internal" },
        { text: "account.identifier" },
        account,
        "SendText",
      ),
    ).toBeNull()
  })

  it("requires the account anchor for an external field", () => {
    expect(
      readStepSources(
        { text: "" },
        { text: "external" },
        { text: "account.identifier" },
        null,
        "SendText",
      ),
    ).toEqual({ text: "account.identifier" })
    expect(
      readStepSources({ text: "" }, { text: "external" }, { text: "" }, null, "SendText"),
    ).toEqual({ text: "" })
    expect(readStepSources({ text: "" }, { text: "external" }, {}, null, "SendText")).toEqual({
      text: "",
    })
    expect(
      readStepSources(
        { text: "" },
        { text: "external" },
        { text: "account.identifier" },
        account,
        "SendText",
      ),
    ).toEqual({
      text: "account.identifier",
    })
    expect(
      readStepSources(
        { text: "" },
        { text: "external" },
        { text: "pool.text" },
        account,
        "SendText",
      ),
    ).toEqual({ text: "pool.text" })
    expect(
      readStepSources(
        { text: "" },
        { text: "external" },
        { text: "pool.text" },
        null,
        "ClickNode",
      ),
    ).toEqual({ text: "pool.text" })
    expect(
      readStepSources(
        { clickChance: "", text: "" },
        { clickChance: "external", text: "external" },
        { clickChance: "chance.external", text: "pool.text" },
        null,
        "ClickJumpNodes",
      ),
    ).toEqual({ clickChance: "chance.external", text: "pool.text" })
    expect(
      readStepSources(
        { text: "你好" },
        { text: "internal" },
        { text: "pool.text" },
        null,
        "SendText",
      ),
    ).toBeNull()
    expect(
      readStepSources({ pkg: "" }, { pkg: "external" }, { pkg: "pool.text" }, null, "OpenApp"),
    ).toBeNull()
    expect(
      readStepSources(
        { 图片ID: "" },
        { 图片ID: "external" },
        { 图片ID: "media.image_id" },
        account,
        "UploadPitImage",
      ),
    ).toEqual({ 图片ID: "media.image_id" })
    expect(
      readStepSources(
        { vless: "" },
        { vless: "external" },
        { vless: "proxy.link" },
        account,
        "IndependentV5S5",
      ),
    ).toEqual({
      vless: "proxy.link",
    })
    expect(
      readStepSources(
        { s5Type: "", enforce: "" },
        { s5Type: "external", enforce: "external" },
        { s5Type: "proxy.tun", enforce: "proxy.safe" },
        account,
        "CreateAndroid",
      ),
    ).toEqual({ s5Type: "proxy.tun", enforce: "proxy.safe" })
    expect(
      readStepSources(
        { name: "" },
        { name: "external" },
        { name: "instance.name" },
        account,
        "BoxStop",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        { text: "" },
        { text: "external" },
        { text: "account.nickname" },
        account,
        "SendText",
      ),
    ).toBeNull()
    expect(
      readStepSources({ text: "" }, { text: "external" }, { text: "literal" }, account, "SendText"),
    ).toBeNull()
  })

  it("keeps the jump count inside the step", () => {
    const input = { className: "android.widget.FrameLayout", steps: "1" }
    expect(
      readStepSources(
        input,
        { className: "external", steps: "internal" },
        { className: "literal", steps: "literal" },
        account,
        "JumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        input,
        { className: "external", steps: "external" },
        { className: "account.identifier", steps: "literal" },
        account,
        "JumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        input,
        { className: "external", steps: "internal" },
        { className: "account.identifier", steps: "literal" },
        account,
        "JumpNodes",
      ),
    ).toEqual({ className: "account.identifier", steps: "literal" })
    expect(
      readStepSources(
        { ...input, jumpWhen: "failure" },
        { className: "external", steps: "internal", jumpWhen: "external" },
        { className: "account.identifier", steps: "literal", jumpWhen: "literal" },
        account,
        "JumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        { jumpWhen: "failure", steps: "1" },
        { jumpWhen: "external", steps: "internal" },
        { jumpWhen: "literal", steps: "literal" },
        account,
        "CheckLive",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        { tagOnSuccess: "已登录", text: "Home" },
        { tagOnSuccess: "external", text: "external" },
        { tagOnSuccess: "literal", text: "account.identifier" },
        account,
        "JumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        { tagOnFailure: "未登录", text: "Home" },
        { tagOnFailure: "internal", text: "internal" },
        { tagOnFailure: "literal", text: "literal" },
        account,
        "JumpNodes",
      ),
    ).toEqual({ tagOnFailure: "literal", text: "literal" })
    expect(
      readStepSources(
        { text: "Home", writeOnSuccessField: "follower" },
        { text: "internal", writeOnSuccessField: "external" },
        { text: "literal", writeOnSuccessField: "literal" },
        account,
        "JumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        { text: "Home", writeOnSuccessValue: "1200" },
        { text: "internal", writeOnSuccessValue: "internal" },
        { text: "literal", writeOnSuccessValue: "literal" },
        account,
        "JumpNodes",
      ),
    ).toEqual({ text: "literal", writeOnSuccessValue: "literal" })
  })

  it("accepts only the external chance source for a click jump", () => {
    const input = { clickChance: "", text: "Home" }
    expect(
      readStepSources(
        input,
        { clickChance: "external", text: "internal" },
        { clickChance: "chance.external", text: "literal" },
        null,
        "ClickJumpNodes",
      ),
    ).toEqual({ clickChance: "chance.external", text: "literal" })
    expect(
      readStepSources(
        { clickChance: "100", text: "Home" },
        { clickChance: "internal", text: "internal" },
        { clickChance: "literal", text: "literal" },
        null,
        "ClickJumpNodes",
      ),
    ).toEqual({ clickChance: "literal", text: "literal" })
    expect(
      readStepSources(
        input,
        { clickChance: "external", text: "internal" },
        { clickChance: "account.identifier", text: "literal" },
        account,
        "ClickJumpNodes",
      ),
    ).toBeNull()
    expect(
      readStepSources(
        input,
        { clickChance: "external", text: "internal" },
        { clickChance: "", text: "literal" },
        null,
        "ClickJumpNodes",
      ),
    ).toBeNull()
  })
})
