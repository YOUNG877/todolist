/**
 * order.ts —— 排序权重（需求文档 6.4）
 *
 * order 是浮点数，插入时取相邻中值；当相邻差值过小时触发一次全量重排。
 */

/** 相邻差值小于该阈值就重排，避免浮点精度耗尽 */
export const ORDER_EPSILON = 1e-6

/** 取相邻中值插入。prev/next 为 null 表示插入到首/尾。 */
export function orderBetween(prev: number | null, next: number | null): number {
  if (prev === null && next === null) return 1
  if (prev === null) return (next as number) - 1
  if (next === null) return prev + 1
  return (prev + next) / 2
}

/** 是否需要全量重排 */
export function needsRebalance(orders: number[]): boolean {
  const sorted = [...orders].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] - sorted[i - 1] < ORDER_EPSILON) return true
  }
  return false
}

/** 全量重排：按当前视觉顺序返回 id → 新 order 的映射 */
export function rebalance<T extends { id: string }>(orderedItems: T[]): Map<string, number> {
  const map = new Map<string, number>()
  orderedItems.forEach((item, index) => map.set(item.id, index + 1))
  return map
}

/** 把 item 移动到目标下标后的新顺序（返回带新 order 的 id 列表顺序） */
export function moveToIndex<T extends { id: string; order: number }>(
  items: T[],
  id: string,
  toIndex: number,
): { ordered: T[]; changed: boolean } {
  const sorted = [...items].sort((a, b) => a.order - b.order)
  const currentIndex = sorted.findIndex((t) => t.id === id)
  if (currentIndex < 0) return { ordered: sorted, changed: false }
  const clamped = Math.max(0, Math.min(toIndex, sorted.length - 1))
  if (clamped === currentIndex) return { ordered: sorted, changed: false }

  const moving = sorted[currentIndex]
  const rest = sorted.filter((t) => t.id !== id)
  const prev = clamped > 0 ? rest[clamped - 1].order : null
  const next = clamped < rest.length ? rest[clamped].order : null
  const candidate = orderBetween(prev, next)

  const orders = [...rest.map((t) => t.order), candidate]
  if (needsRebalance(orders)) {
    const visual = [...rest.slice(0, clamped), moving, ...rest.slice(clamped)]
    const map = rebalance(visual.map((t) => ({ id: t.id })))
    moving.order = map.get(moving.id) as number
    for (const t of rest) t.order = map.get(t.id) as number
  } else {
    moving.order = candidate
  }

  const result = [...rest.slice(0, clamped), moving, ...rest.slice(clamped)]
  return { ordered: result, changed: true }
}
