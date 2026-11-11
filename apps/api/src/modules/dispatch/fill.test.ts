import { describe, expect, it } from "bun:test"

import { takeBalanced } from "./allocate"
import {
  agentStepParameters,
  chanceAssignments,
  drawMediaIds,
  drawShareFiles,
  drawTexts,
  type FillAccount,
  type FillContext,
  fillStep,
  refreshDeviceHosts,
  relaxMailPair,
  resolveProxyLink,
  textAssignments,
} from "./fill"

const account: FillAccount = {
  backupName: "",
  clientId: "",
  email: "",
  identifier: "user-a",
  language: "zh",
  region: "CN",
  secret: "secret-a",
  token: "",
}

const context = (patch: Partial<FillContext> = {}): FillContext => ({
  account,
  device: { host: "192.168.76.140" },
  instance: { index: "2", name: "hmg16302" },
  manualText: false,
  proxy: {
    host: "10.0.0.8",
    link: "vless://node",
    password: "proxy-pass",
    port: "1080",
    safe: "true",
    tun: "false",
    username: "proxy-user",
  },
  chance: "",
  backup: "",
  backupFileHost: "",
  image: "",
  imageHost: "",
  imageId: "",
  language: "",
  region: "",
  text: null,
  video: "",
  videoHost: "",
  videoId: "",
  ...patch,
})

describe("dispatch fill", () => {
  it("writes an external click chance and leaves an internal chance alone", () => {
    const external = fillStep(
      {
        input: { clickChance: "", text: "Like" },
        scopes: { clickChance: "external", text: "internal" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "chance.external", text: "literal" },
      },
      context({ chance: "37" }),
    )
    expect(external.parameters).toEqual({ clickChance: "37", text: "Like" })
    expect(external.missingKeys).toEqual([])
    const missing = fillStep(
      {
        input: { clickChance: "" },
        scopes: { clickChance: "external" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "chance.external" },
      },
      context(),
    )
    expect(missing.missingKeys).toEqual(["clickChance"])
    const internal = fillStep(
      {
        input: { clickChance: "100" },
        scopes: { clickChance: "internal" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "literal" },
      },
      context({ chance: "8" }),
    )
    expect(internal.parameters.clickChance).toBe("100")
  })

  it("requires one chance for each external click jump and rejects extras", () => {
    const steps = [
      {
        scopes: { clickChance: "external" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "chance.external" },
        stagePosition: 0,
      },
      {
        scopes: { clickChance: "internal" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "literal" },
        stagePosition: 0,
      },
    ]
    expect(chanceAssignments(steps, [{ sequence: 0, stage: 0, value: 20 }])).toBe("ok")
    expect(chanceAssignments(steps, [])).toBe("chance_required")
    expect(chanceAssignments(steps, [{ sequence: 1, stage: 0, value: 20 }])).toBe(
      "chance_not_allowed",
    )
  })

  it("keeps literal params and fills constrained sources", () => {
    const filled = fillStep(
      {
        input: { ip: "", port: "", type: "2" },
        scopes: { ip: "external", port: "external", type: "internal" },
        skill: "SetProxy",
        sources: { ip: "proxy.host", port: "proxy.port", type: "literal" },
      },
      context(),
    )
    expect(filled.missingKeys).toEqual([])
    expect(filled.parameters).toEqual({ ip: "10.0.0.8", port: "1080", type: "2" })
  })

  it("writes the drawn copy only when the source is the text pool", () => {
    const drawn = context({
      manualText: true,
      text: { content: "抽到的文案", resourceId: "text-1" },
    })
    const pooled = fillStep(
      {
        input: { text: "" },
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "pool.text" },
      },
      drawn,
    )
    expect(pooled.parameters["text"]).toBe("抽到的文案")
    expect(pooled.textResourceId).toBe("text-1")
    const named = fillStep(
      {
        input: { text: "" },
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "account.identifier" },
      },
      drawn,
    )
    expect(named.parameters["text"]).toBe("user-a")
    expect(named.textResourceId).toBeNull()
    const clicked = fillStep(
      {
        input: { text: "" },
        scopes: { text: "external" },
        skill: "ClickNode",
        sources: { text: "pool.text" },
      },
      drawn,
    )
    expect(clicked.parameters["text"]).toBe("抽到的文案")
    expect(clicked.textResourceId).toBe("text-1")
    const jumped = fillStep(
      {
        input: { clickChance: "100", text: "" },
        scopes: { clickChance: "internal", text: "external" },
        skill: "ClickJumpNodes",
        sources: { clickChance: "literal", text: "pool.text" },
      },
      drawn,
    )
    expect(jumped.parameters).toEqual({ clickChance: "100", text: "抽到的文案" })
  })

  it("requires one text pool for each external text step and rejects extras", () => {
    const steps = [
      {
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "pool.text" },
        stagePosition: 0,
      },
      {
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "account.identifier" },
        stagePosition: 0,
      },
    ]
    expect(textAssignments(steps, [{ ids: ["text-1"], sequence: 0, stage: 0 }])).toBe("ok")
    expect(textAssignments(steps, [])).toBe("text_required")
    expect(textAssignments(steps, [{ ids: ["text-1"], sequence: 1, stage: 0 }])).toBe(
      "text_not_allowed",
    )
    expect(textAssignments(steps, [{ ids: [], sequence: 0, stage: 0 }])).toBe("text_required")
    expect(
      textAssignments(
        [
          {
            scopes: { text: "external" },
            skill: "ClickJumpNodes",
            sources: { text: "pool.text" },
            stagePosition: 1,
          },
        ],
        [{ ids: ["text-2"], sequence: 0, stage: 1 }],
      ),
    ).toBe("ok")
  })

  it("uses the accelerator V2 link when the landing proxy has none", () => {
    expect(resolveProxyLink("", "vless://relay")).toBe("vless://relay")
    expect(resolveProxyLink("vless://own", "vless://relay")).toBe("vless://own")
  })

  it("replaces a stored box address with the current host for that device", () => {
    const refreshed = refreshDeviceHosts(
      { box: "10.0.0.1", note: "keep", backup: "10.0.0.2" },
      { box: "device.host", backup: "account.backup_device", note: "literal" },
      { deviceHost: "192.168.76.48", backupHost: "192.168.76.140" },
    )
    expect(refreshed.changed).toBe(true)
    expect(refreshed.parameters).toEqual({
      box: "192.168.76.48",
      note: "keep",
      backup: "10.0.0.2",
    })
  })

  it("leaves the stored address when the device can no longer be read", () => {
    const refreshed = refreshDeviceHosts(
      { box: "10.0.0.1" },
      { box: "device.host" },
      { deviceHost: "", backupHost: "" },
    )
    expect(refreshed.changed).toBe(false)
    expect(refreshed.parameters["box"]).toBe("10.0.0.1")
  })

  it("leaves a removed file source empty", () => {
    const filled = fillStep(
      {
        input: { 路径: "", 源主机: "" },
        scopes: { 路径: "external", 源主机: "external" },
        skill: "StageShare",
        sources: { 路径: "pool.video", 源主机: "pool.video_host" },
      },
      context({ video: "video/bf/1.mp4", videoHost: "192.168.76.48" }),
    )
    expect(filled.missingKeys).toEqual(["路径", "源主机"])
    expect(filled.parameters).toEqual({ 路径: "", 源主机: "" })
  })

  it("draws one file per account from a directory and then cycles", () => {
    const files = [
      {
        deviceId: "box-48",
        host: "192.168.76.48",
        parent: "bf",
        path: "video/bf/b.mp4",
        pool: "video" as const,
      },
      {
        deviceId: "box-48",
        host: "192.168.76.48",
        parent: "bf",
        path: "video/bf/a.mp4",
        pool: "video" as const,
      },
      {
        deviceId: "box-48",
        host: "192.168.76.48",
        parent: "",
        path: "video/root.mp4",
        pool: "video" as const,
      },
      {
        deviceId: "box-48",
        host: "192.168.76.48",
        parent: "分组",
        path: "backup/分组/phone.tar.gz",
        pool: "backup" as const,
      },
    ]
    expect(drawShareFiles(files, "box-48", "bf", "video", "sequence", 3)).toEqual([
      { host: "192.168.76.48", path: "video/bf/a.mp4" },
      { host: "192.168.76.48", path: "video/bf/b.mp4" },
      { host: "192.168.76.48", path: "video/bf/a.mp4" },
    ])
    expect(drawShareFiles(files, "box-48", "分组", "backup", "sequence", 1)).toEqual([
      { host: "192.168.76.48", path: "backup/分组/phone.tar.gz" },
    ])
  })

  it("leaves a removed pit name source empty", () => {
    const filled = fillStep(
      {
        input: { name: "" },
        scopes: { name: "external" },
        skill: "BoxStop",
        sources: { name: "instance.name" },
      },
      context(),
    )
    expect(filled.missingKeys).toEqual(["name"])
    expect(filled.parameters).toEqual({ name: "" })
  })

  it("keeps an internal container name and does not require one", () => {
    const empty = fillStep(
      {
        input: { name: "" },
        scopes: { name: "internal" },
        skill: "BoxStop",
        sources: { name: "literal" },
      },
      context({ instance: { index: "2", name: "" } }),
    )
    expect(empty.missingKeys).toEqual([])
    expect(empty.parameters).toEqual({ name: "" })
    const written = fillStep(
      {
        input: { name: "kept" },
        scopes: { name: "internal" },
        skill: "BoxDelete",
        sources: { name: "literal" },
      },
      context(),
    )
    expect(written.missingKeys).toEqual([])
    expect(written.parameters).toEqual({ name: "kept" })
  })

  it("fills a drawn image id into the selected parameter", () => {
    const filled = fillStep(
      {
        input: { 图片ID: "" },
        scopes: { 图片ID: "external" },
        skill: "UploadPitImage",
        sources: { 图片ID: "media.image_id" },
      },
      context({ imageId: "11111111-1111-4111-8111-111111111111" }),
    )
    expect(filled.missingKeys).toEqual([])
    expect(filled.parameters["图片ID"]).toBe("11111111-1111-4111-8111-111111111111")
  })

  it("marks an empty constrained value as missing", () => {
    const filled = fillStep(
      {
        input: { vless: "" },
        scopes: { vless: "external" },
        skill: "IndependentV5S5",
        sources: { vless: "proxy.link" },
      },
      context({ proxy: null }),
    )
    expect(filled.missingKeys).toEqual(["vless"])
    expect(filled.parameters["vless"]).toBe("")
  })

  it("writes the task region over a fingerprint literal and leaves language", () => {
    const filled = fillStep(
      {
        input: { country: "CN", language: "zh" },
        scopes: { country: "internal", language: "internal" },
        skill: "UpdateFingerprint",
        sources: { country: "literal", language: "literal" },
      },
      context({ region: "US" }),
    )
    expect(filled.parameters).toEqual({ country: "US", language: "zh" })
    expect(filled.missingKeys).toEqual([])
  })

  it("writes the task region over an account region source", () => {
    const filled = fillStep(
      {
        input: { country: "", language: "en" },
        scopes: { country: "external", language: "internal" },
        skill: "SetLanguageCountry",
        sources: { country: "account.region", language: "literal" },
      },
      context({ region: "BR" }),
    )
    expect(filled.parameters["country"]).toBe("BR")
    expect(filled.parameters["language"]).toBe("en")
  })

  it("keeps the chain country code when the task has no region", () => {
    const filled = fillStep(
      {
        input: { countryCode: "JP", name: "" },
        scopes: { countryCode: "internal", name: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "literal", name: "literal" },
      },
      context(),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
  })

  it("writes the task language over a locale literal and leaves the country", () => {
    const filled = fillStep(
      {
        input: { country: "CN", language: "zh" },
        scopes: { country: "internal", language: "internal" },
        skill: "SetLanguageCountry",
        sources: { country: "literal", language: "literal" },
      },
      context({ language: "en" }),
    )
    expect(filled.parameters).toEqual({ country: "CN", language: "en" })
    expect(filled.missingKeys).toEqual([])
  })

  it("writes the task language over an account language and keeps the region", () => {
    const filled = fillStep(
      {
        input: { country: "", language: "" },
        scopes: { country: "external", language: "external" },
        skill: "UpdateFingerprint",
        sources: { country: "account.region", language: "account.language" },
      },
      context({ language: "es", region: "US" }),
    )
    expect(filled.parameters).toEqual({ country: "US", language: "es" })
  })

  it("leaves an ip location language on the chain value", () => {
    const filled = fillStep(
      {
        input: { ip: "", language: "en" },
        scopes: { ip: "internal", language: "internal" },
        skill: "SetIPLocation",
        sources: { ip: "literal", language: "literal" },
      },
      context({ language: "ja" }),
    )
    expect(filled.parameters["language"]).toBe("en")
  })

  it("does not write a language onto a create step", () => {
    const filled = fillStep(
      {
        input: { countryCode: "JP", name: "" },
        scopes: { countryCode: "internal", name: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "literal", name: "literal" },
      },
      context({ language: "en" }),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
    expect(filled.parameters["language"]).toBeUndefined()
  })

  it("fills empty create coordinates from the task region", () => {
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "", longitude: "", name: "" },
        scopes: {
          countryCode: "internal",
          latitude: "internal",
          longitude: "internal",
          name: "internal",
        },
        skill: "CreateAndroid",
        sources: {
          countryCode: "literal",
          latitude: "literal",
          longitude: "literal",
          name: "literal",
        },
      },
      context({ region: "US" }),
    )
    expect(filled.parameters["countryCode"]).toBe("US")
    expect(filled.parameters["latitude"]).toBe("40.7128")
    expect(filled.parameters["longitude"]).toBe("-74.0060")
    expect(filled.missingKeys).toEqual([])
  })

  it("leaves create coordinates empty when the task has no region", () => {
    const filled = fillStep(
      {
        input: { countryCode: "JP", latitude: "", longitude: "" },
        scopes: { countryCode: "internal", latitude: "internal", longitude: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "literal", latitude: "literal", longitude: "literal" },
      },
      context(),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
    expect(filled.parameters["latitude"]).toBe("")
    expect(filled.parameters["longitude"]).toBe("")
  })

  it("keeps handwritten coordinates when a region is selected", () => {
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "39.9000", longitude: "116.4000" },
        scopes: { countryCode: "internal", latitude: "internal", longitude: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "literal", latitude: "literal", longitude: "literal" },
      },
      context({ region: "JP" }),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
    expect(filled.parameters["latitude"]).toBe("39.9000")
    expect(filled.parameters["longitude"]).toBe("116.4000")
  })

  it("does not complete a single handwritten coordinate", () => {
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "39.9000", longitude: "" },
        scopes: { countryCode: "internal", latitude: "internal", longitude: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "literal", latitude: "literal", longitude: "literal" },
      },
      context({ region: "US" }),
    )
    expect(filled.parameters["latitude"]).toBe("39.9000")
    expect(filled.parameters["longitude"]).toBe("")
  })

  it("fills empty reset coordinates from the same region table", () => {
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "  ", longitude: "" },
        scopes: { countryCode: "internal", latitude: "internal", longitude: "internal" },
        skill: "ResetAndroidContainer",
        sources: { countryCode: "literal", latitude: "literal", longitude: "literal" },
      },
      context({ region: "JP" }),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
    expect(filled.parameters["latitude"]).toBe("35.6762")
    expect(filled.parameters["longitude"]).toBe("139.6503")
  })

  it("does not add coordinates to a model switch or send text", () => {
    const model = fillStep(
      {
        input: { countryCode: "" },
        scopes: { countryCode: "internal" },
        skill: "SwitchAndroidPhoneModel",
        sources: { countryCode: "literal" },
      },
      context({ region: "US" }),
    )
    expect(model.parameters).toEqual({ countryCode: "US" })
    const text = fillStep(
      {
        input: { text: "原文" },
        scopes: { text: "internal" },
        skill: "SendText",
        sources: { text: "literal" },
      },
      context({ region: "JP" }),
    )
    expect(text.parameters).toEqual({ text: "原文" })
  })

  it("keeps a resolved external latitude and fills only when both external coordinates are empty", () => {
    const kept = fillStep(
      {
        input: { countryCode: "", latitude: "", longitude: "" },
        scopes: { countryCode: "internal", latitude: "external", longitude: "external" },
        skill: "CreateAndroid",
        sources: {
          countryCode: "literal",
          latitude: "account.region",
          longitude: "account.language",
        },
      },
      context({ account: { ...account, language: "", region: "39.9000" }, region: "JP" }),
    )
    expect(kept.parameters["countryCode"]).toBe("JP")
    expect(kept.parameters["latitude"]).toBe("39.9000")
    expect(kept.parameters["longitude"]).toBe("")
    expect(kept.missingKeys).toEqual(["longitude"])
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "", longitude: "" },
        scopes: { countryCode: "external", latitude: "external", longitude: "external" },
        skill: "CreateAndroid",
        sources: {
          countryCode: "account.region",
          latitude: "account.backup_name",
          longitude: "account.language",
        },
      },
      context({ account: { ...account, backupName: "", language: "", region: "随便写" }, region: "JP" }),
    )
    expect(filled.parameters["countryCode"]).toBe("JP")
    expect(filled.parameters["latitude"]).toBe("35.6762")
    expect(filled.parameters["longitude"]).toBe("139.6503")
    expect(filled.missingKeys).toEqual([])
  })

  it("does not turn an account region into coordinates", () => {
    const filled = fillStep(
      {
        input: { countryCode: "", latitude: "", longitude: "" },
        scopes: { countryCode: "external", latitude: "internal", longitude: "internal" },
        skill: "CreateAndroid",
        sources: { countryCode: "account.region", latitude: "literal", longitude: "literal" },
      },
      context({ account: { ...account, region: "东京" } }),
    )
    expect(filled.parameters["countryCode"]).toBe("东京")
    expect(filled.parameters["latitude"]).toBe("")
    expect(filled.parameters["longitude"]).toBe("")
  })

  it("does not apply a task region to send text", () => {
    const filled = fillStep(
      {
        input: { text: "原文" },
        scopes: { text: "internal" },
        skill: "SendText",
        sources: { text: "literal" },
      },
      context({ region: "US" }),
    )
    expect(filled.parameters["text"]).toBe("原文")
  })

  it("draws text in order and then cycles", () => {
    const materials = [
      { category: "评论", content: "第一条", createdAt: "2026-01-02", id: "b" },
      { category: "评论", content: "更早", createdAt: "2026-01-01", id: "a" },
      { category: "其他", content: "别的", createdAt: "2026-01-03", id: "c" },
    ]
    expect(drawTexts(materials, "sequence", undefined, 3).map((item) => item.content)).toEqual([
      "更早",
      "第一条",
      "别的",
    ])
    expect(drawTexts(materials, "tag", "评论", 3).map((item) => item.content)).toEqual([
      "更早",
      "第一条",
      "更早",
    ])
  })

  it("spreads picks across the least used candidates", () => {
    const counts = new Map<string, number>()
    const candidates = [{ id: "box-b" }, { id: "box-a" }]
    const picked = [1, 2, 3].map(() => takeBalanced(candidates, counts)?.id)
    expect(picked).toEqual(["box-a", "box-b", "box-a"])
  })

  it("fills mail credentials with the same internal and external rules as other fields", () => {
    const input = {
      clientId: "",
      email: "",
      folder: "INBOX,Junk",
      interval: "5",
      lookback: "30",
      refreshToken: "",
      timeout: "120",
    }
    const scopes = {
      clientId: "external",
      email: "external",
      folder: "internal",
      interval: "internal",
      lookback: "internal",
      refreshToken: "external",
      timeout: "internal",
    }
    const sources = {
      clientId: "account.ms_client_id",
      email: "account.email",
      refreshToken: "account.ms_token",
    }
    const fetched = fillStep({ input, scopes, skill: "FetchMailCode", sources }, context())
    expect(fetched.missingKeys).toEqual(["clientId", "refreshToken"])
    expect(fetched.parameters["email"]).toBe("user-a")
    const resolved = fillStep(
      { input, scopes, skill: "FetchMailCode", sources },
      context({
        account: { ...account, clientId: "client-1", email: "a@b.c", token: "token-1" },
      }),
    )
    expect(resolved.missingKeys).toEqual([])
    expect(resolved.parameters["email"]).toBe("a@b.c")
    expect(resolved.parameters["clientId"]).toBe("client-1")
    expect(resolved.parameters["refreshToken"]).toBe("token-1")
    const internal = fillStep(
      {
        input: {
          ...input,
          clientId: "typed-client",
          email: "typed@b.c",
          refreshToken: "typed-token",
        },
        scopes: {
          ...scopes,
          clientId: "internal",
          email: "internal",
          refreshToken: "internal",
        },
        skill: "FetchMailCode",
        sources,
      },
      context(),
    )
    expect(internal.missingKeys).toEqual([])
    expect(internal.parameters["email"]).toBe("typed@b.c")
    const typed = fillStep(
      {
        input: { text: "" },
        scopes: { text: "external" },
        skill: "SendText",
        sources: { text: "pool.text" },
      },
      context({ manualText: true, text: null }),
    )
    expect(
      relaxMailPair([
        { missingKeys: fetched.missingKeys, skill: "FetchMailCode" },
        { missingKeys: typed.missingKeys, skill: "SendText" },
      ])[1]?.missingKeys,
    ).toEqual([])
    expect(agentStepParameters("FetchMailCode", resolved.parameters)).toEqual({
      folder: "INBOX,Junk",
      interval: "5",
      lookback: "30",
      timeout: "120",
    })
  })
})

describe("drawMediaIds", () => {
  it("orders by host and path and cycles", () => {
    const drawn = drawMediaIds(
      [
        { host: "192.168.76.164", id: "b", path: "a.png" },
        { host: "192.168.76.163", id: "a", path: "b.png" },
      ],
      "sequence",
      3,
      () => 0,
    )
    expect(drawn).toEqual(["a", "b", "a"])
  })
})
