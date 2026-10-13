/**
 * filters.test.ts —— 按标签筛选任务
 */

import { describe, expect, it } from 'vitest'
import { filterByTags, matchesFilter } from './filters'
import type { Task } from '@/store/types'

let seq = 0
function makeTask(partial: Partial<Task> & { title: string }): Task {
  seq += 1
  return {
    id: partial.id ?? `t${seq}`,
    status: 'today',
    createdAt: '2026-01-01T01:00:00.000Z',
    updatedAt: '2026-01-01T01:00:00.000Z',
    scheduledDate: '2026-01-01',
    completedAt: null,
    completedDate: null,
    deletedAt: null,
    priority: 'none',
    tags: [],
    dueDate: null,
    estimateMinutes: null,
    pinned: false,
    carryOverCount: 0,
    lastRolledAt: null,
    order: seq,
    parentId: null,
    recurringId: null,
    ...partial,
  }
}

const titles = (tasks: Task[]): string[] => tasks.map((t) => t.title)

describe('filterByTags', () => {
  it('筛选为空时原样返回', () => {
    const tasks = [makeTask({ title: 'A', tags: ['工作'] }), makeTask({ title: 'B' })]
    expect(filterByTags(tasks, [])).toBe(tasks)
  })

  it('多选是 OR 语义：任一标签命中即保留', () => {
    const tasks = [
      makeTask({ title: 'A', tags: ['工作'] }),
      makeTask({ title: 'B', tags: ['学习'] }),
      makeTask({ title: 'C', tags: ['生活'] }),
    ]
    expect(new Set(titles(filterByTags(tasks, ['工作', '学习'])))).toEqual(
      new Set(['A', 'B']),
    )
  })

  it('命中父任务时，子任务一并保留（否则父任务会变成光杆）', () => {
    const parent = makeTask({ id: 'p', title: '写周报', tags: ['工作'] })
    const child = makeTask({ id: 'c', title: '汇总进度', parentId: 'p' })
    const other = makeTask({ title: '跑步', tags: ['健康'] })

    expect(new Set(titles(filterByTags([parent, child, other], ['工作'])))).toEqual(
      new Set(['写周报', '汇总进度']),
    )
  })

  it('子任务自己命中时也保留（父任务会由 buildTaskTree 处理）', () => {
    const parent = makeTask({ id: 'p', title: '写周报' })
    const child = makeTask({ id: 'c', title: '汇总进度', parentId: 'p', tags: ['工作'] })

    expect(titles(filterByTags([parent, child], ['工作']))).toEqual(['汇总进度'])
  })

  it('没有任何命中时返回空数组', () => {
    const tasks = [makeTask({ title: 'A', tags: ['工作'] })]
    expect(filterByTags(tasks, ['不存在'])).toEqual([])
  })

  it('matchesFilter 反映单个任务是否命中', () => {
    const task = makeTask({ title: 'A', tags: ['工作'] })
    expect(matchesFilter(task, [])).toBe(true)
    expect(matchesFilter(task, ['工作'])).toBe(true)
    expect(matchesFilter(task, ['学习'])).toBe(false)
  })
})
