/**
 * exporter.ts —— 数据导出（FR-17 扩展）
 *
 * 目标是支撑「年底写述职报告」这种场景，所以除了逐日清单，还要给出
 * 月度分布、标签分布、连续打卡这类可以直接抄进报告里的汇总。
 *
 * 输出格式：
 *  - Markdown：给人看 / 直接粘进文档
 *  - CSV：给 Excel 做进一步统计（带 UTF-8 BOM，否则 Excel 打开中文是乱码）
 *
 * 约定：只导出**当前仍在任务列表里**的记录。已被彻底删除的任务无法还原标题，
 * 所以不会出现在导出结果中（回收站里的任务同样不算）。
 */

import { addDays, dateRangeInclusive, diffDays, formatShortDate } from './date'
import { isSubtask, selectStreak } from './selectors'
import type { DaySnapshot, Priority, Task } from '@/store/types'
import { PRIORITY_LABEL } from '@/store/types'

export interface ExportOptions {
  /** 起始日期（含），YYYY-MM-DD */
  from: string
  /** 结束日期（含），YYYY-MM-DD */
  to: string
  /** 是否附上仍未完成的任务（述职报告里常用于「进行中/遗留事项」） */
  includeOpen: boolean
  /** 是否包含备注 */
  includeNotes: boolean
}

export interface ExportTaskEntry {
  title: string
  completedAt: string | null
  priority: Priority
  tags: string[]
  note: string
  carryOverCount: number
  children: Array<{ title: string; completedAt: string | null }>
}

export interface ExportDay {
  date: string
  weekday: string
  tasks: ExportTaskEntry[]
}

export interface ExportMonthStat {
  month: string
  completed: number
  activeDays: number
}

export interface ExportOpenTask {
  title: string
  tags: string[]
  carryOverCount: number
  scheduledDate: string | null
}

export interface ExportData {
  from: string
  to: string
  /** 形如「2026 年」或「2026-03-01 ~ 2026-10-13」 */
  periodLabel: string
  totalCompleted: number
  activeDays: number
  activeMonths: number
  longestStreak: number
  averagePerActiveDay: number
  byMonth: ExportMonthStat[]
  byTag: Array<{ tag: string; count: number }>
  byPriority: Array<{ priority: Priority; count: number }>
  topCarryOver: Array<{ title: string; carryOverCount: number }>
  openTasks: ExportOpenTask[]
  days: ExportDay[]
}

function toEntry(task: Task, children: Task[], includeNotes: boolean): ExportTaskEntry {
  return {
    title: task.title,
    completedAt: task.completedAt,
    priority: task.priority,
    tags: task.tags,
    note: includeNotes ? (task.note ?? '') : '',
    carryOverCount: task.carryOverCount,
    children: children.map((c) => ({ title: c.title, completedAt: c.completedAt })),
  }
}

/** 把任务列表整理成可导出的结构 */
export function buildExportData(
  tasks: Task[],
  snapshots: Record<string, DaySnapshot>,
  options: ExportOptions,
): ExportData {
  const { from, to, includeOpen, includeNotes } = options

  // 父任务 → 子任务（含已完成的），用于把子任务挂在父任务下面
  const childrenByParent = new Map<string, Task[]>()
  for (const t of tasks) {
    if (!isSubtask(t) || t.deletedAt) continue
    const list = childrenByParent.get(t.parentId as string)
    if (list) list.push(t)
    else childrenByParent.set(t.parentId as string, [t])
  }

  const inRange = (date: string | null): boolean =>
    !!date && date >= from && date <= to && diffDays(from, date) >= 0

  const doneTop = tasks.filter(
    (t) => !isSubtask(t) && !t.deletedAt && t.status === 'done' && inRange(t.completedDate),
  )

  // 逐日分组：倒序（最近的在前，符合「回顾」习惯）
  const byDate = new Map<string, Task[]>()
  for (const t of doneTop) {
    const date = t.completedDate as string
    const list = byDate.get(date)
    if (list) list.push(t)
    else byDate.set(date, [t])
  }

  const days: ExportDay[] = [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({
      date,
      weekday: formatShortDate(date).slice(6),
      tasks: list
        .sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? -1 : 1))
        .map((t) => toEntry(t, childrenByParent.get(t.id) ?? [], includeNotes)),
    }))

  /* ---------- 汇总 ---------- */
  const dates = [...byDate.keys()].sort()
  const total = doneTop.length

  // 月度分布：把范围内每个月的完成数与有记录天数都算出来（含 0 的月份也保留，方便看趋势）
  const byMonthMap = new Map<string, { completed: number; days: Set<string> }>()
  for (const date of dateRangeInclusive(from, to)) {
    const month = date.slice(0, 7)
    if (!byMonthMap.has(month)) byMonthMap.set(month, { completed: 0, days: new Set() })
  }
  for (const date of dates) {
    const bucket = byMonthMap.get(date.slice(0, 7))
    if (!bucket) continue
    bucket.completed += byDate.get(date)?.length ?? 0
    bucket.days.add(date)
  }
  const byMonth: ExportMonthStat[] = [...byMonthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, v]) => ({ month, completed: v.completed, activeDays: v.days.size }))

  // 标签分布（一件任务有多个标签时各计一次）
  const tagCount = new Map<string, number>()
  for (const t of doneTop) {
    for (const tag of t.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  }
  const byTag = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))

  const priorityOrder: Priority[] = ['high', 'medium', 'low', 'none']
  const byPriority = priorityOrder
    .map((priority) => ({
      priority,
      count: doneTop.filter((t) => t.priority === priority).length,
    }))
    .filter((row) => row.count > 0)

  const topCarryOver = doneTop
    .filter((t) => t.carryOverCount > 0)
    .sort((a, b) => b.carryOverCount - a.carryOverCount)
    .slice(0, 10)
    .map((t) => ({ title: t.title, carryOverCount: t.carryOverCount }))

  const openTasks: ExportOpenTask[] = includeOpen
    ? tasks
        .filter((t) => !isSubtask(t) && !t.deletedAt && !t.completedAt && t.status !== 'trash')
        .sort((a, b) => b.carryOverCount - a.carryOverCount || a.order - b.order)
        .map((t) => ({
          title: t.title,
          tags: t.tags,
          carryOverCount: t.carryOverCount,
          scheduledDate: t.scheduledDate,
        }))
    : []

  const { best } = selectStreak(tasks, snapshots, to)

  // 从 1 月 1 日起、且止于同一年 → 直接叫「2025 年」。
  // 写年终述职通常是在年中或年末导全年数据，若严格要求止于 12/31，
  // 标题几乎永远退化成日期区间，反而不好看；精确范围在下方「统计范围」里已经给出。
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const fromYearStart = from.endsWith('-01-01')
  const periodLabel = sameYear && fromYearStart ? `${from.slice(0, 4)} 年` : `${from} ~ ${to}`

  return {
    from,
    to,
    periodLabel,
    totalCompleted: total,
    activeDays: dates.length,
    activeMonths: new Set(dates.map((d) => d.slice(0, 7))).size,
    longestStreak: best,
    averagePerActiveDay: dates.length > 0 ? total / dates.length : 0,
    byMonth,
    byTag,
    byPriority,
    topCarryOver,
    openTasks,
    days,
  }
}

/* -------------------------------------------------------------------------- */
/* Markdown                                                                    */
/* -------------------------------------------------------------------------- */

function timeOf(iso: string | null): string {
  return iso ? iso.slice(11, 16) : ''
}

function chipList(t: ExportTaskEntry): string {
  const parts: string[] = []
  if (t.priority !== 'none') parts.push(`P:${PRIORITY_LABEL[t.priority]}`)
  for (const tag of t.tags) parts.push(`#${tag}`)
  return parts.length > 0 ? ` \`${parts.join(' ')}\`` : ''
}

/** 渲染 Markdown。备注是否包含已在 buildExportData 里决定，这里不再需要 options。 */
export function toMarkdown(data: ExportData): string {
  const lines: string[] = []
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  lines.push(`# 待办完成记录 · ${data.periodLabel}`)
  lines.push('')
  lines.push(`> 统计范围：${data.from} ~ ${data.to}　·　导出时间：${stamp}`)
  lines.push('')

  /* ---- 总览 ---- */
  lines.push('## 总览')
  lines.push('')
  lines.push('| 指标 | 数值 |')
  lines.push('| --- | --- |')
  lines.push(`| 累计完成 | **${data.totalCompleted}** 件 |`)
  lines.push(`| 有记录天数 | ${data.activeDays} 天 |`)
  lines.push(`| 活跃月份 | ${data.activeMonths} 个 |`)
  lines.push(`| 平均每天完成 | ${data.averagePerActiveDay.toFixed(1)} 件 |`)
  lines.push(`| 最长连续完成 | ${data.longestStreak} 天 |`)
  lines.push('')

  /* ---- 按月趋势 ---- */
  if (data.byMonth.length > 0) {
    lines.push('## 按月分布')
    lines.push('')
    lines.push('| 月份 | 完成件数 | 有记录天数 |')
    lines.push('| --- | ---: | ---: |')
    for (const m of data.byMonth) {
      lines.push(`| ${m.month} | ${m.completed} | ${m.activeDays} |`)
    }
    lines.push('')
  }

  /* ---- 标签分布 ---- */
  if (data.byTag.length > 0) {
    lines.push('## 按标签分布')
    lines.push('')
    lines.push('| 标签 | 完成件数 |')
    lines.push('| --- | ---: |')
    for (const t of data.byTag) lines.push(`| #${t.tag} | ${t.count} |`)
    lines.push('')
  }

  /* ---- 优先级分布 ---- */
  if (data.byPriority.length > 0) {
    lines.push('## 按优先级分布')
    lines.push('')
    lines.push('| 优先级 | 完成件数 |')
    lines.push('| --- | ---: |')
    for (const p of data.byPriority) lines.push(`| ${PRIORITY_LABEL[p.priority]} | ${p.count} |`)
    lines.push('')
  }

  /* ---- 逐日清单 ---- */
  lines.push('## 逐日完成清单')
  lines.push('')
  if (data.days.length === 0) {
    lines.push('_该时间段内没有完成记录。_')
    lines.push('')
  }
  for (const day of data.days) {
    lines.push(`### ${day.date} ${day.weekday}（完成 ${day.tasks.length} 件）`)
    lines.push('')
    for (const t of day.tasks) {
      const time = timeOf(t.completedAt)
      lines.push(`- [x] ${t.title}${chipList(t)}${time ? ` — ${time}` : ''}`)
      if (t.note) lines.push(`      > ${t.note.replace(/\n/g, '\n      > ')}`)
      for (const child of t.children) {
        const childTime = timeOf(child.completedAt)
        lines.push(`  - [x] ${child.title}${childTime ? ` — ${childTime}` : ''}`)
      }
    }
    lines.push('')
  }

  /* ---- 未完成 ---- */
  if (data.openTasks.length > 0) {
    lines.push('## 未完成 / 进行中')
    lines.push('')
    for (const t of data.openTasks) {
      const tags = t.tags.length > 0 ? ` \`${t.tags.map((x) => `#${x}`).join(' ')}\`` : ''
      const carried = t.carryOverCount > 0 ? `（已顺延 ${t.carryOverCount} 天）` : ''
      lines.push(`- [ ] ${t.title}${tags}${carried}`)
    }
    lines.push('')
  }

  /* ---- 顺延最多的 ---- */
  if (data.topCarryOver.length > 0) {
    lines.push('## 顺延次数最多的任务')
    lines.push('')
    lines.push('| 任务 | 顺延天数 |')
    lines.push('| --- | ---: |')
    for (const t of data.topCarryOver) lines.push(`| ${t.title} | ${t.carryOverCount} |`)
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('_由「今日待办」导出。已被彻底删除的任务不会出现在本记录中。_')
  lines.push('')

  return lines.join('\n')
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

export function toCsv(data: ExportData): string {
  const rows: string[][] = [
    ['日期', '星期', '任务', '层级', '父任务', '标签', '优先级', '完成时间', '顺延天数', '备注'],
  ]

  for (const day of data.days) {
    for (const t of day.tasks) {
      rows.push([
        day.date,
        day.weekday,
        t.title,
        '主任务',
        '',
        t.tags.join(' '),
        PRIORITY_LABEL[t.priority],
        timeOf(t.completedAt),
        String(t.carryOverCount),
        t.note,
      ])
      for (const child of t.children) {
        rows.push([
          day.date,
          day.weekday,
          child.title,
          '子任务',
          t.title,
          '',
          '',
          timeOf(child.completedAt),
          '',
          '',
        ])
      }
    }
  }

  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  // 前置 BOM，Excel 才会按 UTF-8 解析中文
  return `\uFEFF${body}\r\n`
}

/* -------------------------------------------------------------------------- */
/* 文件名                                                                      */
/* -------------------------------------------------------------------------- */

export function exportFileName(data: ExportData, ext: 'md' | 'csv'): string {
  const compact = `${data.from.replace(/-/g, '')}-${data.to.replace(/-/g, '')}`
  return `todolist-${compact}.${ext}`
}

/** 默认范围：本年 1 月 1 日 ~ 今天（贴合年终述职的场景） */
export function defaultYearRange(today: string): { from: string; to: string } {
  return { from: `${today.slice(0, 4)}-01-01`, to: today }
}

/** 最近 N 天 */
export function recentRange(today: string, days: number): { from: string; to: string } {
  return { from: addDays(today, -(days - 1)), to: today }
}
