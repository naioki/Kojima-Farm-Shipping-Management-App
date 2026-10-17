/**
 * 品目を category（品目グループ）でまとめる（表示グルーピング専用・Select/native both）。
 * 出現順を保ち、未分類（category 空）は末尾の「その他」に集約する。
 * データ構造・パース・請求には一切関与しない（トマト/トマトバラは独立品目のまま）。
 */
export const UNGROUPED_LABEL = 'その他'

export interface HasCategory {
  category?: string | null
}

export function groupByCategory<T extends HasCategory>(items: T[]): { group: string; items: T[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, T[]>()
  for (const it of items) {
    const g = it.category?.trim() || UNGROUPED_LABEL
    if (!byGroup.has(g)) {
      byGroup.set(g, [])
      if (g !== UNGROUPED_LABEL) order.push(g)
    }
    byGroup.get(g)!.push(it)
  }
  if (byGroup.has(UNGROUPED_LABEL)) order.push(UNGROUPED_LABEL)
  return order.map((g) => ({ group: g, items: byGroup.get(g)! }))
}
