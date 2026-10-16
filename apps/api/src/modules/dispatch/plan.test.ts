import { describe, expect, it } from "bun:test"

import type { SecretCipher } from "../../lib/crypto"
import { planDispatch, type DispatchSelection, type FileChoice } from "./repository"

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
  pitIndexes: [1],
  poolId: "",
  proxies: { by: "group", name: "一组代理" },
  proxyIds: ["proxy-1"],
  proxyTag: null,
  texts: [],
})

describe("planDispatch file draw", () => {
  it("fills one account on 140 with a video and backup drawn from 48", () => {
    const planned = planDispatch(
      cipher,
      selection([
        { deviceId: "box-48", directory: "bf", mode: "sequence", sequence: 1, source: "pool.video" },
        { deviceId: "box-48", directory: "分组", mode: "sequence", sequence: 2, source: "pool.backup" },
      ]),
      [
        {
          backupDeviceId: null,
          backupKey: "",
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
      [{ deviceId: "box-140", id: "pit-1", index: 1 }],
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
        { deviceId: "box-48", host: "192.168.76.48", parent: "bf", path: "video/bf/1.mp4", pool: "video" },
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
    expect(item?.status).toBe("ready")
    expect(item?.deviceHost).toBe("192.168.76.140")
    expect(item?.instanceIndex).toBe(1)
    expect(item?.proxyName).toBe("代理甲")
    expect(item?.filled[0]?.parameters.text).toBe("user-a")
    expect(item?.filled[1]?.parameters).toEqual({ 路径: "video/bf/1.mp4", 源主机: "192.168.76.48" })
    expect(item?.filled[2]?.parameters).toEqual({
      路径: "backup/分组/phone.tar.gz",
      源主机: "192.168.76.48",
    })
  })
})
