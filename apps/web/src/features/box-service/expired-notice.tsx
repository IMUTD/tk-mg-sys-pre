import { PageKey } from "../../lib/pages"

// Shown when a task is refused because the box has no paid time left.
export const ServiceExpiredNotice = () => (
  <span>
    盒子已到期，请先到<a href={PageKey.BoxService}>「盒子使用时长」</a>续费
  </span>
)
