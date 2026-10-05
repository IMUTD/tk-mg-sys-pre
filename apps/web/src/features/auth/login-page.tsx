import { LockOutlined, UserOutlined } from "@ant-design/icons"
import { LoginForm, ProFormCheckbox, ProFormText } from "@ant-design/pro-components"
import { useQueryClient } from "@tanstack/react-query"
import { Alert, App, Button } from "antd"
import { type ReactNode, useState } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { ZodError } from "zod"

import { APP_NAME, LOGIN_BACKGROUND_URL } from "../../app/product"
import brandLogo from "../../assets/brand-logo.png"
import { AppFooter } from "../../components/layout/app-footer"
import { LoginInputSchema } from "../../lib/api/auth-api"
import { assertNever } from "../../lib/assert-never"
import { canViewPage, firstAccessiblePath } from "../../lib/pages"
import { useAuth } from "./auth-provider"
import { clearRememberedLogin, readRememberedLogin, writeRememberedLogin } from "./remembered-login"

const destinationFromState = (state: unknown): string => {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return "/overview"
  }
  const from = state.from
  return typeof from === "string" && from.startsWith("/") ? from : "/overview"
}

type LoginFormValues = {
  readonly autoLogin?: boolean
  readonly email?: string
  readonly password?: string
}

export const LoginPage = (): ReactNode => {
  const { api, session } = useAuth()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const handleSubmit = async (values: LoginFormValues): Promise<boolean> => {
    try {
      const input = LoginInputSchema.parse({
        email: values.email,
        password: values.password,
      })
      setValidationMessage(null)
      const result = await api.login(input)
      switch (result.kind) {
        case "authenticated":
          if (values.autoLogin === false) {
            clearRememberedLogin()
          } else {
            writeRememberedLogin({ email: input.email })
          }
          message.success("登录成功！")
          queryClient.setQueryData(["auth", "session"], result)
          return true
        case "unauthenticated":
          setValidationMessage("邮箱或密码不正确")
          return false
        case "unavailable":
          setValidationMessage("认证服务暂不可用，请确认内网 API 已启动")
          return false
        default:
          return assertNever(result)
      }
    } catch (error) {
      if (error instanceof ZodError) {
        setValidationMessage(error.issues[0]?.message ?? "请检查登录信息")
        return false
      }
      throw error
    }
  }

  if (session.kind === "authenticated") {
    const destination = destinationFromState(location.state)
    return (
      <Navigate
        replace
        to={
          canViewPage(session.user.scope.role, destination, session.user.scope.pages)
            ? destination
            : firstAccessiblePath(session.user.scope.role, session.user.scope.pages)
        }
      />
    )
  }

  return (
    <main
      className="login-page"
      style={{
        backgroundImage: `url('${LOGIN_BACKGROUND_URL}')`,
      }}
    >
      <div className="login-page-body">
        <LoginForm<LoginFormValues>
          contentStyle={{
            maxWidth: "75vw",
            minWidth: 280,
          }}
          initialValues={{
            autoLogin: true,
            ...(readRememberedLogin() ?? {}),
          }}
          logo={<img alt={APP_NAME} src={brandLogo} />}
          message={
            validationMessage === null ? (
              false
            ) : (
              <Alert message={validationMessage} showIcon type="error" />
            )
          }
          onFinish={handleSubmit}
          subTitle="使用已分配的成员账户进入内网控制台。"
          title={false}
        >
          <ProFormText
            fieldProps={{
              "aria-label": "邮箱",
              autoComplete: "email",
              id: "email",
              prefix: <UserOutlined />,
              size: "large",
            }}
            name="email"
            placeholder="邮箱"
            rules={[{ message: "请输入邮箱!", required: true }]}
          />
          <ProFormText.Password
            fieldProps={{
              "aria-label": "密码",
              autoComplete: "current-password",
              id: "password",
              prefix: <LockOutlined />,
              size: "large",
            }}
            name="password"
            placeholder="密码"
            rules={[{ message: "请输入密码！", required: true }]}
          />
          <div className="login-extra">
            <ProFormCheckbox noStyle name="autoLogin">
              记住邮箱
            </ProFormCheckbox>
            <Button
              onClick={() => {
                message.info("请联系管理员重置密码")
              }}
              style={{ float: "right", padding: 0 }}
              type="link"
            >
              忘记密码
            </Button>
          </div>
        </LoginForm>
      </div>
      <AppFooter />
    </main>
  )
}
