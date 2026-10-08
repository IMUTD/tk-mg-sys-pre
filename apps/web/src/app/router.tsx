import { type QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import {
  BrowserRouter,
  MemoryRouter,
  Navigate,
  Route,
  Routes,
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
import { BackgroundJobsPage } from "../features/jobs/background-page"
import { TaskRecordsPage } from "../features/jobs/records-page"
import { MallInvoicesPage } from "../features/mall/invoices-page"
import { MallOrdersPage } from "../features/mall/orders-page"
import { MallRecordsPage } from "../features/mall/records-page"
import { MallRedeemPage } from "../features/mall/redeem-page"
import { AccountMarketPage } from "../features/marketing/account-market"
import { MarketingDashboard } from "../features/marketing/dashboard"
import { NodeMarketPage } from "../features/marketing/node-market"
import { OpsPage } from "../features/marketing/ops-page"
import { SalesPage } from "../features/marketing/sales-page"
import { MemberPage } from "../features/members/page"
import { OverviewPage } from "../features/overview/page"
import { ProxiesListPage } from "../features/proxies/list-page"
import { RegistrationResourceListPage } from "../features/registration-resources/list-page"
import { ResourcesListPage } from "../features/resources/list-page"
import { RobotsPage } from "../features/robots/page"
import { ConfigListPage } from "../features/settings/list-page"
import { StoragePage } from "../features/storage/page"
import { StudioPage } from "../features/studio/page"
import { TaskListPage } from "../features/tasks/list-page"
import { VideoPoolPage } from "../features/video-pool/page"
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

const RegistrationResourcesPage = (): ReactNode => {
  const { session } = useAuth()
  switch (session.kind) {
    case "authenticated":
      return (
        <RegistrationResourceListPage
          canDelete={pageFlags(session.user, PageKey.StudioRegistration).canDelete}
          canWrite={pageFlags(session.user, PageKey.StudioRegistration).canWrite}
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
  return session.kind === "authenticated" ? (
    <ResourcesListPage
      canDelete={pageFlags(session.user, PageKey.StudioTextPool).canDelete}
      canWrite={pageFlags(session.user, PageKey.StudioTextPool).canWrite}
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
  return session.kind === "authenticated" ? (
    <TaskListPage
      canDelete={pageFlags(session.user, PageKey.Tasks).canDelete}
      canWrite={pageFlags(session.user, PageKey.Tasks).canWrite}
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

const ConfigurationPage = (): ReactNode => {
  const { session } = useAuth()
  return session.kind === "authenticated" ? (
    <ConfigListPage
      canDelete={pageFlags(session.user, PageKey.Configuration).canDelete}
      canWrite={pageFlags(session.user, PageKey.Configuration).canWrite}
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
      <Route path="/marketing" element={<Navigate replace to="/marketing/dashboard" />} />
      <Route
        path="/marketing/dashboard"
        element={guarded(PageKey.MarketingDashboard, <MarketingDashboard />)}
      />
      <Route
        path="/marketing/accounts"
        element={guarded(PageKey.MarketingAccounts, <AccountMarketPage />)}
      />
      <Route
        path="/marketing/nodes"
        element={guarded(PageKey.MarketingNodes, <NodeMarketPage />)}
      />
      <Route path="/marketing/sales" element={guarded(PageKey.MarketingSales, <SalesPage />)} />
      <Route path="/marketing/ops" element={guarded(PageKey.MarketingOps, <OpsPage />)} />
      <Route path="/mall" element={<Navigate replace to="/mall/records" />} />
      <Route path="/mall/records" element={guarded(PageKey.MallRecords, <MallRecordsPage />)} />
      <Route path="/mall/orders" element={guarded(PageKey.MallOrders, <MallOrdersPage />)} />
      <Route path="/mall/invoices" element={guarded(PageKey.MallInvoices, <MallInvoicesPage />)} />
      <Route path="/mall/redeem" element={guarded(PageKey.MallRedeem, <MallRedeemPage />)} />
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
      <Route
        path="/studio/image-pool"
        element={guarded(PageKey.StudioImagePool, <StudioPage kind="image-pool" />)}
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
      <Route path="/operations/tasks" element={guarded(PageKey.Tasks, <TasksPage />)} />
      <Route
        path="/operations/background-tasks"
        element={guarded(PageKey.BackgroundTasks, <BackgroundJobsPage />)}
      />
      <Route
        path="/operations/task-records"
        element={guarded(PageKey.TaskRecords, <TaskRecordsPage />)}
      />
      <Route path="/operations/proxies" element={guarded(PageKey.Proxies, <ProxiesPage />)} />
      <Route
        path="/operations/configuration"
        element={guarded(PageKey.Configuration, <ConfigurationPage />)}
      />
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
