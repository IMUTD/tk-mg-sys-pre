import { useQueryClient } from "@tanstack/react-query"
import { Button, Space, Typography, theme } from "antd"
import { Outlet } from "react-router-dom"
import { useAuth } from "../auth/auth-provider"

export const IdentityRequiredLayout = () => {
  const { token } = theme.useToken()
  const { api } = useAuth()
  const queryClient = useQueryClient()
  const logout = async () => {
    await queryClient.cancelQueries()
    await api.logout()
    await queryClient.cancelQueries()
    queryClient.clear()
    queryClient.setQueryData(["auth", "session"], { kind: "unauthenticated" })
  }
  return (
    <main style={{ minHeight: "100vh", padding: 16, background: token.colorBgLayout }}>
      <Space
        style={{
          display: "flex",
          maxWidth: 760,
          margin: "0 auto 16px",
          justifyContent: "space-between",
        }}
      >
        <Typography.Text strong>哈蜜瓜云控 · 实名认证</Typography.Text>
        <Button onClick={() => void logout()}>退出登录</Button>
      </Space>
      <Outlet />
    </main>
  )
}
