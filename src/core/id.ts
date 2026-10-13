/** id.ts —— 任务 id 生成，优先用 crypto.randomUUID，降级到时间戳 + 随机串 */

export function createId(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}
