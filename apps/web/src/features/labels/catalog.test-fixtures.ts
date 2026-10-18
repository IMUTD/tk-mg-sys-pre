import { vi } from "vitest"
import * as labelsApi from "./api"

export const mockLabelCatalog = (): void => {
  const labels: labelsApi.BusinessLabel[] = []
  vi.spyOn(labelsApi, "createLabelsApi").mockReturnValue({
    list: async (page, scope = labelsApi.labelScopeForPage(page)) => ({
      administratorId: null,
      canDelete: false,
      scope,
      groups: labels.filter((label) => label.scope === scope),
      remarks: [],
    }),
    create: async (page, _kind, name, scope = labelsApi.labelScopeForPage(page)) => {
      const label = {
        id: `11111111-1111-4111-8111-${String(labels.length + 1).padStart(12, "0")}`,
        administratorId: "11111111-1111-4111-8111-111111111111",
        scope,
        name,
      }
      labels.push(label)
      return label
    },
    remove: async () => undefined,
  })
}
