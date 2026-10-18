import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import * as accountData from "../accounts/myt-account"
import { createTestAccounts } from "../accounts/myt-account.test-fixtures"
import * as deviceData from "../devices/myt-device"
import * as materialData from "../resources/myt-material"
import * as videoData from "../video-pool/catalog"

import { OverviewPage } from "./page"
import { overviewCounts } from "./stats"

beforeEach(() => {
  vi.spyOn(accountData, "createSeedAccounts").mockImplementation(createTestAccounts)
  vi.spyOn(deviceData, "createSeedDevices").mockImplementation(() =>
    Array.from(
      { length: 8 },
      (_, index): deviceData.MytDevice => ({
        id: index + 1,
        enable: true,
        expiredTime: "",
        extra: {},
        ip: "192.0.2.1",
        lastTime: "",
        liveIp: "",
        liveStatus: { info: {}, ip: "", pubIp: "", version: "" },
        model: 1,
        name: `Device ${index + 1}`,
        overseas: false,
        remotePort: null,
        remoteScreenPort: null,
        remoteUrl: "",
        serial: `device-${index + 1}`,
        tag: "",
        updateTime: "",
        userId: "1",
        version: "",
      }),
    ),
  )
  vi.spyOn(videoData, "createSeedVideos").mockImplementation(() =>
    Array.from(
      { length: 3 },
      (_, index): videoData.VideoWork => ({
        id: index + 1,
        caption: `Video ${index + 1}`,
        comments: 0,
        cover: "",
        group: "",
        likes: 0,
        publishedAt: "",
        uid: "",
        updatedAt: "",
        views: 0,
        workId: `video-${index + 1}`,
      }),
    ),
  )
  vi.spyOn(materialData, "createSeedMaterials").mockImplementation(() =>
    materialData.importMaterials("Text 1\nText 2\nText 3\nText 4\nText 5", "", 1, ""),
  )
})
afterEach(() => vi.restoreAllMocks())

describe("overview counts", () => {
  it("sums devices, all accounts, and video/image/text resources", () => {
    const counts = overviewCounts()
    expect(counts.devices).toBe(8)
    expect(counts.accounts).toBe(8)
    expect(counts.resources).toBe(8)
  })

  it("renders the three count cards", () => {
    render(
      <MemoryRouter>
        <OverviewPage />
      </MemoryRouter>,
    )
    expect(screen.getByText("设备数量")).toBeVisible()
    expect(screen.getByText("账号数量")).toBeVisible()
    expect(screen.getByText("资源数量")).toBeVisible()
    expect(screen.queryByText("等待数据")).not.toBeInTheDocument()
    expect(screen.queryByText("设备状态")).not.toBeInTheDocument()
    expect(screen.queryByText("进行中任务")).not.toBeInTheDocument()
  })
})
