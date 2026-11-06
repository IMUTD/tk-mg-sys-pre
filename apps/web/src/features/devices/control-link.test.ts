import { describe, expect, it } from "vitest"

import { linkPhase, playerUrl, webrtcPorts } from "./control-link"

describe("webrtcPorts", () => {
  it("uses the reported host ports and falls back per pit", () => {
    expect(webrtcPorts(1, 30007, 30008)).toEqual({ tcp: 30007, udp: 30008 })
    expect(webrtcPorts(2, 0, undefined)).toEqual({ tcp: 30107, udp: 30108 })
    const url = playerUrl("192.168.76.163", {
      host: "192.168.76.163",
      index: 4,
      webrtcTcp: 30307,
      webrtcUdp: 30308,
    })
    expect(url).toBe(
      "/webplayer/play.html?embed=1&q=1&rtc_i=192.168.76.163&rtc_p=30308" +
        "&shost=192.168.76.163&sport=30307&v=h264",
    )
  })
})

describe("linkPhase", () => {
  it("waits eight seconds before calling an unread player disconnected", () => {
    expect(linkPhase(null, 1000)).toBe("connecting")
    expect(linkPhase(null, 8000)).toBe("down")
  })

  it("treats video or a connected ice state as up", () => {
    expect(linkPhase({ status: 4 }, 0)).toBe("up")
    expect(linkPhase({ ice: "connected", status: 0 }, 0)).toBe("up")
    expect(linkPhase({ ice: "completed", status: 1 }, 9000)).toBe("up")
  })

  it("keeps a signaling-only session connecting and fails a closed one", () => {
    expect(linkPhase({ status: 1 }, 9000)).toBe("connecting")
    expect(linkPhase({ status: 0, wsState: 1 }, 9000)).toBe("connecting")
    expect(linkPhase({ status: 0 }, 7999)).toBe("connecting")
    expect(linkPhase({ status: 0 }, 8000)).toBe("down")
    expect(linkPhase({ status: 2 }, 0)).toBe("down")
    expect(linkPhase({ status: 3, wsState: 1 }, 0)).toBe("down")
  })
})
