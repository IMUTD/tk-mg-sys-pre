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
    ).toBeNull()
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
    ).toEqual({
      text: "pool.text",
    })
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
  })
})
