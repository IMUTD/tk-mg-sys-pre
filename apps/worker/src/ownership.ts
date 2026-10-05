export class OwnershipLostError extends Error {
  override readonly name: string = "OwnershipLostError"
  constructor(cause?: unknown) {
    super("Worker task ownership lost", { cause })
  }
}

export class HeartbeatFailureError extends OwnershipLostError {
  override readonly name = "HeartbeatFailureError"
}
