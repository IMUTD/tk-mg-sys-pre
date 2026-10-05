import { App, ConfigProvider, theme } from "antd"
import zhCN from "antd/locale/zh_CN"
import type { ReactNode } from "react"

import { UiPreferencesProvider, useUiPreferences } from "./ui-preferences"

type AntdAppProps = { readonly children: ReactNode }

const ThemedApp = ({ children }: AntdAppProps): ReactNode => {
  const { preferences } = useUiPreferences()
  return (
    <ConfigProvider
      button={{ autoInsertSpace: false }}
      locale={zhCN}
      theme={{
        algorithm:
          preferences.navTheme === "realDark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
        cssVar: { key: "tkmg" },
        token: {
          borderRadius: 6,
          colorPrimary: preferences.colorPrimary,
          motion: false,
        },
      }}
    >
      <App>{children}</App>
    </ConfigProvider>
  )
}

export const AntdApp = ({ children }: AntdAppProps): ReactNode => (
  <UiPreferencesProvider>
    <ThemedApp>{children}</ThemedApp>
  </UiPreferencesProvider>
)
