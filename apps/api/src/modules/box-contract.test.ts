import { expect, it } from "bun:test"

import { EnqueueSchema, StatusSchema } from "./box-contract"

const deviceId = "00000000-0000-4000-8000-000000000001"
const stepId = "00000000-0000-4000-8000-000000000002"

it("keeps an enqueued parameter within 20000 characters", () => {
  const text = "a".repeat(20000)
  expect(
    EnqueueSchema.safeParse({
      deviceId,
      steps: [{ skill: "Tap", input: { text } }],
    }).success,
  ).toBe(true)
  expect(
    EnqueueSchema.safeParse({
      deviceId,
      steps: [{ skill: "Tap", input: { text: `${text}b` } }],
    }).success,
  ).toBe(false)
})

it("accepts a node dump up to 2MB in a status report", () => {
  const xml = "<node>".padEnd(2 * 1024 * 1024, "x")
  expect(
    StatusSchema.safeParse({
      status: "succeeded",
      checkpoint: { step_id: stepId, outputs: { chars: "12", xml } },
    }).success,
  ).toBe(true)
  expect(
    StatusSchema.safeParse({
      status: "succeeded",
      checkpoint: { step_id: stepId, outputs: { xml: `${xml}y` } },
    }).success,
  ).toBe(false)
})
