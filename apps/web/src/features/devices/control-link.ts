export type LinkPhase = "connecting" | "down" | "up"

export type PlayerSnapshot = {
  readonly ice?: string
  readonly status?: number
  readonly wsState?: number
} | null

export type PitAddress = {
  readonly host: string
  readonly index: number
  readonly webrtcTcp?: number
  readonly webrtcUdp?: number
}

const reportedPort = (value: number | undefined): number =>
  value !== undefined && Number.isInteger(value) && value > 0 && value <= 65535 ? value : 0

export const webrtcPorts = (
  index: number,
  webrtcTcp: number | undefined,
  webrtcUdp: number | undefined,
): { readonly tcp: number; readonly udp: number } => {
  const fallbackTcp = 30000 + (index - 1) * 100 + 7
  return {
    tcp: reportedPort(webrtcTcp) || fallbackTcp,
    udp: reportedPort(webrtcUdp) || fallbackTcp + 1,
  }
}

export const playerUrl = (host: string, slot: PitAddress): string => {
  const ports = webrtcPorts(slot.index, slot.webrtcTcp, slot.webrtcUdp)
  const query = new URLSearchParams({
    embed: "1",
    q: "1",
    rtc_i: host,
    rtc_p: String(ports.udp),
    shost: host,
    sport: String(ports.tcp),
    v: "h264",
  })
  return `/webplayer/play.html?${query.toString()}`
}

export const linkPhase = (player: PlayerSnapshot, elapsedMs: number): LinkPhase => {
  if (player === null) return elapsedMs >= 8000 ? "down" : "connecting"
  if (player.status === 4 || player.ice === "connected" || player.ice === "completed") return "up"
  if (player.status === 2 || player.status === 3) return "down"
  const stillIdle = player.status === 0 || player.status === undefined
  if (elapsedMs >= 8000 && stillIdle && player.wsState !== 1) return "down"
  return "connecting"
}

export const linkLabel = (phase: LinkPhase): string => {
  if (phase === "up") return "已连接"
  if (phase === "down") return "局域网未连通"
  return "连接中"
}
