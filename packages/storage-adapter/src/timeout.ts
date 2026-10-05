import { StorageTimeoutError } from "./errors"

export const withStorageTimeout = async <Value>(
  operation: Promise<Value>,
  timeoutMs: number,
): Promise<Value> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new StorageTimeoutError(timeoutMs)), timeoutMs)
  })
  try {
    return await Promise.race([operation, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
