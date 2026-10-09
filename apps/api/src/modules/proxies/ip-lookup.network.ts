import assert from "node:assert/strict"
import { createIpLookupTransport } from "./ip-lookup"

const transport = createIpLookupTransport()
try {
  for (const channel of ["cn", "us"] as const) {
    const result = await transport.query(
      "8.8.8.8",
      { channel, mode: "detailed", useTurbo: false },
      10000,
    )
    assert.equal(result.information.ip, "8.8.8.8")
    assert.match(result.information.country, /^[A-Z]{2}$/)
    console.log(
      JSON.stringify({
        channel,
        requestedIp: "8.8.8.8",
        information: result.information,
        delay: result.delay,
        connectivityChecked: false,
      }),
    )
  }
} finally {
  await transport.close?.()
}
