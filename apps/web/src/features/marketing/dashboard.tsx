import { Card, Col, Row, Segmented, Space, Statistic, Tag } from "antd"
import { type ReactNode, useMemo, useState } from "react"

import {
  createSeedAccounts,
  createSeedSales,
  dashboardKpis,
  money,
  TREND_RANGE_OPTIONS,
  type TrendRange,
  trendSeries,
} from "./catalog"
import "./marketing.css"
import { TrendChart } from "./trend-chart"

export const MarketingDashboard = (): ReactNode => {
  const [range, setRange] = useState<TrendRange>("week")
  const kpis = useMemo(() => dashboardKpis(createSeedAccounts(), createSeedSales()), [])
  const points = trendSeries(range)

  return (
    <section className="module-page marketing-page">
      <Row gutter={[16, 16]}>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="账号销售额" value={money(kpis.accountSales)} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="节点销售额" value={money(kpis.nodeSales)} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="系统销售额" value={money(kpis.systemSales)} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="剩余开窗账号数" value={kpis.windowedLeft} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="剩余满月白数" value={kpis.monthWhiteLeft} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="剩余白号数" value={kpis.whiteLeft} />
          </Card>
        </Col>
        <Col lg={6} sm={12} xs={24}>
          <Card>
            <Statistic title="剩余千粉号数" value={kpis.kiloLeft} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="成交笔数" value={kpis.deals} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="净销售额" value={money(kpis.net)} />
          </Card>
        </Col>
        <Col lg={8} sm={12} xs={24}>
          <Card>
            <Statistic title="客单价" value={money(kpis.ticket)} />
          </Card>
        </Col>
      </Row>
      <Card
        extra={
          <Segmented
            onChange={(value) => setRange(value as TrendRange)}
            options={[...TREND_RANGE_OPTIONS]}
            value={range}
          />
        }
        title="销售趋势"
      >
        <Space className="marketing-legend">
          <span>
            <i className="legend-dot" style={{ background: "#1677ff" }} />
            账号
          </span>
          <span>
            <i className="legend-dot" style={{ background: "#52c41a" }} />
            节点
          </span>
          <span>
            <i className="legend-dot" style={{ background: "#fa8c16" }} />
            系统
          </span>
        </Space>
        <TrendChart points={points} />
        <div>
          {kpis.whiteLeft <= 2 ? <Tag color="warning">白号库存偏低</Tag> : null}
          {kpis.kiloLeft <= 2 ? <Tag color="warning">千粉号库存偏低</Tag> : null}
          {kpis.windowedLeft <= 2 ? <Tag color="warning">开窗账号库存偏低</Tag> : null}
        </div>
      </Card>
    </section>
  )
}
