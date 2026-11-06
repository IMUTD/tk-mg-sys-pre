import { describe, expect, it } from "bun:test"

import {
  buildSegments,
  countFinished,
  dispatchTimes,
  failedCount,
  lastProxyHost,
  progressTone,
  rollupTone,
  publicParameters,
  requesterLabel,
  stepProgress,
} from "./dispatch-progress"

const at = (iso: string): Date => new Date(iso)

describe("dispatch progress", () => {
  it("keeps an unstarted dispatch empty", () => {
    expect(countFinished(["", ""])).toBe(0)
    expect(dispatchTimes(2, 0, [])).toEqual({ finishedAt: null, startedAt: null })
    expect(progressTone(0, 2, 0)).toBe("normal")
    expect(lastProxyHost("socks5://user:secret@10.6.157.1:1080", [])).toBe("10.6.157.1:1080")
    expect(lastProxyHost("", [])).toBe("")
  })

  it("starts the clock before every item is finished", () => {
    const times = dispatchTimes(4, 2, [
      { createdAt: at("2026-10-30T08:05:00.000Z"), finishedAt: at("2026-10-30T08:10:00.000Z") },
      { createdAt: at("2026-10-30T08:06:00.000Z"), finishedAt: null },
    ])
    expect(times.startedAt).toBe("2026-10-30T08:05:00.000Z")
    expect(times.finishedAt).toBeNull()
    expect(progressTone(2, 4, 0)).toBe("normal")
  })

  it("uses the latest finish when every item succeeded", () => {
    const times = dispatchTimes(2, 2, [
      { createdAt: at("2026-10-30T08:05:00.000Z"), finishedAt: at("2026-10-30T08:20:00.000Z") },
      { createdAt: at("2026-10-30T08:04:00.000Z"), finishedAt: at("2026-10-30T08:11:00.000Z") },
    ])
    expect(times).toEqual({
      finishedAt: "2026-10-30T08:20:00.000Z",
      startedAt: "2026-10-30T08:04:00.000Z",
    })
    expect(progressTone(2, 2, failedCount(["succeeded", "succeeded"]))).toBe("success")
  })

  it("counts a failed item and still closes the clock", () => {
    expect(countFinished(["succeeded", "failed", "cancelled", "running"])).toBe(3)
    const times = dispatchTimes(2, 2, [
      { createdAt: at("2026-10-30T08:01:00.000Z"), finishedAt: at("2026-10-30T08:02:00.000Z") },
      { createdAt: at("2026-10-30T08:03:00.000Z"), finishedAt: at("2026-10-30T08:09:00.000Z") },
    ])
    expect(times.finishedAt).toBe("2026-10-30T08:09:00.000Z")
    expect(progressTone(2, 2, failedCount(["succeeded", "failed"]))).toBe("partial")
    expect(progressTone(2, 2, failedCount(["failed", "failed"]))).toBe("exception")
    expect(countFinished(["succeeded", "partial"])).toBe(2)
    expect(rollupTone(["succeeded", "partial"], 2)).toBe("partial")
    expect(rollupTone(["failed", "failed"], 2)).toBe("exception")
    expect(rollupTone(["succeeded", "succeeded"], 2)).toBe("success")
  })

  it("keeps the host from the latest proxy assignment", () => {
    expect(
      lastProxyHost("socks5://old:old@1.1.1.1:1080", [
        {
          parameters: { ip: "10.6.157.1", port: "24010" },
          sources: { ip: "proxy.host", port: "proxy.port" },
        },
      ]),
    ).toBe("10.6.157.1")
    expect(
      lastProxyHost("1.1.1.1:1080", [
        {
          parameters: { link: "vless://id@10.9.9.9:443?x=1" },
          sources: { link: "proxy.link" },
        },
      ]),
    ).toBe("10.9.9.9:443")
    expect(
      lastProxyHost("https://user:pass@8.8.8.8:443/path", [
        { parameters: { ip: "" }, sources: { ip: "proxy.host" } },
      ]),
    ).toBe("8.8.8.8:443")
  })

  it("counts finished steps on the latest attempt of each segment", () => {
    const progress = stepProgress(
      [
        { repeat: 0, sequence: 0, stage: 0 },
        { repeat: 0, sequence: 1, stage: 0 },
        { repeat: 0, sequence: 0, stage: 1 },
      ],
      new Map([
        [
          "0:0",
          [
            { sequence: 0, status: "succeeded" },
            { sequence: 1, status: "failed" },
          ],
        ],
        ["1:0", [{ sequence: 0, status: "running" }]],
      ]),
    )
    expect(progress).toEqual({ failed: 1, finished: 2 })
    expect(progressTone(progress.finished, 3, progress.failed)).toBe("partial")
  })

  it("names the requester from the display name, then the mailbox name", () => {
    expect(requesterLabel("张三", "zhang@example.com")).toBe("张三")
    expect(requesterLabel("  ", "zhang@example.com")).toBe("zhang")
    expect(requesterLabel("", "")).toBe("")
  })

  it("hides proxy secrets and builds the same segment note as task records", () => {
    const hidden = publicParameters(
      {
        interval: "3000",
        link: "vless://id@10.1.1.1:443",
        password: "secret",
        timeout: "120",
      },
      { link: "proxy.link", password: "proxy.password" },
    )
    expect(hidden).toEqual({ interval: "3000", timeout: "120" })
    expect(JSON.stringify(hidden).includes("vless://")).toBe(false)
    expect(JSON.stringify(hidden).includes("secret")).toBe(false)

    const segments = buildSegments({
      executed: [
        {
          errorCode: "exec",
          parameters: { password: "secret", timeout: "120" },
          sequence: 0,
          status: "failed",
          taskId: "task-b",
        },
      ],
      plan: [
        {
          fillStatus: "complete",
          parameters: { password: "plan", timeout: "120" },
          repeatCount: 2,
          repeatIndex: 0,
          sequence: 0,
          skill: "WaitReady",
          sources: { password: "proxy.password" },
          stageName: "养号",
          stagePosition: 0,
        },
        {
          fillStatus: "incomplete",
          parameters: { text: "hello" },
          repeatCount: 1,
          repeatIndex: 0,
          sequence: 1,
          skill: "ClickNode",
          sources: {},
          stageName: "",
          stagePosition: 1,
        },
      ],
      replays: [
        {
          createdAt: at("2026-10-30T08:00:00.000Z"),
          id: "replay-1",
          origin: "auto",
          repeatIndex: 0,
          stagePosition: 0,
        },
      ],
      tasks: [
        {
          autoLimit: 3,
          createdAt: at("2026-10-30T07:00:00.000Z"),
          id: "task-a",
          repeatIndex: 0,
          stagePosition: 0,
        },
        {
          autoLimit: 3,
          createdAt: at("2026-10-30T08:00:00.000Z"),
          id: "task-b",
          repeatIndex: 0,
          stagePosition: 0,
        },
      ],
    })
    expect(segments).toEqual([
      {
        note: "已自动重跑 1/3 次",
        repeatCount: 2,
        repeatIndex: 0,
        stagePosition: 0,
        steps: [
          {
            errorCode: "exec",
            parameters: { timeout: "120" },
            sequence: 0,
            skill: "WaitReady",
            status: "failed",
          },
        ],
        title: "养号 第 1/2 次",
      },
      {
        note: "",
        repeatCount: 1,
        repeatIndex: 0,
        stagePosition: 1,
        steps: [
          {
            errorCode: "",
            parameters: { text: "hello" },
            sequence: 1,
            skill: "ClickNode",
            status: "incomplete",
          },
        ],
        title: "第 2 段",
      },
    ])
  })

  it("marks a manual replay when no automatic replay was recorded", () => {
    const segments = buildSegments({
      executed: [],
      plan: [
        {
          fillStatus: "complete",
          parameters: {},
          repeatCount: 1,
          repeatIndex: 0,
          sequence: 0,
          skill: "WaitReady",
          sources: {},
          stageName: "养号",
          stagePosition: 0,
        },
      ],
      replays: [
        {
          createdAt: at("2026-10-30T08:00:00.000Z"),
          id: "replay-1",
          origin: "manual",
          repeatIndex: 0,
          stagePosition: 0,
        },
      ],
      tasks: [],
    })
    expect(segments[0]?.note).toBe("已手动重跑")
  })
})
