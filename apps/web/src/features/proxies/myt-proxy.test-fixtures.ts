import { emptyProxy, type MytProxy, type ProxyCheckResult, type ProxyDevice } from "./myt-proxy"

const daysFromNow = (days: number): string =>
  `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)} 12:00:00`

const seedCheckResult = (ip: string, country: string): string =>
  JSON.stringify({
    channel: "us",
    check_time: 1_726_560_000_000,
    failures: 0,
    include_response: true,
    message: "成功",
    mode: "detailed",
    ok: true,
    results: [
      {
        delay: 86,
        ok: true,
        response_body: { country, ip },
        status: 200,
        url: "ipinfo.io",
      },
    ],
    status: 200,
    successes: 1,
    use_turbo: false,
  } satisfies ProxyCheckResult)

export const createTestProxies = (): MytProxy[] => [
  {
    ...emptyProxy(101, "2026-09-08 09:12:03"),
    bindNumber: 2,
    expiredTime: "2027-07-18 16:48:00",
    ip: "10.0.0.5",
    password: "proxy-east-secret",
    port: "8080",
    remark: "华东代理",
    result: seedCheckResult("10.0.0.5", "CN"),
    tag: "亮2",
    turbo: true,
    updateTime: "2026-09-16 11:20:08",
    username: "user-east",
  },
  {
    ...emptyProxy(102, "2026-09-09 10:04:11"),
    bindNumber: 1,
    expiredTime: "2027-04-01 12:00:00",
    ip: "10.0.1.8",
    password: "proxy-backup-secret",
    port: "1080",
    remark: "备用线路",
    tag: "测试",
    updateTime: "2026-09-15 18:02:44",
    username: "user-backup",
  },
  {
    ...emptyProxy(103, "2026-09-10 08:30:00"),
    extra: "vless://00000000-0000-0000-0000-000000000000@203.0.113.20:443?security=none#demo-v2",
    ip: "203.0.113.20",
    port: "443",
    remark: "中转V2",
    tag: "加速",
    type: "0",
    updateTime: "2026-09-14 09:18:22",
    username: "00000000-0000-0000-0000-000000000000",
  },
  {
    ...emptyProxy(104, "2026-09-11 13:45:09"),
    ip: "198.51.100.12",
    password: "dyn-secret",
    port: "3128",
    proxyType: "dynamic",
    region: "US",
    remark: "动态池",
    tag: "美国区",
    type: "1",
    updateTime: "2026-09-13 16:11:03",
    username: "user-{}",
  },
  {
    ...emptyProxy(105, "2026-09-12 07:22:41"),
    expiredTime: daysFromNow(2),
    ip: "203.0.113.9",
    password: "guest-secret",
    port: "1080",
    remark: "临时线路",
    updateTime: "2026-09-12 07:22:41",
    username: "guest",
  },
  {
    ...emptyProxy(106, "2026-09-12 19:08:55"),
    favorite: true,
    ip: "192.0.2.40",
    password: "safe-secret",
    port: "1080",
    remark: "安全线路",
    safe: true,
    save: true,
    tag: "亮2",
    tun: true,
    updateTime: "2026-09-16 08:40:19",
    username: "user-safe",
  },
]

export const createTestProxyDevices = (): ProxyDevice[] => [
  { id: 23849, name: "演示盒子-01", seqs: [1, 2, 12] },
  { id: 23850, name: "演示盒子-02", seqs: [3] },
]
