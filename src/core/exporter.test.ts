/**
 * exporter.test.ts —— 数据导出（年终述职场景）
 *
 * 重点验证：
 *  - 日期范围过滤（含边界）
 *  - 子任务挂在父任务下，且不单独计数
 *  - 月度 / 标签 / 优先级分布与总数自洽
 *  - Markdown 与 CSV 的关键结构（CSV 必须带 BOM，否则 Excel 中文乱码）
 */

import { describe, expect, it } from 'vitest'
import { buildExportData, exportFileName, recentRange, toCsv, toMarkdown } from './exporter'
import type { Task } from '@/store/types'

let seq = 0
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1
  return {
    id: partial.id ?? `t${seq}`,
    status: 'done',
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
    scheduledDate: '2026-03-01',
    completedAt: '2026-03-01T10:00:00.000Z',
    completedDate: '2026-03-01',
    deletedAt: null,
    priority: 'none',
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    pinned: false,
    carryOverCount: 0,
    progress: 0,
    tracking: false,
    trackingProgress: 0,
    lastRolledAt: null,
    order: seq,
    parentId: null,
    recurringId: null,
    ...partial,
  }
}

const YEAR = { from: '2026-01-01', to: '2026-12-31', includeOpen: false, includeNotes: false }

describe('buildExportData', () => {
  it('按日期分组，日期倒序（最近的在前）', () => {
    const tasks = [
      makeTask({ title: '一月的事', completedDate: '2026-01-05', completedAt: '2026-01-05T09:00:00.000Z' }),
      makeTask({ title: '三月的事', completedDate: '2026-03-10', completedAt: '2026-03-10T09:00:00.000Z' }),
      makeTask({ title: '十二月的事', completedDate: '2026-12-01', completedAt: '2026-12-01T09:00:00.000Z' }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    expect(data.days.map((d) => d.date)).toEqual(['2026-12-01', '2026-03-10', '2026-01-05'])
    expect(data.totalCompleted).toBe(3)
  })

  it('只统计范围内的记录（含两端边界）', () => {
    const tasks = [
      makeTask({ title: '范围前一天', completedDate: '2025-12-31', completedAt: '2025-12-31T09:00:00.000Z' }),
      makeTask({ title: '范围第一天', completedDate: '2026-01-01', completedAt: '2026-01-01T09:00:00.000Z' }),
      makeTask({ title: '范围最后一天', completedDate: '2026-12-31', completedAt: '2026-12-31T09:00:00.000Z' }),
      makeTask({ title: '范围后一天', completedDate: '2027-01-01', completedAt: '2027-01-01T09:00:00.000Z' }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    // 注意不要用默认的 .sort() 比中文标题：那是按码点排序，结果不符合直觉
    expect(new Set(data.days.flatMap((d) => d.tasks).map((t) => t.title))).toEqual(
      new Set(['范围第一天', '范围最后一天']),
    )
  })

  it('子任务挂在父任务下，不单独计入总数', () => {
    const parent = makeTask({ id: 'p1', title: '写周报', tags: ['工作'] })
    const sub1 = makeTask({
      id: 'c1',
      title: '汇总进度',
      parentId: 'p1',
      completedAt: '2026-03-01T11:00:00.000Z',
    })
    const sub2 = makeTask({
      id: 'c2',
      title: '整理计划',
      parentId: 'p1',
      completedAt: '2026-03-01T12:00:00.000Z',
    })
    const data = buildExportData([parent, sub1, sub2], {}, YEAR)

    expect(data.totalCompleted).toBe(1) // 只有父任务算一件
    const entry = data.days[0].tasks[0]
    expect(entry.title).toBe('写周报')
    expect(entry.children.map((c) => c.title)).toEqual(['汇总进度', '整理计划'])
    // 子任务的完成时间也要带出来
    expect(entry.children[0].completedAt).toBe('2026-03-01T11:00:00.000Z')
  })

  it('已删除 / 未完成 / 回收站的任务不进入逐日清单', () => {
    const tasks = [
      makeTask({ title: '正常完成' }),
      makeTask({ title: '已删除', deletedAt: '2026-04-01T00:00:00.000Z' }),
      makeTask({ title: '未完成', status: 'today', completedAt: null, completedDate: null }),
      makeTask({ title: '回收站', status: 'trash', completedAt: null, completedDate: null }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    expect(data.days.flatMap((d) => d.tasks).map((t) => t.title)).toEqual(['正常完成'])
  })

  it('月度分布覆盖范围内所有月份（含 0 件的月份），总数自洽', () => {
    const tasks = [
      makeTask({ title: 'A', completedDate: '2026-01-05', completedAt: '2026-01-05T09:00:00.000Z' }),
      makeTask({ title: 'B', completedDate: '2026-01-20', completedAt: '2026-01-20T09:00:00.000Z' }),
      makeTask({ title: 'C', completedDate: '2026-03-10', completedAt: '2026-03-10T09:00:00.000Z' }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    expect(data.byMonth).toHaveLength(12)
    expect(data.byMonth[0]).toEqual({ month: '2026-01', completed: 2, activeDays: 2 })
    expect(data.byMonth[1]).toEqual({ month: '2026-02', completed: 0, activeDays: 0 })
    expect(data.byMonth[2]).toEqual({ month: '2026-03', completed: 1, activeDays: 1 })

    const sum = data.byMonth.reduce((s, m) => s + m.completed, 0)
    expect(sum).toBe(data.totalCompleted)
  })

  it('标签分布：一件任务多个标签时各计一次，按数量倒序', () => {
    const tasks = [
      makeTask({ title: 'A', tags: ['工作', '重要'] }),
      makeTask({ title: 'B', tags: ['工作'] }),
      makeTask({ title: 'C', tags: ['学习'] }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    expect(data.byTag[0]).toEqual({ tag: '工作', count: 2 })
    expect(data.byTag).toContainEqual({ tag: '重要', count: 1 })
    expect(data.byTag).toContainEqual({ tag: '学习', count: 1 })
  })

  it('优先级分布只保留出现过的档位', () => {
    const tasks = [
      makeTask({ title: 'A', priority: 'high' }),
      makeTask({ title: 'B', priority: 'high' }),
      makeTask({ title: 'C', priority: 'low' }),
    ]
    const data = buildExportData(tasks, {}, YEAR)

    expect(data.byPriority).toEqual([
      { priority: 'high', count: 2 },
      { priority: 'low', count: 1 },
    ])
  })

  it('includeOpen 打开时才附上未完成任务，并按顺延天数倒序', () => {
    const tasks = [
      makeTask({ title: '完成的' }),
      makeTask({ title: '拖了 5 天', status: 'today', completedAt: null, completedDate: null, carryOverCount: 5 }),
      makeTask({ title: '拖了 2 天', status: 'today', completedAt: null, completedDate: null, carryOverCount: 2 }),
    ]

    expect(buildExportData(tasks, {}, YEAR).openTasks).toHaveLength(0)

    const withOpen = buildExportData(tasks, {}, { ...YEAR, includeOpen: true })
    expect(withOpen.openTasks.map((t) => t.title)).toEqual(['拖了 5 天', '拖了 2 天'])
  })

  it('includeNotes 关闭时备注被清空', () => {
    const tasks = [makeTask({ title: 'A', note: '这是备注' })]

    expect(buildExportData(tasks, {}, { ...YEAR, includeNotes: true }).days[0].tasks[0].note).toBe('这是备注')
    expect(buildExportData(tasks, {}, { ...YEAR, includeNotes: false }).days[0].tasks[0].note).toBe('')
  })

  it('从 1 月 1 日起且止于同年 → 「2026 年」；其他范围给出起止日期', () => {
    const tasks = [makeTask({ title: 'A' })]
    // 年末导出全年
    expect(buildExportData(tasks, {}, YEAR).periodLabel).toBe('2026 年')
    // 年中导出「本年至今」也应该叫「2026 年」，而不是退化成日期区间
    expect(
      buildExportData(tasks, {}, { ...YEAR, to: '2026-06-30' }).periodLabel,
    ).toBe('2026 年')
    // 跨年或非年初起，给出精确区间
    expect(
      buildExportData(tasks, {}, { ...YEAR, from: '2026-03-01', to: '2026-03-31' }).periodLabel,
    ).toBe('2026-03-01 ~ 2026-03-31')
    expect(
      buildExportData(tasks, {}, { ...YEAR, from: '2025-06-01', to: '2026-06-01' }).periodLabel,
    ).toBe('2025-06-01 ~ 2026-06-01')
  })
})

describe('toMarkdown', () => {
  it('包含总览、按月分布、标签分布与逐日清单', () => {
    const tasks = [
      makeTask({ title: '回复客户邮件', tags: ['工作'], priority: 'high', completedAt: '2026-03-01T10:30:00.000Z' }),
      // completedAt 与 completedDate 要一起给：真实数据里它们由 toggleComplete 同时写入
      makeTask({
        title: '跑步 5km',
        tags: ['健康'],
        completedDate: '2026-03-02',
        completedAt: '2026-03-02T18:05:00.000Z',
      }),
      makeTask({ title: '写周报', id: 'p', tags: ['工作'] }),
      makeTask({ id: 'c', title: '汇总进度', parentId: 'p' }),
    ]
    const md = toMarkdown(buildExportData(tasks, {}, { ...YEAR, includeNotes: true, includeOpen: true }))

    expect(md).toContain('# 待办完成记录 · 2026 年')
    expect(md).toContain('## 总览')
    // 4 个任务里「汇总进度」是子任务，不单独计数 → 3 件
    expect(md).toContain('| 累计完成 | **3** 件 |')
    expect(md).toContain('## 按月分布')
    expect(md).toContain('| 2026-03 | 3 | 2 |')
    expect(md).toContain('## 按标签分布')
    expect(md).toContain('| #工作 | 2 |')
    expect(md).toContain('## 逐日完成清单')
    expect(md).toContain('### 2026-03-02 星期一（完成 1 件）')
    // 完成时间与标签、优先级都要出现
    expect(md).toContain('- [x] 回复客户邮件 `P:高 #工作` — 10:30')
    // 子任务缩进一层
    expect(md).toContain('  - [x] 汇总进度 — 10:00')
  })

  it('没有记录时给出明确提示而不是空表', () => {
    const md = toMarkdown(buildExportData([], {}, YEAR))
    expect(md).toContain('_该时间段内没有完成记录。_')
  })
})

describe('toCsv', () => {
  it('带 UTF-8 BOM，否则 Excel 打开中文会乱码', () => {
    const csv = toCsv(buildExportData([makeTask({ title: '写周报' })], {}, YEAR))
    expect(csv.startsWith('\uFEFF')).toBe(true)
  })

  it('表头正确，主任务与子任务各占一行', () => {
    const parent = makeTask({ id: 'p', title: '写周报', tags: ['工作'], priority: 'medium' })
    const child = makeTask({ id: 'c', title: '汇总进度', parentId: 'p' })
    const csv = toCsv(buildExportData([parent, child], {}, YEAR))
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n')

    expect(lines[0]).toBe('日期,星期,任务,层级,父任务,标签,优先级,完成时间,顺延天数,备注')
    // 10 列：日期,星期,任务,层级,父任务,标签,优先级,完成时间,顺延天数,备注
    // 父任务行有标签/优先级/顺延；子任务行这几列留空
    expect(lines[1]).toBe('2026-03-01,星期日,写周报,主任务,,工作,中,10:00,0,')
    expect(lines[2]).toBe('2026-03-01,星期日,汇总进度,子任务,写周报,,,10:00,,')
  })

  it('含逗号或引号的标题被正确转义', () => {
    const csv = toCsv(
      buildExportData([makeTask({ title: '写周报, 含"引号"' })], {}, YEAR),
    )
    expect(csv).toContain('"写周报, 含""引号"""')
  })
})

describe('辅助函数', () => {
  it('默认年份范围是 1 月 1 日至今', () => {
    expect(recentRange('2026-03-15', 30)).toEqual({ from: '2026-02-14', to: '2026-03-15' })
  })

  it('文件名包含起止日期', () => {
    const data = buildExportData([], {}, { ...YEAR, from: '2026-01-01', to: '2026-10-13' })
    expect(exportFileName(data, 'md')).toBe('todolist-20260101-20261013.md')
    expect(exportFileName(data, 'csv')).toBe('todolist-20260101-20261013.csv')
  })
})
