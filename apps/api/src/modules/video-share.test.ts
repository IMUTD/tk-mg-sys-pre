import { describe, expect, it } from "bun:test"

import { agentSkillStep, sharedVideoCommand } from "./video-share"

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

  it("sends DoCmd to the agent", () => {
    const step = agentSkillStep("UploadVideoThenDelete", { 视频目录: "美女", 视频名: "a.mp4" })
    expect(step.skill).toBe("DoCmd")
    expect(step.input.cmdline.startsWith("mv ")).toBe(true)
    expect(agentSkillStep("DoCmd", { cmdline: "pwd" })).toEqual({ input: { cmdline: "pwd" }, skill: "DoCmd" })
  })
})
