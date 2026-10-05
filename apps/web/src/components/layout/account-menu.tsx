import { LogoutOutlined, SettingOutlined, SkinOutlined } from "@ant-design/icons"
import { useQueryClient } from "@tanstack/react-query"
import { Descriptions, Dropdown, Modal, Typography } from "antd"
import { type ReactNode, useState } from "react"
import { useNavigate } from "react-router-dom"

import { useUiPreferences } from "../../app/ui-preferences"
import { useAuth } from "../../features/auth/auth-provider"
import { memberDisplayName, type SessionUser } from "../../lib/api/auth-api"
import { ROLE_LABELS } from "../../lib/pages"

type AccountMenuProps = {
  readonly children: ReactNode
  readonly user: SessionUser
}

const roleText = (role: SessionUser["scope"]["role"]): string => ROLE_LABELS[role] ?? role

export const AccountMenu = ({ children, user }: AccountMenuProps): ReactNode => {
  const { api } = useAuth()
  const { openSettings } = useUiPreferences()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [profileOpen, setProfileOpen] = useState(false)

  const logout = async (): Promise<void> => {
    await api.logout()
    queryClient.setQueryData(["auth", "session"], { kind: "unauthenticated" })
    await navigate("/login", { replace: true })
  }

  return (
    <>
      <Dropdown
        arrow
        menu={{
          items: [
            {
              icon: <SettingOutlined />,
              key: "settings",
              label: "个人设置",
              onClick: () => setProfileOpen(true),
            },
            {
              icon: <SkinOutlined />,
              key: "theme",
              label: "主题设置",
              onClick: () => openSettings(),
            },
            { type: "divider" },
            {
              icon: <LogoutOutlined />,
              key: "logout",
              label: "退出登录",
              onClick: () => void logout(),
            },
          ],
          selectedKeys: [],
        }}
        placement="bottomRight"
        trigger={["click"]}
      >
        <span className="account-menu-trigger">{children}</span>
      </Dropdown>
      <Modal
        footer={null}
        onCancel={() => setProfileOpen(false)}
        open={profileOpen}
        title="个人设置"
      >
        <Descriptions column={1} size="small">
          <Descriptions.Item label="名字">
            <Typography.Text>{memberDisplayName(user)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="角色">{roleText(user.scope.role)}</Descriptions.Item>
        </Descriptions>
      </Modal>
    </>
  )
}
