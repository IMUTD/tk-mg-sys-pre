import { render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AntdApp } from "../../app/antd-app"
import { AccountsListPage } from "./list-page"

afterEach(() => vi.unstubAllGlobals())

describe("account page API wiring", () => {
  it("loads all live and recycled pages, batches credentials and clears data when changing groups", async () => {
    const firstGroup = "11111111-1111-4111-8111-111111111111"
    const secondGroup = "22222222-2222-4222-8222-222222222222"
    const credentialBatches: { groupId: string; ids: string[] }[] = []
    const pages: { groupId: string; page: number; deleted: boolean }[] = []
    const record = (index: number, groupId: string, deleted = false) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${index.toString().padStart(12, "0")}`,
      groupId,
      identifier: `${groupId === firstGroup ? "first" : "second"}.account.${index}`,
      name: "Account fixture",
      status: "ready",
      platformUid: `${index}`,
      updatedAt: "2026-10-06T00:00:00Z",
      deleted,
      deletedAt: deleted ? new Date().toISOString() : null,
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request) => {
        const url = new URL(input.url)
        if (url.pathname === "/api/labels/catalog")
          return Response.json({
            administratorId: null,
            canDelete: false,
            scope: url.searchParams.get("scope"),
            groups: [],
            remarks: [],
          })
        const groupId = url.pathname.includes(firstGroup) ? firstGroup : secondGroup
        if (url.pathname.endsWith("/credentials")) {
          const body = (await input.json()) as { ids: string[] }
          credentialBatches.push({ groupId, ids: body.ids })
          return Response.json(
            body.ids.map((id) => ({
              id,
              password: "fixture-secret",
              emailPassword: "",
              msToken: "",
              pop3Password: "",
              totp: "",
            })),
          )
        }
        const page = Number(url.searchParams.get("page"))
        const deleted = url.searchParams.get("deleted") === "true"
        pages.push({ groupId, page, deleted })
        const items =
          groupId === secondGroup
            ? deleted
              ? []
              : [record(999, groupId)]
            : deleted
              ? [record(502, groupId, true)]
              : page === 1
                ? Array.from({ length: 500 }, (_, index) => record(index, groupId))
                : [record(500, groupId)]
        return Response.json({
          items,
          page,
          pageSize: 500,
          total: groupId === secondGroup ? (deleted ? 0 : 1) : deleted ? 1 : 501,
        })
      }),
    )
    const page = (groupId: string) => (
      <MemoryRouter>
        <AntdApp>
          <AccountsListPage canWrite groupId={groupId} />
        </AntdApp>
      </MemoryRouter>
    )
    const view = render(page(firstGroup))
    expect(await screen.findByText("first.account.0")).toBeVisible()
    expect(pages).toEqual([
      { groupId: firstGroup, page: 1, deleted: false },
      { groupId: firstGroup, page: 2, deleted: false },
      { groupId: firstGroup, page: 1, deleted: true },
    ])
    expect(credentialBatches.map((batch) => batch.ids.length)).toEqual([500, 2])
    expect(credentialBatches.every((batch) => batch.groupId === firstGroup)).toBe(true)
    expect(screen.queryByText("first.account.502")).not.toBeInTheDocument()
    view.rerender(page(secondGroup))
    expect(await screen.findByText("second.account.999")).toBeVisible()
    await waitFor(() => expect(screen.queryByText("first.account.0")).not.toBeInTheDocument())
    expect(credentialBatches.at(-1)?.groupId).toBe(secondGroup)
    expect(credentialBatches.at(-1)?.ids).toHaveLength(1)
  })
})
