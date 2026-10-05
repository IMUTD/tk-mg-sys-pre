import { describe, expect, it } from "bun:test"

import {
  createInMemoryStorageAdapter,
  createUnconfiguredStorageAdapter,
  StorageEntryKind,
  StorageTimeoutError,
  StorageUnavailableError,
  withStorageTimeout,
} from "./index"

describe("in-memory storage adapter", () => {
  it("creates a directory", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()

    // When
    await adapter.mkdir("/workspace")

    // Then
    await expect(adapter.list("/")).resolves.toEqual([
      expect.objectContaining({
        kind: StorageEntryKind.Directory,
        path: "/workspace",
        sizeBytes: 0,
      }),
    ])
  })

  it("reports a file metadata record", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.put({ contents: new Uint8Array([1, 2]), path: "/workspace/item.bin" })

    // When
    const entry = await adapter.stat("/workspace/item.bin")

    // Then
    expect(entry).toEqual(
      expect.objectContaining({
        kind: StorageEntryKind.File,
        path: "/workspace/item.bin",
        sizeBytes: 2,
        updatedAt: expect.any(Date),
      }),
    )
  })

  it("stores a cloned file payload", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    const contents = new Uint8Array([1, 2])
    await adapter.mkdir("/workspace")

    // When
    await adapter.put({ contents, path: "/workspace/item.bin" })
    contents[0] = 9

    // Then
    await expect(adapter.get("/workspace/item.bin")).resolves.toEqual(new Uint8Array([1, 2]))
  })

  it("returns a cloned file payload", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.put({ contents: new Uint8Array([1, 2]), path: "/workspace/item.bin" })

    // When
    const contents = await adapter.get("/workspace/item.bin")
    if (contents !== null) contents[0] = 9

    // Then
    await expect(adapter.get("/workspace/item.bin")).resolves.toEqual(new Uint8Array([1, 2]))
  })

  it("rejects writing a file to the storage root", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()

    // When
    const operation = adapter.put({ contents: new Uint8Array([1]), path: "/" })

    // Then
    await expect(operation).rejects.toBeInstanceOf(StorageUnavailableError)
    await expect(adapter.stat("/")).resolves.toEqual(
      expect.objectContaining({ kind: StorageEntryKind.Directory, path: "/" }),
    )
  })

  it("rejects replacing a directory with a file while preserving descendants", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.mkdir("/workspace/archive")
    await adapter.put({ contents: new Uint8Array([1]), path: "/workspace/archive/item.bin" })

    // When
    const operation = adapter.put({ contents: new Uint8Array([2]), path: "/workspace/archive" })

    // Then
    await expect(operation).rejects.toBeInstanceOf(StorageUnavailableError)
    await expect(adapter.get("/workspace/archive/item.bin")).resolves.toEqual(new Uint8Array([1]))
  })

  it("lists only direct child metadata records", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.mkdir("/workspace/nested")
    await adapter.put({ contents: new Uint8Array([1]), path: "/workspace/item.bin" })
    await adapter.put({ contents: new Uint8Array([2]), path: "/workspace/nested/hidden.bin" })

    // When
    const entries = await adapter.list("/workspace")

    // Then
    expect(entries).toEqual([
      expect.objectContaining({ kind: StorageEntryKind.File, path: "/workspace/item.bin" }),
      expect.objectContaining({ kind: StorageEntryKind.Directory, path: "/workspace/nested" }),
    ])
  })

  it("moves a nested directory with every descendant", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.mkdir("/workspace/source")
    await adapter.mkdir("/workspace/source/nested")
    await adapter.put({ contents: new Uint8Array([1]), path: "/workspace/source/nested/item.bin" })

    // When
    await adapter.move({ destination: "/workspace/archive", source: "/workspace/source" })

    // Then
    await expect(adapter.stat("/workspace/source")).resolves.toBeNull()
    await expect(adapter.stat("/workspace/source/nested/item.bin")).resolves.toBeNull()
    await expect(adapter.get("/workspace/archive/nested/item.bin")).resolves.toEqual(
      new Uint8Array([1]),
    )
  })

  it("removes a nested directory with every descendant", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")
    await adapter.mkdir("/workspace/remove-me")
    await adapter.mkdir("/workspace/remove-me/nested")
    await adapter.put({
      contents: new Uint8Array([1]),
      path: "/workspace/remove-me/nested/item.bin",
    })

    // When
    await adapter.remove("/workspace/remove-me")

    // Then
    await expect(adapter.stat("/workspace/remove-me")).resolves.toBeNull()
    await expect(adapter.stat("/workspace/remove-me/nested/item.bin")).resolves.toBeNull()
  })

  it("rejects moving the storage root without changing root children", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter()
    await adapter.mkdir("/workspace")

    // When
    const operation = adapter.move({ destination: "/archive", source: "/" })

    // Then
    await expect(operation).rejects.toBeInstanceOf(StorageUnavailableError)
    await expect(adapter.stat("/")).resolves.toEqual(
      expect.objectContaining({ kind: StorageEntryKind.Directory, path: "/" }),
    )
    await expect(adapter.list("/")).resolves.toEqual([
      expect.objectContaining({ kind: StorageEntryKind.Directory, path: "/workspace" }),
    ])
  })

  it("returns configured capacity metadata", async () => {
    // Given
    const adapter = createInMemoryStorageAdapter({ availableBytes: 7, totalBytes: 11 })

    // When
    const capacity = await adapter.capacity()

    // Then
    expect(capacity).toEqual({ availableBytes: 7, totalBytes: 11 })
  })

  it("fails unconfigured operations with a typed unavailable error", async () => {
    // Given
    const adapter = createUnconfiguredStorageAdapter()

    // When
    const operation = adapter.list("/")

    // Then
    await expect(operation).rejects.toBeInstanceOf(StorageUnavailableError)
    await expect(adapter.health()).resolves.toEqual({ kind: "unconfigured" })
  })

  it("wraps a stalled connector operation in a typed timeout error", async () => {
    // Given
    const pending = new Promise<never>(() => undefined)

    // When
    const operation = withStorageTimeout(pending, 1)

    // Then
    await expect(operation).rejects.toBeInstanceOf(StorageTimeoutError)
  })
})
