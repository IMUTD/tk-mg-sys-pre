import { LogoutOutlined, SettingOutlined, SkinOutlined } from "@ant-design/icons"
import { useQueryClient } from "@tanstack/react-query"
import { Dropdown } from "antd"
import type { ReactNode } from "react"
import { useNavigate } from "react-router-dom"

import { useUiPreferences } from "../../app/ui-preferences"
import { useAuth } from "../../features/auth/auth-provider"

type AccountMenuProps = {
  readonly children: ReactNode
}

export const AccountMenu = ({ children }: AccountMenuProps): ReactNode => {
  const { api } = useAuth()
  const { openSettings } = useUiPreferences()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const logout = async (): Promise<void> => {
    await queryClient.cancelQueries()
    await api.logout()
    await queryClient.cancelQueries()
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" })
    queryClient.setQueryData(["auth", "session"], { kind: "unauthenticated" })
    await navigate("/login", { replace: true })
  }

  return (
    <Dropdown
      arrow
      menu={{
        items: [
          {
            icon: <SettingOutlined />,
            key: "settings",
            label: "个人资料",
            onClick: () => void navigate("/profile"),
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
  )
}
