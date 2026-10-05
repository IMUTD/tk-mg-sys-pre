import { createSeedAccounts } from "../accounts/myt-account"
import { createSeedDevices } from "../devices/myt-device"
import { createSeedMaterials } from "../resources/myt-material"
import { createSeedVideos } from "../video-pool/catalog"

const imagePoolCount = 0

export type OverviewCounts = {
  readonly accounts: number
  readonly devices: number
  readonly resources: number
}

export const overviewCounts = (): OverviewCounts => ({
  accounts: createSeedAccounts().length,
  devices: createSeedDevices().length,
  resources: createSeedVideos().length + createSeedMaterials().length + imagePoolCount,
})
