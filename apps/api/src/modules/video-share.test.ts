import { describe, expect, it } from "bun:test"

import { agentSkillStep, sharedPullCommand, sharedVideoCommand, stageShareAction, transferShareReady } from "./video-share"

describe("shared video commands", () => {
  it("copies a Chinese folder without putting the characters in the command text", () => {
    const command = sharedVideoCommand("CopyVideoOnly", { 视频目录: "美女", 视频名: "1 (4).mp4" })
    expect(command).toBe(
      "cp \"/dev/hmg/video/$(printf '\\xe7\\xbe\\x8e\\xe5\\xa5\\xb3')/$(printf '\\x31\\x20\\x28\\x34\\x29\\x2e\\x6d\\x70\\x34')\" \"/sdcard/Movies/$(printf '\\x31\\x20\\x28\\x34\\x29\\x2e\\x6d\\x70\\x34')\" 2>&1; echo EXIT:$?",
    )
    expect(command).not.toContain("美女")
  })

  it("moves the file and removes the source", () => {
    const command = sharedVideoCommand("UploadVideoThenDelete", { 视频目录: "clip", 视频名: "a.mp4" })
    expect(command?.startsWith("mv ")).toBe(true)
    expect(command).toContain("/sdcard/Movies/")
  })

  it("rejects a folder that leaves the video directory", () => {
    expect(sharedVideoCommand("CopyVideoOnly", { 视频目录: "../share", 视频名: "a.mp4" })).toBeNull()
    expect(sharedVideoCommand("CopyVideoOnly", { 视频目录: "美女", 视频名: "" })).toBeNull()
  })

  it("pulls a catalog video path into the phone", () => {
    const command = sharedPullCommand("PullShareVideo", { 路径: "video/美女/1 (4).mp4" })
    expect(command).toContain("/dev/hmg/video/")
    expect(command).toContain("/sdcard/Movies/")
    expect(command).not.toContain("美女")
    expect(sharedPullCommand("PullShareVideo", { 路径: "backup/分组/a.mp4" })).toBeNull()
    expect(sharedPullCommand("PullShareImage", { 路径: "share/封面.png" })).toContain("/sdcard/Pictures/")
    const step = agentSkillStep("PullShareBackup", { 路径: "backup/分组/phone.tar.gz" })
    expect(step.skill).toBe("PullShareBackup")
    expect(step.input["路径"]).toBe("分组/phone.tar.gz")
    expect(step.input.cmdline).toContain("/dev/hmg/share/.pull/")
    expect(step.input.cmdline).toContain("/sdcard/Download/")
  })

  it("accepts a catalog path and a target box host", () => {
    expect(transferShareReady({ 路径: "video/bf/1 (3).mp4", 目标主机: "192.168.76.48", 目标目录: "" })).toBe(true)
    expect(transferShareReady({ 路径: "backup/分组/phone.tar.gz", 目标主机: "192.168.76.140", 目标目录: "分组" })).toBe(true)
    expect(transferShareReady({ 路径: "share/note.txt", 目标主机: "192.168.76.48", 目标目录: "" })).toBe(false)
    expect(transferShareReady({ 路径: "video/bf/1.mp4", 目标主机: "", 目标目录: "" })).toBe(false)
    expect(agentSkillStep("TransferShare", { 路径: "video/bf/1.mp4", 目标主机: "192.168.76.48", 目标目录: "bf" }).skill).toBe(
      "TransferShare",
    )
  })

  it("waits for another box to copy the same path before pulling", () => {
    const waiting = stageShareAction({
      localHost: "192.168.76.140",
      localSha: "",
      moveStatus: null,
      path: "video/bf/1.mp4",
      size: 12,
      sourceHost: "192.168.76.48",
      sourceSha: "a".repeat(64),
    })
    expect(waiting).toMatchObject({ action: "wait", bucket: "video", relative: "bf/1.mp4", targetDirectory: "bf" })
    const ready = stageShareAction({
      localHost: "192.168.76.140",
      localSha: "a".repeat(64),
      moveStatus: "succeeded",
      path: "backup/分组/phone.tar.gz",
      size: 4,
      sourceHost: "192.168.76.48",
      sourceSha: "a".repeat(64),
    })
    expect(ready).toMatchObject({ action: "pull", skill: "PullShareBackup" })
    expect(
      stageShareAction({
        localHost: "192.168.76.140",
        localSha: "",
        moveStatus: null,
        path: "video/bf/1.mp4",
        size: 1,
        sourceHost: "192.168.76.140",
        sourceSha: "",
      }).action,
    ).toBe("pull")
  })

  it("sends DoCmd to the agent", () => {
    const step = agentSkillStep("UploadVideoThenDelete", { 视频目录: "美女", 视频名: "a.mp4" })
    expect(step.skill).toBe("DoCmd")
    expect(step.input.cmdline.startsWith("mv ")).toBe(true)
    expect(agentSkillStep("DoCmd", { cmdline: "pwd" })).toEqual({ input: { cmdline: "pwd" }, skill: "DoCmd" })
  })
})
