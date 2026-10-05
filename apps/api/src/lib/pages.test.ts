import { describe, expect, it } from "bun:test"

import { defaultPagesForRole, mergePageAccess, PageKey, permissionsForPages } from "./pages"

describe("defaultPagesForRole", () => {
  it("gives operators operations pages without delete or members access", () => {
    const pages = defaultPagesForRole("operator")
    const devices = pages.find((page) => page.key === PageKey.Devices)
    const members = pages.find((page) => page.key === PageKey.Members)
    const marketing = pages.find((page) => page.key === PageKey.MarketingDashboard)
    const videoPool = pages.find((page) => page.key === PageKey.StudioVideoPool)
    const workLogs = pages.find((page) => page.key === PageKey.WorkLogs)
    const overview = pages.find((page) => page.key === PageKey.Overview)
    expect(devices).toEqual({ canDelete: false, canView: true, key: PageKey.Devices })
    expect(members).toEqual({ canDelete: false, canView: false, key: PageKey.Members })
    expect(marketing).toEqual({ canDelete: false, canView: false, key: PageKey.MarketingDashboard })
    expect(videoPool).toEqual({ canDelete: false, canView: true, key: PageKey.StudioVideoPool })
    expect(workLogs).toEqual({ canDelete: false, canView: false, key: PageKey.WorkLogs })
    expect(overview).toEqual({ canDelete: false, canView: true, key: PageKey.Overview })
  })

  it("gives department directors delete on their own pages and resource center", () => {
    const sales = defaultPagesForRole("sales_director").find(
      (page) => page.key === PageKey.MarketingAccounts,
    )
    const ops = defaultPagesForRole("operations_director").find(
      (page) => page.key === PageKey.Devices,
    )
    const opsResource = defaultPagesForRole("operations_director").find(
      (page) => page.key === PageKey.StudioVideoPool,
    )
    const opsLogs = defaultPagesForRole("operations_director").find(
      (page) => page.key === PageKey.WorkLogs,
    )
    const engineer = defaultPagesForRole("engineer").find((page) => page.key === PageKey.Storage)
    const engineeringDirector = defaultPagesForRole("engineering_director").find(
      (page) => page.key === PageKey.StudioTextPool,
    )
    expect(sales).toEqual({ canDelete: true, canView: true, key: PageKey.MarketingAccounts })
    expect(ops).toEqual({ canDelete: true, canView: true, key: PageKey.Devices })
    expect(opsResource).toEqual({ canDelete: true, canView: true, key: PageKey.StudioVideoPool })
    expect(opsLogs).toEqual({ canDelete: false, canView: false, key: PageKey.WorkLogs })
    expect(engineer).toEqual({ canDelete: false, canView: true, key: PageKey.Storage })
    expect(engineeringDirector).toEqual({
      canDelete: true,
      canView: true,
      key: PageKey.StudioTextPool,
    })
  })

  it("locks overview delete even for administrators", () => {
    const overview = defaultPagesForRole("administrator").find(
      (page) => page.key === PageKey.Overview,
    )
    expect(overview).toEqual({ canDelete: false, canView: true, key: PageKey.Overview })
  })

  it("maps viewed operation pages to API write permissions", () => {
    expect(permissionsForPages(defaultPagesForRole("operator"))).toContain("devices:write")
    expect(permissionsForPages(defaultPagesForRole("salesperson"))).not.toContain("devices:read")
    expect(permissionsForPages(defaultPagesForRole("salesperson"))).toContain("resources:read")
  })

  it("ignores stored work-log grants and overview delete for non-admins", () => {
    const merged = mergePageAccess("operator", [
      { canDelete: true, canView: true, key: PageKey.WorkLogs },
      { canDelete: true, canView: true, key: PageKey.Overview },
      { canDelete: true, canView: true, key: PageKey.Devices },
    ])
    expect(merged.find((page) => page.key === PageKey.WorkLogs)).toEqual({
      canDelete: false,
      canView: false,
      key: PageKey.WorkLogs,
    })
    expect(merged.find((page) => page.key === PageKey.Overview)).toEqual({
      canDelete: false,
      canView: true,
      key: PageKey.Overview,
    })
    expect(merged.find((page) => page.key === PageKey.Devices)).toEqual({
      canDelete: true,
      canView: true,
      key: PageKey.Devices,
    })
  })
})
