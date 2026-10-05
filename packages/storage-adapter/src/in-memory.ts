import { StorageUnavailableError } from "./errors"
import {
  type StorageAdapter,
  type StorageCapacity,
  type StorageEntry,
  StorageEntryKind,
  type StorageHealth,
} from "./types"

type Node = {
  readonly contents: Uint8Array | null
  readonly kind: StorageEntry["kind"]
  readonly updatedAt: Date
}

const rootPath = "/"

const parentPath = (path: string): string => {
  const separator = path.lastIndexOf("/")
  return separator <= 0 ? rootPath : path.slice(0, separator)
}

const isDirectChild = (candidate: string, parent: string): boolean =>
  candidate !== parent && parentPath(candidate) === parent

const isPathOrDescendant = (candidate: string, path: string): boolean =>
  candidate === path || candidate.startsWith(`${path}/`)

const movedPath = (source: string, destination: string, candidate: string): string =>
  `${destination}${candidate.slice(source.length)}`

const toEntry = (path: string, node: Node): StorageEntry => ({
  kind: node.kind,
  path,
  sizeBytes: node.contents?.byteLength ?? 0,
  updatedAt: node.updatedAt,
})

const cloneBytes = (value: Uint8Array): Uint8Array => new Uint8Array(value)

export const createInMemoryStorageAdapter = (
  capacity: StorageCapacity = {
    availableBytes: Number.MAX_SAFE_INTEGER,
    totalBytes: Number.MAX_SAFE_INTEGER,
  },
): StorageAdapter => {
  const nodes = new Map<string, Node>([
    [rootPath, { contents: null, kind: StorageEntryKind.Directory, updatedAt: new Date() }],
  ])

  const requireDirectory = (path: string): void => {
    const node = nodes.get(path)
    if (node === undefined || node.kind !== StorageEntryKind.Directory) {
      throw new StorageUnavailableError(`Directory is unavailable: ${path}`)
    }
  }

  const requireParent = (path: string): void => requireDirectory(parentPath(path))

  return {
    capacity: async () => capacity,
    get: async (path) => {
      const node = nodes.get(path)
      return node?.contents === null || node?.contents === undefined
        ? null
        : cloneBytes(node.contents)
    },
    health: async (): Promise<StorageHealth> => ({ kind: "available", capacity }),
    list: async (path) => {
      requireDirectory(path)
      return [...nodes.entries()]
        .filter(([candidate]) => isDirectChild(candidate, path))
        .map(([candidate, node]) => toEntry(candidate, node))
        .sort((left, right) => left.path.localeCompare(right.path))
    },
    mkdir: async (path) => {
      requireParent(path)
      const existing = nodes.get(path)
      if (existing === undefined) {
        nodes.set(path, { contents: null, kind: StorageEntryKind.Directory, updatedAt: new Date() })
      } else if (existing.kind !== StorageEntryKind.Directory) {
        throw new StorageUnavailableError(`Path already contains a file: ${path}`)
      }
    },
    move: async ({ destination, source }) => {
      if (source === rootPath) {
        throw new StorageUnavailableError("Cannot move storage root")
      }
      const node = nodes.get(source)
      if (node === undefined) throw new StorageUnavailableError(`Source is unavailable: ${source}`)
      if (destination.startsWith(`${source}/`)) {
        throw new StorageUnavailableError("Cannot move a directory inside itself")
      }
      requireParent(destination)
      if (nodes.has(destination)) {
        throw new StorageUnavailableError(`Destination already exists: ${destination}`)
      }
      const affected = [...nodes.entries()].filter(([path]) => isPathOrDescendant(path, source))
      const moves = affected.map(([path, entry]) => ({
        entry: { ...entry, contents: entry.contents === null ? null : cloneBytes(entry.contents) },
        from: path,
        to: movedPath(source, destination, path),
      }))
      if (moves.some(({ to }) => nodes.has(to) && !isPathOrDescendant(to, source))) {
        throw new StorageUnavailableError(`Destination already exists: ${destination}`)
      }
      for (const move of moves) nodes.delete(move.from)
      for (const move of moves) nodes.set(move.to, move.entry)
    },
    put: async ({ contents, path }) => {
      if (path === rootPath) throw new StorageUnavailableError("Cannot overwrite storage root")
      requireParent(path)
      const existing = nodes.get(path)
      if (existing?.kind === StorageEntryKind.Directory) {
        throw new StorageUnavailableError(`Path already contains a directory: ${path}`)
      }
      nodes.set(path, {
        contents: cloneBytes(contents),
        kind: StorageEntryKind.File,
        updatedAt: new Date(),
      })
    },
    remove: async (path) => {
      if (path === rootPath) throw new StorageUnavailableError("Cannot remove storage root")
      if (!nodes.has(path)) throw new StorageUnavailableError(`Path is unavailable: ${path}`)
      for (const candidate of nodes.keys()) {
        if (isPathOrDescendant(candidate, path)) nodes.delete(candidate)
      }
    },
    stat: async (path) => {
      const node = nodes.get(path)
      return node === undefined ? null : toEntry(path, node)
    },
  }
}

export const createUnconfiguredStorageAdapter = (): StorageAdapter => {
  const unavailable = (): never => {
    throw new StorageUnavailableError("Storage connector is not configured")
  }
  return {
    capacity: async () => unavailable(),
    get: async () => unavailable(),
    health: async (): Promise<StorageHealth> => ({ kind: "unconfigured" }),
    list: async () => unavailable(),
    mkdir: async () => unavailable(),
    move: async () => unavailable(),
    put: async () => unavailable(),
    remove: async () => unavailable(),
    stat: async () => unavailable(),
  }
}
