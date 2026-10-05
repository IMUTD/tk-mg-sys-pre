export const StorageEntryKind = {
  Directory: "directory",
  File: "file",
} as const

export type StorageEntryKind = (typeof StorageEntryKind)[keyof typeof StorageEntryKind]

export type StorageEntry = {
  readonly kind: StorageEntryKind
  readonly path: string
  readonly sizeBytes: number
  readonly updatedAt: Date
}

export type StorageCapacity = {
  readonly availableBytes: number
  readonly totalBytes: number
}

export type StorageHealth =
  | { readonly kind: "available"; readonly capacity: StorageCapacity }
  | { readonly kind: "unconfigured" }
  | { readonly kind: "unavailable"; readonly reason: string }

export type StoragePutInput = {
  readonly contents: Uint8Array
  readonly path: string
}

export type StorageMoveInput = {
  readonly destination: string
  readonly source: string
}

export interface StorageAdapter {
  capacity(): Promise<StorageCapacity>
  get(path: string): Promise<Uint8Array | null>
  health(): Promise<StorageHealth>
  list(path: string): Promise<readonly StorageEntry[]>
  mkdir(path: string): Promise<void>
  move(input: StorageMoveInput): Promise<void>
  put(input: StoragePutInput): Promise<void>
  remove(path: string): Promise<void>
  stat(path: string): Promise<StorageEntry | null>
}
