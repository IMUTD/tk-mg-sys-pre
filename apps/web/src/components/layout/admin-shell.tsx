import {
  AccountBookOutlined,
  AppstoreOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileImageOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FontSizeOutlined,
  FundOutlined,
  GiftOutlined,
  GlobalOutlined,
  HighlightOutlined,
  HistoryOutlined,
  HomeOutlined,
  InboxOutlined,
  NodeIndexOutlined,
  PictureOutlined,
  PlaySquareOutlined,
  ProfileOutlined,
  RiseOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  TabletOutlined,
  TeamOutlined,
  ToolOutlined,
  TrophyOutlined,
  UnorderedListOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons"
import type { MenuDataItem } from "@ant-design/pro-components"
import { ProLayout, SettingDrawer } from "@ant-design/pro-components"
import { type ComponentProps, type ReactNode, useEffect, useState } from "react"
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom"

import { APP_NAME, APP_OVERVIEW_LABEL, layoutBackgroundImages } from "../../app/product"
import { useUiPreferences } from "../../app/ui-preferences"
import brandLogo from "../../assets/brand-logo.png"
import { memberDisplayName, type SessionUser } from "../../lib/api/auth-api"
import { canViewPage } from "../../lib/pages"
import { AccountMenu } from "./account-menu"
import { AppFooter } from "./app-footer"

type NavigationItem = {
  readonly children?: readonly NavigationItem[]
  readonly icon: ReactNode
  readonly label: string
  readonly path: string
}

const navigation: readonly NavigationItem[] = [
  { icon: <HomeOutlined aria-hidden />, label: "运营概览", path: "/overview" },
  {
    icon: <FundOutlined aria-hidden />,
    label: "营销中心",
    path: "/marketing",
    children: [
      { icon: <DashboardOutlined aria-hidden />, label: "营销面板", path: "/marketing/dashboard" },
      { icon: <ShopOutlined aria-hidden />, label: "账号市场", path: "/marketing/accounts" },
      { icon: <ClusterOutlined aria-hidden />, label: "节点市场", path: "/marketing/nodes" },
      { icon: <RiseOutlined aria-hidden />, label: "销售业绩", path: "/marketing/sales" },
      { icon: <TrophyOutlined aria-hidden />, label: "运营业绩", path: "/marketing/ops" },
    ],
  },
  {
    icon: <GiftOutlined aria-hidden />,
    label: "积分商场",
    path: "/mall",
    children: [
      { icon: <AccountBookOutlined aria-hidden />, label: "积分记录", path: "/mall/records" },
      { icon: <ProfileOutlined aria-hidden />, label: "我的订单", path: "/mall/orders" },
      { icon: <FileProtectOutlined aria-hidden />, label: "发票申请", path: "/mall/invoices" },
      { icon: <ShoppingOutlined aria-hidden />, label: "兑换中心", path: "/mall/redeem" },
    ],
  },
  {
    icon: <AppstoreOutlined aria-hidden />,
    label: "运营中心",
    path: "/operations",
    children: [
      { icon: <TabletOutlined aria-hidden />, label: "盒子管理", path: "/operations/devices" },
      { icon: <UserOutlined aria-hidden />, label: "账号管理", path: "/operations/accounts" },
      { icon: <TeamOutlined aria-hidden />, label: "账号池", path: "/operations/account-pool" },
      { icon: <UnorderedListOutlined aria-hidden />, label: "任务列表", path: "/operations/tasks" },
      {
        icon: <HistoryOutlined aria-hidden />,
        label: "任务记录",
        path: "/operations/task-records",
      },
      { icon: <GlobalOutlined aria-hidden />, label: "代理管理", path: "/operations/proxies" },
      { icon: <PlaySquareOutlined aria-hidden />, label: "视频数据", path: "/studio/video-pool" },
    ],
  },
  {
    icon: <ToolOutlined aria-hidden />,
    label: "工程中心",
    path: "/engineering",
    children: [
      {
        icon: <CloudServerOutlined aria-hidden />,
        label: "私有云储存",
        path: "/engineering/storage",
      },
      {
        icon: <RobotOutlined aria-hidden />,
        label: "运营机器人",
        path: "/engineering/robots",
      },
      {
        icon: <NodeIndexOutlined aria-hidden />,
        label: "行为中心",
        path: "/engineering/behaviors",
      },
      {
        icon: <SettingOutlined aria-hidden />,
        label: "配置中心",
        path: "/operations/configuration",
      },
    ],
  },
  {
    icon: <HighlightOutlined aria-hidden />,
    label: "制作中心",
    path: "/production",
    children: [
      { icon: <VideoCameraOutlined aria-hidden />, label: "视频制作", path: "/studio/video" },
      { icon: <FileImageOutlined aria-hidden />, label: "图片制作", path: "/studio/image" },
      { icon: <FontSizeOutlined aria-hidden />, label: "文本制作", path: "/studio/text" },
    ],
  },
  {
    icon: <FolderOpenOutlined aria-hidden />,
    label: "资源中心",
    path: "/resources",
    children: [
      { icon: <InboxOutlined aria-hidden />, label: "文本池", path: "/studio/text-pool" },
      { icon: <VideoCameraOutlined aria-hidden />, label: "视频池", path: "/studio/share-video" },
      { icon: <PictureOutlined aria-hidden />, label: "图片池", path: "/studio/image-pool" },
      {
        icon: <FileProtectOutlined aria-hidden />,
        label: "备份池",
        path: "/studio/backup-resources",
      },
      { icon: <DatabaseOutlined aria-hidden />, label: "注册池", path: "/studio/registration" },
    ],
  },
  {
    icon: <FileTextOutlined aria-hidden />,
    label: "工作日志",
    path: "/work-logs",
  },
  {
    icon: <SafetyCertificateOutlined aria-hidden />,
    label: "成员与权限",
    path: "/members",
  },
]

const canSeeItem = (item: NavigationItem, user: SessionUser): boolean => {
  if (item.children !== undefined) return true
  return canViewPage(user.scope.role, item.path, user.scope.pages)
}

const visibleItems = (
  items: readonly NavigationItem[],
  user: SessionUser,
): readonly NavigationItem[] =>
  items.flatMap((item) => {
    if (!canSeeItem(item, user)) return []
    if (item.children === undefined) return [item]
    const children = visibleItems(item.children, user)
    return children.length === 0 ? [] : [{ ...item, children }]
  })

const flattenItems = (items: readonly NavigationItem[]): readonly NavigationItem[] =>
  items.flatMap((item) =>
    item.children === undefined ? [item] : [item, ...flattenItems(item.children)],
  )

const titleForPath = (path: string, user: SessionUser): string => {
  const matches = flattenItems(visibleItems(navigation, user)).filter(
    (candidate) => path === candidate.path || path.startsWith(`${candidate.path}/`),
  )
  const item = matches.reduce<NavigationItem | undefined>(
    (longest, candidate) =>
      longest === undefined || candidate.path.length > longest.path.length ? candidate : longest,
    undefined,
  )
  if (item?.label === "运营中心") return "运营概览"
  if (item?.label === "工程中心") return "私有云储存"
  if (item?.label === "营销中心") return "营销面板"
  if (item?.label === "积分商场") return "积分记录"
  if (item?.label === "制作中心") return "视频制作"
  if (item?.label === "资源中心") return "文本池"
  return item?.label ?? "运营概览"
}

const defaultOpenMenuPaths = ["/operations", "/engineering", "/resources"]

const parentMenuPath = (path: string): string | undefined => {
  for (const item of navigation) {
    if (item.children?.some((child) => path === child.path || path.startsWith(`${child.path}/`))) {
      return item.path
    }
  }
  return undefined
}

const openMenuKeysForPath = (path: string): string[] => {
  const current = parentMenuPath(path)
  if (current === undefined || defaultOpenMenuPaths.includes(current))
    return [...defaultOpenMenuPaths]
  return [...defaultOpenMenuPaths, current]
}

type ProLayoutRoute = NonNullable<ComponentProps<typeof ProLayout>["route"]>
type RenderableMenuDataItem = MenuDataItem & { readonly isUrl?: unknown }

const toLayoutRoute = (item: NavigationItem): ProLayoutRoute => {
  if (item.children === undefined) {
    return { icon: item.icon, name: item.label, path: item.path }
  }
  return {
    icon: item.icon,
    name: item.label,
    path: item.path,
    routes: item.children.map(toLayoutRoute),
  }
}

const layoutRoute = (user: SessionUser): ProLayoutRoute => ({
  path: "/",
  routes: visibleItems(navigation, user).map(toLayoutRoute),
})

const nestedMenuItems = (item: MenuDataItem): readonly MenuDataItem[] => {
  const nested = item.routes ?? item.children
  return Array.isArray(nested) ? nested : []
}

const menuItemRender = (item: MenuDataItem, defaultDom: ReactNode): ReactNode => {
  const renderableItem: RenderableMenuDataItem = item
  if (
    nestedMenuItems(item).length > 0 ||
    item.path === undefined ||
    renderableItem.isUrl === true
  ) {
    return defaultDom
  }
  return <Link to={item.path}>{defaultDom}</Link>
}

type AdminShellProps = { readonly user: SessionUser }

export const AdminShell = ({ user }: AdminShellProps): ReactNode => {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    applyLayoutSettings,
    layoutSettings,
    preferences,
    setPreferences,
    setSettingsOpen,
    settingsOpen,
  } = useUiPreferences()
  const pageTitle = titleForPath(location.pathname, user)
  const [openMenuKeys, setOpenMenuKeys] = useState(() => openMenuKeysForPath(location.pathname))

  useEffect(() => {
    const current = parentMenuPath(location.pathname)
    if (current === undefined) return
    setOpenMenuKeys((keys) => (keys.includes(current) ? keys : [...keys, current]))
  }, [location.pathname])

  return (
    <div className={preferences.layout === "mix" ? "admin-shell admin-shell-mix" : "admin-shell"}>
      <ProLayout
        ErrorBoundary={false}
        avatarProps={{
          render: (_, defaultDom) => <AccountMenu user={user}>{defaultDom}</AccountMenu>,
          size: "small",
          title: memberDisplayName(user),
        }}
        bgLayoutImgList={[...layoutBackgroundImages]}
        breakpoint={false}
        collapsed={preferences.siderCollapsed}
        colorPrimary={preferences.colorPrimary}
        contentWidth={preferences.contentWidth}
        disableMobile
        fixSiderbar={preferences.fixSiderbar}
        fixedHeader={preferences.fixedHeader}
        footerRender={() => <AppFooter />}
        headerTitleRender={(logo) => (
          <Link aria-label={APP_OVERVIEW_LABEL} to="/overview">
            {logo}
          </Link>
        )}
        layout={preferences.layout}
        locale="zh-CN"
        location={{ pathname: location.pathname }}
        logo={<img alt="logo" src={brandLogo} />}
        menu={{
          autoClose: false,
          defaultOpenAll: false,
          locale: false,
        }}
        menuProps={{
          onOpenChange: (keys) => {
            setOpenMenuKeys(keys.map(String))
          },
          ...(preferences.siderCollapsed ? {} : { openKeys: openMenuKeys }),
        }}
        menuHeaderRender={
          preferences.layout === "mix"
            ? false
            : (logo) => (
                <Link aria-label={APP_OVERVIEW_LABEL} to="/overview">
                  {logo}
                </Link>
              )
        }
        menuItemRender={menuItemRender}
        navTheme={preferences.navTheme}
        onCollapse={(collapsed) => setPreferences({ siderCollapsed: collapsed })}
        onMenuHeaderClick={() => {
          void navigate("/overview")
        }}
        route={layoutRoute(user)}
        siderMenuType={preferences.siderMenuType}
        siderWidth={220}
        splitMenus={preferences.splitMenus}
        title={false}
      >
        <div className="page-heading">
          <p className="breadcrumb">
            {APP_NAME} <span>/</span> {pageTitle}
          </p>
        </div>
        <Outlet />
      </ProLayout>
      <SettingDrawer
        collapse={settingsOpen}
        disableUrlParams
        enableDarkTheme
        hideCopyButton
        hideHintAlert
        onCollapseChange={setSettingsOpen}
        onSettingChange={(settings) => {
          applyLayoutSettings({ ...layoutSettings, ...settings })
        }}
        settings={layoutSettings}
      />
    </div>
  )
}
