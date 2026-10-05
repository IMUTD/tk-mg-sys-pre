import { type DeviceCommand, DeviceCommandSchema } from "@tk-mg/device-adapter"

export type ExecutableCommand = Exclude<DeviceCommand, { readonly type: "input_text" }>

export class ForbiddenInputTextError extends Error {
  override readonly name = "ForbiddenInputTextError"

  constructor() {
    super("input_text is unavailable until encrypted replay storage exists")
  }
}

export const parseExecutableCommand = (input: unknown): ExecutableCommand => {
  const command = DeviceCommandSchema.parse(input)
  if (command.type === "input_text") throw new ForbiddenInputTextError()
  return command
}
