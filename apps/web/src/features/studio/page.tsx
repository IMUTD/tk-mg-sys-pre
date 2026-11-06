import { Typography } from "antd"
import type { ReactNode } from "react"

import "./studio.css"

type StudioKind = "video" | "image" | "text" | "image-pool"

type StudioPageProps = {
  readonly kind: StudioKind
}

const COPY: Record<StudioKind, { hint: string; title: string }> = {
  "image-pool": {
    hint: "后续在此接入封面、头像与素材图库存。",
    title: "图片池白板",
  },
  image: {
    hint: "后续在此接入封面、头像与素材出图流水线。",
    title: "图片制作白板",
  },
  text: {
    hint: "后续在此接入文案、脚本与多语言文案生成。",
    title: "文本制作白板",
  },
  video: {
    hint: "后续在此接入剪辑、口播与批量成片流水线。",
    title: "视频制作白板",
  },
}

export const StudioPage = ({ kind }: StudioPageProps): ReactNode => {
  const copy = COPY[kind]
  return (
    <section className="module-page studio-page">
      <div className="studio-board">
        <Typography.Title level={4}>{copy.title}</Typography.Title>
        <Typography.Paragraph className="muted">{copy.hint}</Typography.Paragraph>
      </div>
    </section>
  )
}
