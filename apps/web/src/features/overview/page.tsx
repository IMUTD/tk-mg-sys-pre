import {
  CloudServerOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FundOutlined,
  GiftOutlined,
  GlobalOutlined,
  InboxOutlined,
  NodeIndexOutlined,
  PlaySquareOutlined,
  RobotOutlined,
  TabletOutlined,
  TeamOutlined,
  UnorderedListOutlined,
  UserOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons"
import { Card, Col, Row, Statistic, Typography } from "antd"
import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { overviewCounts } from "./stats"

const shortcuts = [
  { icon: <TabletOutlined />, path: "/operations/devices", title: "盒子管理" },
  { icon: <InboxOutlined />, path: "/studio/text-pool", title: "文本池" },
  { icon: <UserOutlined />, path: "/operations/accounts", title: "账号管理" },
  { icon: <TeamOutlined />, path: "/operations/account-pool", title: "账号池" },
  { icon: <UnorderedListOutlined />, path: "/operations/tasks", title: "任务列表" },
  { icon: <GlobalOutlined />, path: "/operations/proxies", title: "代理管理" },
  { icon: <DatabaseOutlined />, path: "/studio/registration", title: "注册池" },
  { icon: <CloudServerOutlined />, path: "/engineering/storage", title: "私有云储存" },
  { icon: <RobotOutlined />, path: "/engineering/robots", title: "运营机器人" },
  { icon: <FundOutlined />, path: "/marketing/dashboard", title: "营销面板" },
  { icon: <DashboardOutlined />, path: "/marketing/accounts", title: "账号市场" },
  { icon: <GiftOutlined />, path: "/mall/records", title: "积分记录" },
  { icon: <PlaySquareOutlined />, path: "/studio/video-pool", title: "视频数据" },
  { icon: <VideoCameraOutlined />, path: "/studio/video", title: "视频制作" },
  { icon: <NodeIndexOutlined />, path: "/engineering/behaviors", title: "行为中心" },
] as const

export const OverviewPage = (): ReactNode => {
  const counts = overviewCounts()
  return (
    <section className="module-page overview-page">
      <div className="page-toolbar">
        <Typography.Paragraph type="secondary">
          从左侧菜单进入已获授权的盒子、资源与任务模块。
        </Typography.Paragraph>
      </div>
      <Row gutter={[16, 16]}>
        <Col md={8} sm={24} xs={24}>
          <Card>
            <Statistic title="设备数量" value={counts.devices} />
          </Card>
        </Col>
        <Col md={8} sm={24} xs={24}>
          <Card>
            <Statistic title="账号数量" value={counts.accounts} />
          </Card>
        </Col>
        <Col md={8} sm={24} xs={24}>
          <Card>
            <Statistic title="资源数量" value={counts.resources} />
          </Card>
        </Col>
      </Row>
      <Row gutter={[16, 16]}>
        {shortcuts.map((item) => (
          <Col key={item.path} md={8} sm={12} xs={24}>
            <Link to={item.path}>
              <Card className="overview-shortcut" hoverable>
                <SpaceIcon title={item.title} icon={item.icon} />
              </Card>
            </Link>
          </Col>
        ))}
      </Row>
    </section>
  )
}

const SpaceIcon = ({
  icon,
  title,
}: {
  readonly icon: ReactNode
  readonly title: string
}): ReactNode => (
  <div className="overview-shortcut-body">
    <span className="overview-shortcut-icon">{icon}</span>
    <Typography.Text strong>{title}</Typography.Text>
  </div>
)
