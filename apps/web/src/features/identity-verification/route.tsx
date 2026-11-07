import { Result } from "antd"
import { useAuth } from "../auth/auth-provider"
import { PlatformIdentityPage } from "./platform-page"

export const IdentityPlatformRoute = () => {
  const { session } = useAuth()
  if (session.kind !== "authenticated") return null
  if (session.user.isPlatformAdmin !== true || session.user.identity?.mode === "off")
    return <Result status="403" title="仅平台管理员可以管理实名认证" />
  return <PlatformIdentityPage key={session.user.userId} viewerId={session.user.userId} />
}
