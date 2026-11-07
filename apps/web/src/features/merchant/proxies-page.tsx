import type { ReactNode } from "react"

import { createMerchantApi, type MerchantApi } from "./api"
import { TransferPage } from "./transfer-page"

const defaultApi = createMerchantApi()

export const ProxyTransferPage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => <TransferPage api={api} kind="proxy" noun="代理" />
