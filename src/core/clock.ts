/**
 * clock.ts —— 全局唯一时间源（需求文档 6.6）
 *
 * 规则：任何组件、任何 core 模块都**不得直接调用 new Date()**，
 * 一律使用 clock.now()。这样既能让 settle() 可用注入时钟做单元测试，
 * 也能让开发调试面板实现「时间旅行（+1 天 / +7 天）」来验证顺延逻辑。
 */

const DAY_MS = 24 * 60 * 60 * 1000

let offsetMs = 0

export const clock = {
  /** 业务时间。测试与调试时可被 travel() 偏移。 */
  now(): Date {
    return new Date(Date.now() + offsetMs)
  },

  /** 真实系统时间（用于展示「已偏移多少」等元信息）。 */
  realNow(): Date {
    return new Date()
  },

  /** 当前偏移的天数，支持小数。 */
  get offsetDays(): number {
    return offsetMs / DAY_MS
  },

  get isTraveling(): boolean {
    return offsetMs !== 0
  },

  /** 时间旅行：前后偏移整数天（调试面板 / 单测用）。 */
  travelDays(days: number): void {
    if (!Number.isFinite(days)) throw new Error('clock.travelDays 需要一个有限数字')
    offsetMs += days * DAY_MS
  },

  /** 直接把业务时间设到某个具体时刻（单测用）。 */
  travelTo(target: Date, base: Date = clock.realNow()): void {
    offsetMs = target.getTime() - base.getTime()
  },

  /** 复位到真实时间。 */
  reset(): void {
    offsetMs = 0
  },
}

/** 仅供单元测试使用：在回调内临时偏移时间，结束后自动复位。 */
export function withClockAt<T>(target: Date, fn: () => T): T {
  const prev = offsetMs
  clock.travelTo(target)
  try {
    return fn()
  } finally {
    offsetMs = prev
  }
}
