import { describe, expect, it } from "bun:test"

import type { SecretCipher } from "../../lib/crypto"
import { type DispatchSelection, type FileChoice, planDispatch } from "./repository"
import type { ShareDrawFile } from "./fill"

const cipher: SecretCipher = {
  decrypt: () => "secret-a",
  encrypt: (value) => value,
}

const selection = (files: readonly FileChoice[]): DispatchSelection => ({
  accountIds: ["account-1"],
  accountNote: "",
  accounts: { by: "group", name: "一组账号" },
  boxIds: ["box-140"],
  boxes: { by: "group", name: "一组盒子" },
  files,
  instances: [],
  pitIndexes: [1],
  pitRange: [],
  poolId: "",
  proxies: { by: "group", name: "一组代理" },
  proxyIds: ["proxy-1"],
  proxyTag: null,
  language: "",
  region: "",
  repeats: [],
  texts: [],
})

describe("planDispatch file draw", () => {
  it("fills one account on 140 with a video and backup drawn from 48", () => {
    const planned = planDispatch(
      cipher,
      selection([
        {
          deviceId: "box-48",
          directory: "bf",
          mode: "sequence",
          sequence: 1,
          source: "pool.video",
        },
        {
          deviceId: "box-48",
          directory: "分组",
          mode: "sequence",
          sequence: 2,
          source: "pool.backup",
        },
      ]),
      [
        {
          backupDeviceId: null,
          backupKey: "",
          backupName: "",
          deviceId: "box-140",
          encryptedSecret: "",
          id: "account-1",
          identifier: "user-a",
          instanceIndex: 1,
          language: "",
          note: "",
          proxyId: "proxy-1",
          region: "",
        },
      ],
      [
        { host: "192.168.76.140", id: "box-140", name: "140" },
        { host: "192.168.76.48", id: "box-48", name: "48" },
      ],
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      [
        {
          configuration: { host: "10.0.0.8", port: 1080 },
          credentials: "",
          endpoint: "10.0.0.8:1080",
          id: "proxy-1",
          linkCredentials: null,
          name: "代理甲",
          tags: ["一组代理"],
        },
      ],
      [],
      new Map(),
      new Map(),
      [
        {
          deviceId: "box-48",
          host: "192.168.76.48",
          parent: "bf",
          path: "video/bf/1.mp4",
          pool: "video",
        },
        {
          deviceId: "box-48",
          host: "192.168.76.48",
          parent: "分组",
          path: "backup/分组/phone.tar.gz",
          pool: "backup",
        },
      ],
      [
        {
          afterMs: 0,
          guards: [],
          input: { text: "" },
          scopes: { text: "external" },
          skill: "SendText",
          sources: { text: "account.identifier" },
        },
        {
          afterMs: 0,
          guards: [],
          input: { 路径: "", 源主机: "" },
          scopes: { 路径: "external", 源主机: "external" },
          skill: "StageShare",
          sources: { 路径: "pool.video", 源主机: "pool.video_host" },
        },
        {
          afterMs: 0,
          guards: [],
          input: { 路径: "", 源主机: "" },
          scopes: { 路径: "external", 源主机: "external" },
          skill: "StageShare",
          sources: { 路径: "pool.backup", 源主机: "pool.backup_host" },
        },
      ],
    )
    expect(planned).toHaveLength(1)
    const item = planned[0]
    expect(item?.status).toBe("incomplete")
    expect(item?.deviceHost).toBe("192.168.76.140")
    expect(item?.instanceIndex).toBe(1)
    expect(item?.proxyName).toBe("代理甲")
    expect(item?.filled[0]?.parameters["text"]).toBe("user-a")
    expect(item?.filled[1]?.parameters).toEqual({ 路径: "", 源主机: "" })
    expect(item?.filled[2]?.parameters).toEqual({ 路径: "", 源主机: "" })
  })
})

const account = {
  backupDeviceId: null,
  backupKey: "",
  backupName: "",
  deviceId: "box-140",
  encryptedSecret: "",
  id: "account-1",
  identifier: "user-a",
  instanceIndex: 1,
  language: "",
  note: "",
  proxyId: "proxy-1",
  region: "",
}

const devices = [
  { host: "192.168.76.140", id: "box-140", name: "140" },
  { host: "192.168.76.48", id: "box-48", name: "48" },
]

const proxies = [
  {
    configuration: { host: "10.0.0.8", port: 1080 },
    credentials: "",
    endpoint: "10.0.0.8:1080",
    id: "proxy-1",
    linkCredentials: null,
    name: "代理甲",
    tags: ["一组代理"],
  },
]

const video = (path: string): ShareDrawFile => ({
  deviceId: "box-48",
  host: "192.168.76.48",
  parent: "bf",
  path,
  pool: "video",
})

const send = (stage: number, local: number) => ({
  afterMs: 0,
  guards: [],
  input: { text: "" },
  localSequence: local,
  scopes: { text: "external" },
  skill: "SendText",
  sources: { text: "pool.text" },
  stageName: stage === 0 ? "登录" : "养号",
  stagePosition: stage,
})

const share = (stage: number, local: number) => ({
  afterMs: 0,
  guards: [],
  input: { 路径: "", 源主机: "" },
  localSequence: local,
  scopes: { 路径: "external", 源主机: "external" },
  skill: "StageShare",
  sources: { 路径: "pool.video", 源主机: "pool.video_host" },
  stageName: "养号",
  stagePosition: stage,
})

describe("planDispatch stage fill", () => {
  it("keeps a stage 0 text off another stage and fills a stage 1 file only there", () => {
    const planned = planDispatch(
      cipher,
      {
        ...selection([]),
        files: [
          {
            deviceId: "box-48",
            directory: "bf",
            mode: "sequence",
            sequence: 0,
            source: "pool.video",
            stage: 1,
          },
        ],
        texts: [{ mode: "sequence", sequence: 1, stage: 0 }],
      },
      [account],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [{ category: "", content: "文案甲", createdAt: "2026-01-01", id: "text-1" }],
      new Map(),
      new Map(),
      [video("video/bf/a.mp4")],
      [send(0, 0), send(0, 1), share(1, 0), send(1, 1)],
    )
    const filled = planned[0]?.filled ?? []
    expect(planned[0]?.instanceIndex).toBe(1)
    expect(filled[0]?.parameters["text"]).toBe("")
    expect(filled[1]?.parameters["text"]).toBe("文案甲")
    expect(filled[2]?.parameters["路径"]).toBe("")
    expect(filled[3]?.parameters["text"]).toBe("")
    expect(filled[3]?.parameters["路径"]).toBeUndefined()
  })

  it("treats a file choice without a stage as stage 0", () => {
    const planned = planDispatch(
      cipher,
      selection([
        {
          deviceId: "box-48",
          directory: "bf",
          mode: "sequence",
          sequence: 0,
          source: "pool.video",
        },
      ]),
      [account],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [],
      new Map(),
      new Map(),
      [video("video/bf/a.mp4")],
      [share(0, 0), share(1, 0)],
    )
    expect(planned[0]?.filled[0]?.parameters["路径"]).toBe("")
    expect(planned[0]?.filled[1]?.parameters["路径"]).toBe("")
  })

  it("copies one video draw onto every repeat of the same step", () => {
    const step = share(1, 0)
    const planned = planDispatch(
      cipher,
      selection([
        {
          deviceId: "box-48",
          directory: "bf",
          mode: "sequence",
          sequence: 0,
          source: "pool.video",
          stage: 1,
        },
      ]),
      [account],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [],
      new Map(),
      new Map(),
      [video("video/bf/a.mp4"), video("video/bf/b.mp4"), video("video/bf/c.mp4")],
      [0, 1, 2].map((repeatIndex) => ({ ...step, repeatCount: 3, repeatIndex })),
    )
    const paths = (planned[0]?.filled ?? []).map((item) => item.parameters["路径"])
    expect(paths).toEqual(["", "", ""])
    expect(planned[0]?.instanceIndex).toBe(1)
    expect(planned[0]?.filled.map((item) => item.repeatIndex)).toEqual([0, 1, 2])
  })

  it("copies one text draw onto a fixed repeat for each account", () => {
    const second = { ...account, id: "account-2", identifier: "user-b" }
    const planned = planDispatch(
      cipher,
      {
        ...selection([]),
        texts: [{ mode: "sequence", sequence: 0, stage: 1 }],
      },
      [account, second],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [
        { category: "", content: "文案甲", createdAt: "2026-01-01", id: "text-1" },
        { category: "", content: "文案乙", createdAt: "2026-01-02", id: "text-2" },
      ],
      new Map(),
      new Map(),
      [],
      [send(1, 0)],
      [{ count: 3, mode: "fixed", stage: 1 }],
    )
    const texts = planned.map((item) => (item.filled ?? []).map((step) => step.parameters["text"]))
    expect(texts).toEqual([
      ["文案甲", "文案甲", "文案甲"],
      ["文案乙", "文案乙", "文案乙"],
    ])
  })

  it("draws a different repeat count for each account and still fills once", () => {
    const second = { ...account, id: "account-2", identifier: "user-b" }
    const draws = [0, 0.999]
    let cursor = 0
    const planned = planDispatch(
      cipher,
      {
        ...selection([]),
        texts: [{ mode: "sequence", sequence: 0, stage: 1 }],
      },
      [account, second],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [
        { category: "", content: "文案甲", createdAt: "2026-01-01", id: "text-1" },
        { category: "", content: "文案乙", createdAt: "2026-01-02", id: "text-2" },
      ],
      new Map(),
      new Map(),
      [],
      [send(1, 0)],
      [{ max: 5, min: 2, mode: "range", stage: 1 }],
      () => draws[cursor++] ?? 0,
    )
    const texts = planned.map((item) => (item.filled ?? []).map((step) => step.parameters["text"]))
    expect(texts[0]).toEqual(["文案甲", "文案甲"])
    expect(texts[1]).toEqual(["文案乙", "文案乙", "文案乙", "文案乙", "文案乙"])
    expect(cursor).toBe(2)
  })

  it("creates one task per checked cloud machine when no account is selected", () => {
    const planned = planDispatch(
      cipher,
      {
        ...selection([]),
        accountIds: [],
        accounts: null,
        boxIds: [],
        boxes: null,
        instances: [
          { deviceId: "box-140", index: 1 },
          { deviceId: "box-48", index: 3 },
        ],
        pitIndexes: [],
        pitRange: [1, 3],
        proxies: null,
        proxyIds: [],
      },
      [],
      [
        { host: "192.168.76.140", id: "box-140", name: "140" },
        { host: "192.168.76.48", id: "box-48", name: "48" },
      ],
      [
        { deviceId: "box-140", id: "pit-140-1", index: 1, label: "甲" },
        { deviceId: "box-48", id: "pit-48-3", index: 3, label: "乙" },
      ],
      [],
      [],
      new Map(),
      new Map(),
      [],
      [{ afterMs: 0, guards: [], input: {}, scopes: {}, skill: "OpenApp", sources: {} }],
    )
    expect(planned.map((item) => ({
      accountId: item.accountId,
      deviceId: item.deviceId,
      instanceIndex: item.instanceIndex,
    }))).toEqual([
      { accountId: null, deviceId: "box-140", instanceIndex: 1 },
      { accountId: null, deviceId: "box-48", instanceIndex: 3 },
    ])
  })

  it("writes the same task region onto every fingerprint step", () => {
    const planned = planDispatch(
      cipher,
      { ...selection([]), region: "US" },
      [account],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [],
      new Map(),
      new Map(),
      [],
      [
        {
          afterMs: 0,
          guards: [],
          input: { country: "CN", language: "zh" },
          localSequence: 0,
          scopes: { country: "internal", language: "internal" },
          skill: "UpdateFingerprint",
          sources: { country: "literal", language: "literal" },
          stageName: "登录",
          stagePosition: 0,
        },
      ],
    )
    expect(planned[0]?.filled[0]?.parameters).toEqual({ country: "US", language: "zh" })
  })

  it("writes the task language and region onto a locale step", () => {
    const planned = planDispatch(
      cipher,
      { ...selection([]), language: "in", region: "ID" },
      [account],
      devices,
      [{ deviceId: "box-140", id: "pit-1", index: 1, label: "" }],
      proxies,
      [],
      new Map(),
      new Map(),
      [],
      [
        {
          afterMs: 0,
          guards: [],
          input: { country: "US", language: "en" },
          localSequence: 0,
          scopes: { country: "internal", language: "internal" },
          skill: "SetLanguageCountry",
          sources: { country: "literal", language: "literal" },
          stageName: "登录",
          stagePosition: 0,
        },
      ],
    )
    expect(planned[0]?.filled[0]?.parameters).toEqual({ country: "ID", language: "in" })
  })
})
