import { DefaultFooter } from "@ant-design/pro-components"
import type { ReactNode } from "react"

import { APP_NAME, APP_VERSION } from "../../app/product"

export const AppFooter = (): ReactNode => (
  <DefaultFooter copyright={`${new Date().getFullYear()} ${APP_NAME} ${APP_VERSION}`} />
)
