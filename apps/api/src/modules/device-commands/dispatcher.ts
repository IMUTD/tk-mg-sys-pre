import { type DeviceAdapter, DeviceAdapterError, type DeviceCommand } from "@tk-mg/device-adapter"

import type { DeviceCommandRepository } from "./repository"

const safeReceipt = (receipt: Awaited<ReturnType<DeviceAdapter["submit"]>>) => ({
  status: receipt.status,
  providerReceiptId:
    receipt.providerReceiptId !== undefined &&
    /^[A-Za-z0-9._:-]{1,256}$/.test(receipt.providerReceiptId)
      ? receipt.providerReceiptId
      : null,
  retryable: receipt.retryable,
})

export const createDeviceCommandDispatcher =
  (repository: DeviceCommandRepository, adapter: DeviceAdapter) =>
  async (command: DeviceCommand): Promise<void> => {
    const claimed = await repository.claim(command.commandId)
    if (claimed === null) return
    const { claimToken } = claimed
    let receipt = null
    try {
      receipt = await adapter.submit(command)
      const normalizedReceipt = safeReceipt(receipt)
      const recorded = await repository.recordReceipt(
        command.commandId,
        claimToken,
        normalizedReceipt,
      )
      if (recorded === null) {
        await adapter.cancel(command.commandId)
        return
      }
      if (recorded.cancelRequestedAt !== null) {
        await adapter.cancel(command.commandId)
        await repository.finalizeCancel(command.commandId, claimToken)
        return
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const result = await adapter.getResult(command.commandId)
        switch (result.status) {
          case "queued":
          case "running":
            break
          case "succeeded":
            await repository.finish(command.commandId, claimToken, {
              status: "succeeded",
              providerReceipt: normalizedReceipt,
              errorCode: null,
              resultReference:
                result.outcome.kind === "artifact" ? result.outcome.reference.artifactId : null,
              result:
                result.outcome.kind === "artifact"
                  ? { kind: "artifact", reference: result.outcome.reference.artifactId }
                  : result.outcome,
            })
            return
          case "failed":
          case "timed_out":
            await repository.finish(command.commandId, claimToken, {
              status: result.status,
              providerReceipt: normalizedReceipt,
              errorCode: result.error.code,
              resultReference: null,
              result: null,
            })
            return
          case "cancelled":
            await repository.finish(command.commandId, claimToken, {
              status: "cancelled",
              providerReceipt: normalizedReceipt,
              errorCode: null,
              resultReference: null,
              result: null,
            })
            return
          default: {
            const exhaustive: never = result
            return exhaustive
          }
        }
      }
      await repository.finish(command.commandId, claimToken, {
        status: "timed_out",
        providerReceipt: receipt === null ? null : safeReceipt(receipt),
        errorCode: "timeout",
        resultReference: null,
        result: null,
      })
    } catch (error) {
      await repository.finish(command.commandId, claimToken, {
        status: "failed",
        providerReceipt: receipt === null ? null : safeReceipt(receipt),
        errorCode: error instanceof DeviceAdapterError ? error.code : "failed",
        resultReference: null,
        result: null,
      })
    }
  }
