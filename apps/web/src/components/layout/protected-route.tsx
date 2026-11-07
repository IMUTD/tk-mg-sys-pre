import { Alert, Result, Spin } from "antd"
import type { ReactNode } from "react"
import { Navigate, useLocation } from "react-router-dom"

import brandLogo from "../../assets/brand-logo.png"
import { useAuth } from "../../features/auth/auth-provider"
import { assertNever } from "../../lib/assert-never"
import { canViewScopedPage, firstAccessiblePath } from "../../lib/pages"
import { AdminShell } from "./admin-shell"

const ServiceUnavailablePage = (): ReactNode => (
  <main className="unavailable-page">
    <img alt="" className="login-logo" height={56} src={brandLogo} width={56} />
    <Result
      className="page-message"
      extra={
        <Alert
          description="请启动 API 服务或检查 Vite 的 VITE_API_PROXY 配置。为保护权限，系统不会启用本地演示登录。"
          message="INTRANET API OFFLINE"
          showIcon
          type="warning"
        />
      }
      status="warning"
      title="认证服务暂不可用"
    />
  </main>
)

export const ProtectedRoute = (): ReactNode => {
  const { session } = useAuth()
  const location = useLocation()

  switch (session.kind) {
    case "loading":
      return (
        <main className="route-loading">
          <img alt="" className="login-logo" height={48} src={brandLogo} width={48} />
          <Spin size="large" />
          <p>正在验证会话…</p>
        </main>
      )
    case "authenticated":
      return <AdminShell user={session.user} />
    case "unauthenticated":
      return <Navigate replace state={{ from: location.pathname }} to="/login" />
    case "unavailable":
      return <ServiceUnavailablePage />
    default:
      return assertNever(session)
  }
}

export const PageGuard = ({
  children,
  page,
}: {
  readonly children: ReactNode
  readonly page: string
}): ReactNode => {
  const { session } = useAuth()
  switch (session.kind) {
    case "loading":
    case "unauthenticated":
    case "unavailable":
      return null
    case "authenticated":
      return canViewScopedPage(session.user.scope, page) ? (
        children
      ) : (
        <Navigate
          replace
          to={firstAccessiblePath(session.user.scope.role, session.user.scope.pages)}
        />
      )
    default:
      return assertNever(session)
  }
}
