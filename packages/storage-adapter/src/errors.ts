export class StorageUnavailableError extends Error {
  public constructor(reason: string) {
    super(reason)
    this.name = "StorageUnavailableError"
  }
}

export class StorageTimeoutError extends Error {
  public constructor(timeoutMs: number) {
    super(`Storage operation timed out after ${timeoutMs}ms`)
    this.name = "StorageTimeoutError"
  }
}
