import type { ReactNode } from "react"

import type { TrendPoint } from "./catalog"

type TrendChartProps = {
  readonly points: readonly TrendPoint[]
}

const WIDTH = 720
const HEIGHT = 240
const PAD = 28

const polyline = (values: readonly number[], max: number): string =>
  values
    .map((value, index) => {
      const x = PAD + (index * (WIDTH - PAD * 2)) / Math.max(1, values.length - 1)
      const y = HEIGHT - PAD - (value / max) * (HEIGHT - PAD * 2)
      return `${x},${y}`
    })
    .join(" ")

export const TrendChart = ({ points }: TrendChartProps): ReactNode => {
  const max = Math.max(1, ...points.flatMap((item) => [item.account, item.node, item.system]))
  const account = polyline(
    points.map((item) => item.account),
    max,
  )
  const node = polyline(
    points.map((item) => item.node),
    max,
  )
  const system = polyline(
    points.map((item) => item.system),
    max,
  )

  return (
    <svg aria-label="销售折线图" className="trend-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      <polyline fill="none" points={account} stroke="#1677ff" strokeWidth="2" />
      <polyline fill="none" points={node} stroke="#52c41a" strokeWidth="2" />
      <polyline fill="none" points={system} stroke="#fa8c16" strokeWidth="2" />
      {points.map((item, index) => (
        <text
          fill="#909399"
          fontSize="11"
          key={item.label}
          textAnchor="middle"
          x={PAD + (index * (WIDTH - PAD * 2)) / Math.max(1, points.length - 1)}
          y={HEIGHT - 8}
        >
          {item.label}
        </text>
      ))}
    </svg>
  )
}
