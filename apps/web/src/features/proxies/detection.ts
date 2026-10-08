import type { ProxiesApi } from "./api"
import type { DetectOptions, MytProxy, ProxyCheckResult } from "./myt-proxy"

export const defaultIpLookupOptions: DetectOptions = {
  channel: "cn",
  mode: "detailed",
  useTurbo: false,
}

export const detectProxyBatch = async (
  api: Pick<ProxiesApi, "detect">,
  proxies: readonly MytProxy[],
  options: DetectOptions,
  onResult: (proxy: MytProxy, result: ProxyCheckResult) => void,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ succeeded: number; failed: number; requestFailures: number }> => {
  let succeeded = 0
  let failed = 0
  let requestFailures = 0
  for (let offset = 0; offset < proxies.length; offset += 2) {
    await Promise.all(
      proxies.slice(offset, offset + 2).map(async (proxy) => {
        try {
          const result = await api.detect(proxy, { ...options, useTurbo: false })
          onResult(proxy, result)
          if (result.ok) succeeded++
          else failed++
        } catch {
          failed++
          requestFailures++
        }
      }),
    )
    if (offset + 2 < proxies.length) await pause(1500)
  }
  return { succeeded, failed, requestFailures }
}
