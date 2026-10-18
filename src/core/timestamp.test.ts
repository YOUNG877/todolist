/**
 * timestamp.test.ts —— 时间戳的本地化显示
 *
 * 背景：completedAt / createdAt 都用 `toISOString()` 存 UTC。
 * 早期用 `iso.slice(11, 16)` 直接截字符串，在 UTC+8 会把 18:30 显示成 10:30，
 * 导出的述职报告里也是错的。这里盯住「必须按本地时区换算」。
 */

import { describe, expect, it } from 'vitest'
import { formatLocalTime, formatNoteStamp, localDateOfIso } from './date'

const pad = (n: number): string => String(n).padStart(2, '0')

describe('formatLocalTime', () => {
  it('把本地时刻转成 ISO 再格式化，必须还原成原来的时刻', () => {
    const iso = new Date(2026, 2, 1, 10, 30).toISOString()
    expect(formatLocalTime(iso)).toBe('10:30')
  })

  it('与 Date 的本地时分一致（能抓住 slice(11, 16) 这类错误）', () => {
    const iso = '2026-03-01T10:30:00.000Z'
    const d = new Date(iso)
    expect(formatLocalTime(iso)).toBe(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
  })

  it('补零到两位', () => {
    const iso = new Date(2026, 2, 1, 9, 5).toISOString()
    expect(formatLocalTime(iso)).toBe('09:05')
  })

  it('非法输入返回空串，不抛错', () => {
    expect(formatLocalTime('not-a-date')).toBe('')
    expect(formatLocalTime('')).toBe('')
  })
})

describe('localDateOfIso', () => {
  it('取的是本地日期，不是 UTC 日期', () => {
    const iso = new Date(2026, 2, 1, 23, 30).toISOString()
    expect(localDateOfIso(iso)).toBe('2026-03-01')
  })

  it('非法输入返回空串', () => {
    expect(localDateOfIso('nope')).toBe('')
  })
})

describe('formatNoteStamp', () => {
  it('当天的备注只显示时分', () => {
    const iso = new Date(2026, 2, 1, 9, 5).toISOString()
    expect(formatNoteStamp(iso, '2026-03-01')).toBe('09:05')
  })

  it('跨天的备注补上 MM-DD', () => {
    const iso = new Date(2026, 2, 1, 9, 5).toISOString()
    expect(formatNoteStamp(iso, '2026-03-05')).toBe('03-01 09:05')
  })
})
