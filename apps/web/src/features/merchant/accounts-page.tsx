import type { ReactNode } from "react"

import { createMerchantApi, type MerchantApi } from "./api"
import { TransferPage } from "./transfer-page"

const defaultApi = createMerchantApi()

export const AccountTransferPage = ({
  api = defaultApi,
}: {
  readonly api?: MerchantApi
}): ReactNode => <TransferPage api={api} kind="account" noun="账号" />
