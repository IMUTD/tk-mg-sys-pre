import ky from "ky"
import { apiSessionGeneration, observeApiAccess } from "./access-events"

const client = ky.create({
  retry: 0,
  timeout: 60_000,
  throwHttpErrors: false,
})

export const apiFetch = (
  input: Parameters<typeof ky>[0],
  options: Parameters<typeof ky>[1] = {},
) => {
  const generation = apiSessionGeneration()
  return client(typeof input === "string" ? new URL(input, window.location.href) : input, {
    ...options,
    hooks: {
      ...options.hooks,
      afterResponse: [
        ...(options.hooks?.afterResponse ?? []),
        async (request, _options, response) => {
          await observeApiAccess(request, response, generation)
        },
      ],
    },
  })
}
