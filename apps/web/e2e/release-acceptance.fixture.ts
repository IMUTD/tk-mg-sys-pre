import type { Page, Request, Route } from "@playwright/test"

export const groupA = "11111111-1111-4111-8111-111111111111"

type SessionUser = {
  readonly email: string
  readonly scope: {
    readonly groupIds: readonly string[]
    readonly permissions: readonly string[]
    readonly role:
      | "administrator"
      | "engineer"
      | "engineering_director"
      | "operator"
      | "operations_director"
      | "sales_director"
      | "salesperson"
  }
  readonly userId: string
}

export const administrator: SessionUser = {
  email: "admin@example.com",
  scope: { groupIds: [], permissions: ["configuration:write"], role: "administrator" },
  userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
}

export const operator: SessionUser = {
  email: "operator@example.com",
  scope: {
    groupIds: [groupA],
    permissions: ["operations:read", "operations:write", "resources:read", "resources:write"],
    role: "operator",
  },
  userId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
}

export const json = (
  body: unknown,
  status = 200,
): { readonly body: string; readonly contentType: string; readonly status: number } => ({
  body: JSON.stringify(body),
  contentType: "application/json",
  status,
})

export type ApiHandler = (route: Route, request: Request, pathname: string) => Promise<void>

export const routeApi = async (
  page: Page,
  user: SessionUser,
  handler: ApiHandler,
): Promise<void> => {
  await page.route("**/api/**", async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (pathname === "/api/auth/session") {
      await route.fulfill(json({ user }))
      return
    }
    await handler(route, request, pathname)
  })
}
