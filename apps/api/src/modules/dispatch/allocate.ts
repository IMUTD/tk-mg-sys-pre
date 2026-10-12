export type BalanceItem = { readonly id: string }

export const pickBalanced = <T extends BalanceItem>(
  candidates: readonly T[],
  counts: ReadonlyMap<string, number>,
): T | null => {
  const ranked = [...candidates].sort((left, right) => {
    const used = (counts.get(left.id) ?? 0) - (counts.get(right.id) ?? 0)
    if (used !== 0) return used
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
  return ranked[0] ?? null
}

export const takeBalanced = <T extends BalanceItem>(
  candidates: readonly T[],
  counts: Map<string, number>,
): T | null => {
  const picked = pickBalanced(candidates, counts)
  if (picked === null) return null
  counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1)
  return picked
}
