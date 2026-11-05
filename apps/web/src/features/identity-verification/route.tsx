import { useQueryClient } from "@tanstack/react-query"
import { Result } from "antd"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../auth/auth-provider"
import { IdentityVerificationPage } from "./page"
import { PlatformIdentityPage } from "./platform-page"

export const IdentitySelfRoute = () => {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  if (session.kind !== "authenticated") return null
  if (!session.user.identity?.canVerify) return <Result status="403" title="当前账号无需实名认证" />
  return (
    <IdentityVerificationPage
      key={session.user.userId}
      userId={session.user.userId}
      onVerified={async () => {
        await queryClient.invalidateQueries({ queryKey: ["auth", "session"] })
        await navigate("/overview", { replace: true })
      }}
    />
  )
}

export const IdentityPlatformRoute = () => {
  const { session } = useAuth()
  if (session.kind !== "authenticated") return null
  if (session.user.isPlatformAdmin !== true || session.user.identity?.mode === "off")
    return <Result status="403" title="仅平台管理员可以管理实名认证" />
  return <PlatformIdentityPage key={session.user.userId} viewerId={session.user.userId} />
}
