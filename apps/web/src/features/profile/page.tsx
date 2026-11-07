import { useQueryClient } from "@tanstack/react-query"
import { Alert, Card, Descriptions, Tag } from "antd"
import { useCallback } from "react"
import { memberDisplayName } from "../../lib/api/auth-api"
import { ROLE_LABELS } from "../../lib/pages"
import { useAuth } from "../auth/auth-provider"
import { IdentityVerificationPage } from "../identity-verification/page"

export const ProfilePage = () => {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const refreshSession = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["auth", "session"] }),
    [queryClient],
  )
  if (session.kind !== "authenticated") return null
  const { user } = session
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 760, width: "100%", margin: "0 auto" }}>
      <Card title="个人资料">
        <Descriptions column={1} size="small" style={{ overflowWrap: "anywhere" }}>
          <Descriptions.Item label="名字">{memberDisplayName(user)}</Descriptions.Item>
          <Descriptions.Item label="账号">{user.email}</Descriptions.Item>
          <Descriptions.Item label="角色">{ROLE_LABELS[user.scope.role]}</Descriptions.Item>
        </Descriptions>
      </Card>
      {user.identity?.canAccessBusiness === false && (
        <Alert showIcon type="info" title="请先完成实名认证，认证后即可使用系统功能。" />
      )}
      {user.identity?.canVerify ? (
        <IdentityVerificationPage
          key={user.userId}
          userId={user.userId}
          onVerified={refreshSession}
        />
      ) : (
        <Card title="实名认证">
          {user.identity?.status === "verified" ? (
            <Tag color="success">已认证</Tag>
          ) : (
            <Tag>{user.identity?.mode === "off" ? "暂未开放" : "无需认证"}</Tag>
          )}
        </Card>
      )}
    </div>
  )
}
