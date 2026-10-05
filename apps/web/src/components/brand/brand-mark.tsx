import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { APP_NAME, APP_OVERVIEW_LABEL } from "../../app/product"
import brandLogo from "../../assets/brand-logo.png"

type BrandMarkProps = {
  readonly collapsed?: boolean
}

export const BrandMark = ({ collapsed = false }: BrandMarkProps): ReactNode => (
  <Link
    aria-label={APP_OVERVIEW_LABEL}
    className={collapsed ? "brand brand-collapsed" : "brand"}
    to="/overview"
  >
    <img alt={APP_NAME} className="brand-logo" height={32} src={brandLogo} />
  </Link>
)
