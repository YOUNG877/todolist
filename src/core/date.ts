/**
 * date.ts —— 日期工具（需求文档 6.1）
 *
 * ⚠️ 铁律：禁止使用 `toISOString().slice(0, 10)` 计算日期。
 * 那会按 UTC 取日期，东八区用户在早上 8 点前会拿到「昨天」。
 * 本文件所有日期字符串一律使用**本地时区**、`YYYY-MM-DD` 格式。
 */

import { addDays as dfAddDays, differenceInCalendarDays, format, parse } from 'date-fns'
import { zhCN } from 'date-fns/locale'

export const DATE_FORMAT = 'yyyy-MM-dd'

/** 默认日界：凌晨 04:00 换日（需求 2 / FR-18） */
export const DEFAULT_DAY_START_HOUR = 4

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Date → 本地 `YYYY-MM-DD` */
export function formatLocalDate(date: Date): string {
  return format(date, DATE_FORMAT)
}

/**
 * `YYYY-MM-DD` → 本地 Date。
 * 取当天 **12:00**，避开夏令时切换日 00:00 可能不存在的问题（边界条件 #15）。
 */
export function parseLocalDate(dateStr: string): Date {
  const d = parse(dateStr, DATE_FORMAT, new Date())
  d.setHours(12, 0, 0, 0)
  return d
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = parseLocalDate(value)
  return !Number.isNaN(d.getTime()) && formatLocalDate(d) === value
}

/**
 * 逻辑日期：日界之前的时刻算作「前一天」（需求 6.1）。
 * 例：日界 4 点，凌晨 02:00 → 前一天；上午 09:00 → 当天。
 */
export function logicalDateOf(now: Date, dayStartHour: number = DEFAULT_DAY_START_HOUR): string {
  const d = new Date(now.getTime())
  if (d.getHours() < dayStartHour) {
    d.setDate(d.getDate() - 1)
  }
  return formatLocalDate(d)
}

/** 日历日加法，跨夏令时也安全（边界条件 #15） */
export function addDays(dateStr: string, days: number): string {
  return formatLocalDate(dfAddDays(parseLocalDate(dateStr), days))
}

/** to - from，按日历日计算，可跨夏令时 */
export function diffDays(from: string, to: string): number {
  return differenceInCalendarDays(parseLocalDate(to), parseLocalDate(from))
}

/** from <= to（字符串比较对 `YYYY-MM-DD` 是安全的） */
export function isSameOrBefore(from: string, to: string): boolean {
  return from <= to
}

/** 闭区间日期列表，用于统计与历史回看 */
export function dateRangeInclusive(from: string, to: string): string[] {
  const out: string[] = []
  const total = diffDays(from, to)
  for (let i = 0; i <= total; i += 1) out.push(addDays(from, i))
  return out
}

/** `2025-06-11` → `2025-06-11 星期三` */
export function formatDisplayDate(dateStr: string): string {
  return `${dateStr} ${format(parseLocalDate(dateStr), 'EEEE', { locale: zhCN })}`
}

/** `2025-06-11` → `06-11 星期三`（已完成分组标题用） */
export function formatShortDate(dateStr: string): string {
  return `${dateStr.slice(5)} ${format(parseLocalDate(dateStr), 'EEEE', { locale: zhCN })}`
}

/** Date → `HH:mm` */
export function formatTime(date: Date): string {
  return format(date, 'HH:mm')
}

/** 相对今天的自然语言描述：今天 / 昨天 / 明天 / 逾期 N 天 / N 天后 */
export function describeRelativeDay(dateStr: string, today: string): string {
  const delta = diffDays(today, dateStr)
  if (delta === 0) return '今天'
  if (delta === 1) return '明天'
  if (delta === -1) return '昨天'
  return delta < 0 ? `逾期 ${-delta} 天` : `${delta} 天后`
}

export { MS_PER_DAY }

/* -------------------------------------------------------------------------- */
/* 月历相关（FR-16 已完成日历）                                                 */
/* -------------------------------------------------------------------------- */

/** `2025-06-11` → `2025-06-01` */
export function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`
}

/* -------------------------------------------------------------------------- */
/* 工作日（需求：周六日算节假日，不计入延期天数）                                 */
/* -------------------------------------------------------------------------- */

/** 周六或周日 */
export function isWeekend(dateStr: string): boolean {
  const day = parseLocalDate(dateStr).getDay() // 0=周日 6=周六
  return day === 0 || day === 6
}

/**
 * 半开区间 (from, to] 内的**工作日**天数，也就是「真正该算作拖延的天数」。
 *
 * 例（默认不计周末）：
 *   周五 → 周一    = 1（只有周一算）
 *   周五 → 周六    = 0
 *   周一 → 周二    = 1
 *   周一 → 下周一  = 5
 *
 * @param countWeekends true 时退化为普通自然日天数（等价于 diffDays）
 */
export function businessDaysBetween(from: string, to: string, countWeekends = false): number {
  const total = diffDays(from, to)
  if (total <= 0) return 0
  if (countWeekends) return total

  let days = 0
  for (let i = 1; i <= total; i += 1) {
    if (!isWeekend(addDays(from, i))) days += 1
  }
  return days
}

/** 按月偏移，返回该月 1 号 */
export function addMonths(dateStr: string, months: number): string {
  const d = parseLocalDate(startOfMonth(dateStr))
  d.setMonth(d.getMonth() + months, 1)
  return formatLocalDate(d)
}

/** `2025-06-01` → `2025年6月` */
export function formatMonthLabel(dateStr: string): string {
  const d = parseLocalDate(dateStr)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

/** 周标题，按周起始日排序 */
export function weekdayLabels(weekStart: 0 | 1): string[] {
  const labels = ['日', '一', '二', '三', '四', '五', '六']
  return labels.slice(weekStart).concat(labels.slice(0, weekStart))
}

/**
 * 生成月历网格（固定 6 行 × 7 列 = 42 格），含上下月补齐的日期。
 * 单元格全部是 `YYYY-MM-DD`，由调用方决定如何淡化非本月日期。
 */
export function buildMonthGrid(monthCursor: string, weekStart: 0 | 1 = 1): string[] {
  const first = parseLocalDate(startOfMonth(monthCursor))
  const offset = (first.getDay() - weekStart + 7) % 7
  const gridStart = addDays(formatLocalDate(first), -offset)
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i))
}
