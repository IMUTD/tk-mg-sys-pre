import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useSearchParams,
} from "react-router-dom"

import { PageGuard, ProtectedRoute } from "../components/layout/protected-route"
import { QueryErrorBoundary } from "../components/layout/query-error-boundary"
import { AccountPoolListPage } from "../features/account-pool/list-page"
import { AccountsListPage } from "../features/accounts/list-page"
import { AuditPage } from "../features/audit/page"
import { AuthProvider, useAuth } from "../features/auth/auth-provider"
import { LoginPage } from "../features/auth/login-page"
import { BehaviorsPage } from "../features/behaviors/page"
import { createDevicesApi } from "../features/devices/api"
import { DeviceControlPage } from "../features/devices/control-page"
import { DeviceCreatePage } from "../features/devices/create-page"
import { DeviceListPage } from "../features/devices/list-page"
import { DevicePreviewPage } from "../features/devices/preview-page"
import { MallInvoicesPage } from "../features/mall/invoices-page"
import { MallOrdersPage } from "../features/mall/orders-page"
import { MallRecordsPage } from "../features/mall/records-page"
import { MallRedeemPage } from "../features/mall/redeem-page"
import { MemberPage } from "../features/members/page"
import { AccountTransferPage } from "../features/merchant/accounts-page"
import { MerchantInvoicesPage } from "../features/merchant/invoices-page"
import { MerchantOrdersPage } from "../features/merchant/orders-page"
import { MerchantProductsPage } from "../features/merchant/products-page"
import { ProxyTransferPage } from "../features/merchant/proxies-page"
import { MerchantRechargePage } from "../features/merchant/recharge-page"
import { OverviewPage } from "../features/overview/page"
import { ProxiesListPage } from "../features/proxies/list-page"
import { RegistrationResourceListPage } from "../features/registration-resources/list-page"
import { ResourcesListPage } from "../features/resources/list-page"
import { RobotsPage } from "../features/robots/page"
import { StoragePage } from "../features/storage/page"
import { StudioPage } from "../features/studio/page"
import { DispatchListPage } from "../features/tasks/dispatch-page"
import { VideoPoolPage } from "../features/video-pool/page"
import { VideoResourcesPage } from "../features/video-resources/page"
import type { SessionUser } from "../lib/api/auth-api"
import { assertNever } from "../lib/assert-never"
import { canDeletePage, canViewPage, PageKey } from "../lib/pages"
import { AntdApp } from "./antd-app"
import { createQueryClient } from "./query-client"

export type { AuthApi } from "../lib/api/auth-api"

import type { AuthApi } from "../lib/api/auth-api"

const pageFlags = (user: SessionUser, path: string) => ({
  canDelete: canDeletePage(user.scope.role, path, user.scope.pages),
  canWrite: canViewPage(user.scope.role, path, user.scope.pages),
})

const SharedPoolRedirect = (): ReactNode => {
  const [params] = useSearchParams()
  const tab = params.get("tab")
  if (tab === "image") return <Navigate replace to="/studio/image-pool" />
  if (tab === "backup") return <Navigate replace to="/studio/backup-resources" />
  if (tab === "registration") return <Navigate replace to="/studio/registration" />
  return <Navigate replace to="/studio/share-video" />
}

const OperationsRegistrationRedirect = (): ReactNode => {
  const [params] = useSearchParams()
  const search = params.toString()
  return (
    <Navigate
      replace
      to={
        search.length === 0 ? PageKey.StudioRegistration : `${PageKey.StudioRegistration}?${search}`
      }
    />
  )
}

const RegistrationResourcesPage = (): ReactNode => {
  const { session } = useAuth()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const page =
    pathname === PageKey.OperationsRegistration
      ? PageKey.OperationsRegistration
      : PageKey.StudioRegistration
  switch (session.kind) {
    case "authenticated":
      return (
        <RegistrationResourceListPage
          canDelete={pageFlags(session.user, page).canDelete}
          canWrite={pageFlags(session.user, page).canWrite}
          groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
        />
      )
    case "loading":
    case "unauthenticated":
    case "unavailable":
      return null
    default:
      return assertNever(session)
  }
}

const DevicesPage = (): ReactNode => {
  const { session } = useAuth()
  switch (session.kind) {
    case "authenticated":
      return (
        <DeviceListPage
          canDelete={pageFlags(session.user, PageKey.Devices).canDelete}
          canWrite={pageFlags(session.user, PageKey.Devices).canWrite}
          isAdministrator={session.user.scope.role === "administrator"}
        />
      )
    case "loading":
    case "unauthenticated":
    case "unavailable":
      return null
    default:
      return assertNever(session)
  }
}

const deviceGroupId = (groupIds: readonly string[], requestedGroupId: string | null): string =>
  requestedGroupId !== null && requestedGroupId.length > 0 ? requestedGroupId : (groupIds[0] ?? "")

const DeviceCreateRoute = (): ReactNode => {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  switch (session.kind) {
    case "authenticated":
      return pageFlags(session.user, PageKey.Devices).canWrite ? (
        <DeviceCreatePage
          api={createDevicesApi()}
          groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
        />
      ) : (
        <Navigate replace to="/operations/devices" />
      )
    case "loading":
    case "unauthenticated":
    case "unavailable":
      return null
    default:
      return assertNever(session)
  }
}

const StorageRoute = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <StoragePage
      canDelete={pageFlags(session.user, PageKey.Storage).canDelete}
      canWrite={pageFlags(session.user, PageKey.Storage).canWrite}
    />
  ) : null
}

const RobotsRoute = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <RobotsPage
      canDelete={pageFlags(session.user, PageKey.Robots).canDelete}
      canWrite={pageFlags(session.user, PageKey.Robots).canWrite}
    />
  ) : null
}

const BehaviorsRoute = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <BehaviorsPage
      canDelete={pageFlags(session.user, PageKey.Behaviors).canDelete}
      canWrite={pageFlags(session.user, PageKey.Behaviors).canWrite}
    />
  ) : null
}

const ResourcesPage = (): ReactNode => {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  return session.kind === "authenticated" ? (
    <ResourcesListPage
      canDelete={pageFlags(session.user, PageKey.StudioTextPool).canDelete}
      canWrite={pageFlags(session.user, PageKey.StudioTextPool).canWrite}
      groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
    />
  ) : null
}

const AccountsPage = (): ReactNode => {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  return session.kind === "authenticated" ? (
    <AccountsListPage
      canDelete={pageFlags(session.user, PageKey.Accounts).canDelete}
      canWrite={pageFlags(session.user, PageKey.Accounts).canWrite}
      groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
    />
  ) : null
}

const AccountPoolPage = (): ReactNode => {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  return session.kind === "authenticated" ? (
    <AccountPoolListPage
      canDelete={pageFlags(session.user, PageKey.AccountPool).canDelete}
      canWrite={pageFlags(session.user, PageKey.AccountPool).canWrite}
      groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
    />
  ) : null
}

const TasksPage = (): ReactNode => {
  const { session } = useAuth()
  const [searchParams] = useSearchParams()
  return session.kind === "authenticated" ? (
    <DispatchListPage
      canWrite={pageFlags(session.user, PageKey.Tasks).canWrite}
      groupId={deviceGroupId(session.user.scope.groupIds, searchParams.get("groupId"))}
    />
  ) : null
}

const ProxiesPage = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <ProxiesListPage
      groupIds={session.user.scope.groupIds}
      canDelete={pageFlags(session.user, PageKey.Proxies).canDelete}
      canWrite={pageFlags(session.user, PageKey.Proxies).canWrite}
    />
  ) : null
}

const VideoPoolRoute = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <VideoPoolPage canDelete={pageFlags(session.user, PageKey.StudioVideoPool).canDelete} />
  ) : null
}

const ProtectedLayout = (): ReactNode => (
  <QueryErrorBoundary>
    <ProtectedRoute />
  </QueryErrorBoundary>
)

const guarded = (page: string, element: ReactNode): ReactNode => (
  <PageGuard page={page}>{element}</PageGuard>
)

const AuthenticatedRoutes = (): ReactNode => (
  <Routes>
    <Route element={<ProtectedLayout />}>
      <Route index element={<Navigate replace to="/overview" />} />
      <Route path="/overview" element={guarded(PageKey.Overview, <OverviewPage />)} />
      <Route path="/mall" element={<Navigate replace to="/mall/records" />} />
      <Route path="/mall/records" element={guarded(PageKey.MallRecords, <MallRecordsPage />)} />
      <Route path="/mall/orders" element={guarded(PageKey.MallOrders, <MallOrdersPage />)} />
      <Route path="/mall/invoices" element={guarded(PageKey.MallInvoices, <MallInvoicesPage />)} />
      <Route path="/mall/redeem" element={guarded(PageKey.MallRedeem, <MallRedeemPage />)} />
      <Route path="/merchant" element={<Navigate replace to="/merchant/recharges" />} />
      <Route
        path="/merchant/products"
        element={guarded("/merchant/products", <MerchantProductsPage />)}
      />
      <Route
        path="/merchant/recharges"
        element={guarded("/merchant/recharges", <MerchantRechargePage />)}
      />
      <Route
        path="/merchant/accounts"
        element={guarded("/merchant/accounts", <AccountTransferPage />)}
      />
      <Route
        path="/merchant/proxies"
        element={guarded("/merchant/proxies", <ProxyTransferPage />)}
      />
      <Route
        path="/merchant/orders"
        element={guarded("/merchant/orders", <MerchantOrdersPage />)}
      />
      <Route
        path="/merchant/invoices"
        element={guarded("/merchant/invoices", <MerchantInvoicesPage />)}
      />
      <Route path="/studio" element={<Navigate replace to="/studio/video" />} />
      <Route
        path="/studio/video"
        element={guarded(PageKey.StudioVideo, <StudioPage kind="video" />)}
      />
      <Route
        path="/studio/image"
        element={guarded(PageKey.StudioImage, <StudioPage kind="image" />)}
      />
      <Route
        path="/studio/text"
        element={guarded(PageKey.StudioText, <StudioPage kind="text" />)}
      />
      <Route
        path="/studio/text-pool"
        element={guarded(PageKey.StudioTextPool, <ResourcesPage />)}
      />
      <Route
        path="/studio/video-pool"
        element={guarded(PageKey.StudioVideoPool, <VideoPoolRoute />)}
      />
      <Route path="/studio/video-resources" element={<SharedPoolRedirect />} />
      <Route
        path="/studio/share-video"
        element={guarded(PageKey.StudioShareVideo, <VideoResourcesPage view="video" />)}
      />
      <Route
        path="/studio/backup-resources"
        element={guarded(PageKey.StudioBackupResources, <VideoResourcesPage view="backup" />)}
      />
      <Route
        path="/studio/image-pool"
        element={guarded(PageKey.StudioImagePool, <VideoResourcesPage view="image" />)}
      />
      <Route
        path="/studio/registration"
        element={guarded(PageKey.StudioRegistration, <RegistrationResourcesPage />)}
      />
      <Route
        path="/registration-resources"
        element={<Navigate replace to="/studio/registration" />}
      />
      <Route path="/operations/resources" element={<Navigate replace to="/studio/text-pool" />} />
      <Route path="/operations/devices" element={guarded(PageKey.Devices, <DevicesPage />)} />
      <Route
        path="/operations/previews"
        element={guarded(PageKey.CloudPreview, <DevicePreviewPage />)}
      />
      <Route
        path="/operations/devices/:deviceId/control"
        element={guarded(PageKey.Devices, <DeviceControlPage />)}
      />
      <Route
        path="/operations/devices/new"
        element={guarded(PageKey.Devices, <DeviceCreateRoute />)}
      />
      <Route path="/engineering" element={<Navigate replace to="/engineering/storage" />} />
      <Route path="/engineering/storage" element={guarded(PageKey.Storage, <StorageRoute />)} />
      <Route path="/engineering/robots" element={guarded(PageKey.Robots, <RobotsRoute />)} />
      <Route
        path="/engineering/behaviors"
        element={guarded(PageKey.Behaviors, <BehaviorsRoute />)}
      />
      <Route path="/operations/storage" element={<Navigate replace to="/engineering/storage" />} />
      <Route path="/operations/accounts" element={guarded(PageKey.Accounts, <AccountsPage />)} />
      <Route
        path="/operations/account-pool"
        element={guarded(PageKey.AccountPool, <AccountPoolPage />)}
      />
      <Route path="/operations/registration" element={<OperationsRegistrationRedirect />} />
      <Route path="/operations/tasks" element={guarded(PageKey.Tasks, <TasksPage />)} />
      <Route
        path="/operations/task-records"
        element={<Navigate replace to="/operations/tasks" />}
      />
      <Route path="/operations/proxies" element={guarded(PageKey.Proxies, <ProxiesPage />)} />
      <Route
        path="/operations/configuration/audit"
        element={<Navigate replace to="/work-logs" />}
      />
      <Route path="/work-logs" element={guarded(PageKey.WorkLogs, <AuditPage />)} />
      <Route path="/members" element={guarded(PageKey.Members, <MemberPage />)} />
      <Route path="/operations/work-logs" element={<Navigate replace to="/work-logs" />} />
      <Route path="/operations/members" element={<Navigate replace to="/members" />} />
    </Route>
    <Route path="/login" element={<LoginPage />} />
    <Route path="*" element={<Navigate replace to="/overview" />} />
  </Routes>
)

type RouterContentProps = { readonly api: AuthApi }

const RouterContent = ({ api }: RouterContentProps): ReactNode => (
  <AuthProvider api={api}>
    <AuthenticatedRoutes />
  </AuthProvider>
)

type WebAppProps = {
  readonly api: AuthApi
  readonly initialPath?: string
  readonly queryClient?: QueryClient
}

export const WebApp = ({ api, initialPath, queryClient }: WebAppProps): ReactNode => {
  const query = queryClient ?? createQueryClient()
  const content = <RouterContent api={api} />

  return (
    <AntdApp>
      <QueryClientProvider client={query}>
        {initialPath === undefined ? (
          <BrowserRouter>{content}</BrowserRouter>
        ) : (
          <MemoryRouter initialEntries={[initialPath]}>{content}</MemoryRouter>
        )}
      </QueryClientProvider>
    </AntdApp>
  )
}
