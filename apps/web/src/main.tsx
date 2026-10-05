import { createRoot } from "react-dom/client"

import { WebApp } from "./app/router"
import { createAuthApi } from "./lib/api/auth-api"
import "./styles/global.css"
import "./styles/admin.css"
import "./styles/task-create-dialog.css"

window.localStorage.setItem("umi_locale", "zh-CN")
Object.assign(window, { g_locale: "zh-CN" })

class ApplicationRootNotFoundError extends Error {
  readonly name = "ApplicationRootNotFoundError"

  constructor() {
    super("The application root element is missing")
  }
}

const rootElement = document.getElementById("root")
if (rootElement === null) {
  throw new ApplicationRootNotFoundError()
}

createRoot(rootElement).render(<WebApp api={createAuthApi()} />)
