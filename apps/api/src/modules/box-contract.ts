import { z } from "zod"

const Index = z.number().int().min(1).max(5)
const Input = z.record(z.string(), z.string().max(20000))
export const EnqueueSchema = z.object({
  deviceId: z.string().uuid(),
  indexNum: z.number().int().min(0).max(5).default(0),
  steps: z
    .array(
      z.object({
        skill: z.string().min(1).max(100),
        input: Input.default({}),
        guards: z
          .array(z.enum(["ad", "transcode"]))
          .max(2)
          .optional(),
        afterMs: z
          .union([z.number().int().min(0).max(60000), z.string().regex(/^\d*$/)])
          .optional(),
      }),
    )
    .min(1)
    .max(100),
})
export const RegisterSchema = z.object({
  boxId: z.string().min(1).max(200),
  version: z.string().max(200).optional(),
  indexNums: z.array(Index).max(5).optional(),
})
export const HeartbeatSchema = z.object({
  boxId: z.string().min(1).max(200),
  box: z
    .object({
      disk: z.string().max(200).optional(),
      diskPct: z.number().min(0).max(100).optional(),
      firmware: z.string().max(200).optional(),
      memory: z.string().max(200).optional(),
      model: z.string().max(200).optional(),
      version: z.string().max(200).optional(),
    })
    .optional(),
  slotsFresh: z.boolean().optional(),
  slots: z
    .array(
      z
        .object({
          indexNum: Index,
          name: z.string().max(200).optional(),
          id: z.string().max(200).optional(),
          status: z.string().max(40).optional(),
          apiPort: z.number().int().min(0).max(65535).optional(),
          rpaPort: z.number().int().min(0).max(65535).optional(),
          width: z.string().max(20).optional(),
          height: z.string().max(20).optional(),
          stale: z.boolean().optional(),
        })
        .passthrough(),
    )
    .max(5)
    .optional(),
})
export const StatusSchema = z.object({
  status: z.enum([
    "claimed",
    "preparing",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "waiting_human",
    "waiting_resource",
    "blocked",
  ]),
  phase: z.string().max(100).optional(),
  error_code: z.string().max(200).optional(),
  checkpoint: z
    .object({
      step_id: z.union([z.string().uuid(), z.literal("")]).optional(),
      cursor: z.number().int().min(0).optional(),
      outputs: Input.optional(),
    })
    .optional(),
})
export const GuardSchema = z.object({
  stepId: z.string().uuid(),
  output: z
    .string()
    .max(2 * 1024 * 1024)
    .optional(),
})
export const EventsSchema = z
  .array(
    z
      .object({
        box_id: z.string().min(1).max(200),
        event: z.string().max(200),
        msg: z.string().max(20000).optional(),
        task_id: z.union([z.string().uuid(), z.literal("")]).optional(),
      })
      .passthrough(),
  )
  .max(200)
export const LabelsSchema = z
  .object({
    deviceIds: z.array(z.string().uuid()).min(1).max(500),
    remarkId: z.string().uuid().nullable().optional(),
    remarkIds: z.array(z.string().uuid()).max(40).optional(),
    remarkMode: z.enum(["add", "replace"]).optional(),
    boxGroupId: z.string().uuid().nullable().optional(),
    sequenceNo: z.number().int().min(1).max(999).nullable().optional(),
  })
  .refine((value) => new Set(value.deviceIds).size === value.deviceIds.length)
  .refine(
    (value) =>
      value.remarkIds === undefined || new Set(value.remarkIds).size === value.remarkIds.length,
  )
export const WatchSchema = z.object({ indexNums: z.array(Index).max(5) })

export const fingerprint = (value: unknown): string => {
  const canonical = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(canonical)
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => [key, canonical(child)]),
      )
    }
    return item
  }
  return JSON.stringify(canonical(value))
}
