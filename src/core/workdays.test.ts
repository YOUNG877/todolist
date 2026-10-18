/**
 * workdays.test.ts —— 工作日与「周末不算延期」的结算行为
 *
 * 需求：周六日是节假日，不计入延期时间。
 * 判定口径是半开区间 (from, to] 里的工作日数，所以
 * 周五 → 周六 = 0 天延期，周五 → 下周一 = 1 天延期。
 */

import { describe, expect, it } from 'vitest'
import { businessDaysBetween, isWeekend } from './date'
import { applySettle } from './settle'
import { DEFAULT_SETTINGS, type PersistedState, type Settings, type Task } from '@/store/types'

describe('isWeekend', () => {
  it('周六日是周末，周一到周五不是', () => {
    expect(isWeekend('2025-06-07')).toBe(true) // 周六
    expect(isWeekend('2025-06-08')).toBe(true) // 周日
    for (const d of ['2025-06-02', '2025-06-03', '2025-06-04', '2025-06-05', '2025-06-06']) {
      expect(isWeekend(d)).toBe(false)
    }
  })
})

describe('businessDaysBetween', () => {
  it('同一天是 0', () => {
    expect(businessDaysBetween('2025-06-02', '2025-06-02')).toBe(0)
  })

  it('周六 → 周日 不增加天数', () => {
    expect(businessDaysBetween('2025-06-07', '2025-06-08')).toBe(0)
  })

  it('周五 → 周六 不增加天数（周末先不算）', () => {
    expect(businessDaysBetween('2025-06-06', '2025-06-07')).toBe(0)
  })

  it('周五 → 下周一 只算 1 天', () => {
    expect(businessDaysBetween('2025-06-06', '2025-06-09')).toBe(1)
  })

  it('周一到下周一算 5 天', () => {
    expect(businessDaysBetween('2025-06-02', '2025-06-09')).toBe(5)
  })

  it('跨两个周末时只数工作日', () => {
    // 06-02(一) → 06-16(一)：两周，共 10 个工作日
    expect(businessDaysBetween('2025-06-02', '2025-06-16')).toBe(10)
  })

  it('countWeekends = true 时退化为自然日', () => {
    expect(businessDaysBetween('2025-06-06', '2025-06-08', true)).toBe(2)
    expect(businessDaysBetween('2025-06-02', '2025-06-09', true)).toBe(7)
  })
})

/* -------------------------------------------------------------------------- */
/* 结算层：顺延天数不再把周末算进去                                              */
/* -------------------------------------------------------------------------- */

let seq = 0
function makeTask(partial: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: partial.id ?? `t${seq}`,
    title: partial.title ?? `任务 ${seq}`,
    status: 'today',
    createdAt: '2025-06-01T01:00:00.000Z',
    updatedAt: '2025-06-01T01:00:00.000Z',
    scheduledDate: '2025-06-05',
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
    progress: 0,
    tracking: false,
    trackingProgress: 0,
    trackingNotes: [],
    order: seq,
    parentId: null,
    recurringId: null,
    ...partial,
  }
}

function makeState(
  lastSettledDate: string,
  tasks: Task[],
  settings: Partial<Settings> = {},
): PersistedState {
  return {
    version: 1,
    tasks,
    snapshots: {},
    settings: { ...DEFAULT_SETTINGS, ...settings },
    lastSettledDate,
    ui: {
      lastRolloverNotice: null,
      sortMode: 'manual',
      view: 'board',
      calendarMode: 'count',
      tagFilter: [],
      expandedCompletedDates: [],
    },
    updatedAt: '2025-06-01T00:00:00.000Z',
  }
}

describe('结算：周末不计入延期', () => {
  it('周四的任务延到周五算 1 天', () => {
    // 2025-06-05 周四 → 06-06 周五
    const state = makeState('2025-06-05', [makeTask({ id: 'a', scheduledDate: '2025-06-05' })])
    applySettle(state, new Date('2025-06-06T10:00:00'))
    expect(state.tasks[0].carryOverCount).toBe(1)
  })

  it('周五的任务延到周六不算延期（周末是节假日）', () => {
    // 2025-06-06 周五 → 06-07 周六
    const state = makeState('2025-06-06', [makeTask({ id: 'a', scheduledDate: '2025-06-06' })])
    applySettle(state, new Date('2025-06-07T10:00:00'))

    expect(state.tasks[0].scheduledDate).toBe('2025-06-07')
    expect(state.tasks[0].carryOverCount).toBe(0)
  })

  it('周六、周日连续顺延两天，延期天数仍是 0', () => {
    // 06-06 周五，一路推到 06-08 周日：周末两天都不算
    const state = makeState('2025-06-06', [makeTask({ id: 'a', scheduledDate: '2025-06-06' })])
    const result = applySettle(state, new Date('2025-06-08T10:00:00'))

    expect(state.tasks[0].scheduledDate).toBe('2025-06-08')
    expect(state.tasks[0].carryOverCount).toBe(0)
    // 三天都各有一条快照，快照本身照常按天记录
    expect(result.snapshotsWritten).toEqual(['2025-06-06', '2025-06-07'])
  })

  it('周五的任务到周一才算 1 天延期', () => {
    const state = makeState('2025-06-06', [makeTask({ id: 'a', scheduledDate: '2025-06-06' })])
    applySettle(state, new Date('2025-06-09T10:00:00'))

    expect(state.tasks[0].scheduledDate).toBe('2025-06-09')
    expect(state.tasks[0].carryOverCount).toBe(1)
  })

  it('周一到下周一算 5 天延期（跳过中间的周末）', () => {
    const state = makeState('2025-06-02', [makeTask({ id: 'a', scheduledDate: '2025-06-02' })])
    applySettle(state, new Date('2025-06-09T10:00:00'))

    expect(state.tasks[0].carryOverCount).toBe(5)
  })

  it('打开 countWeekends 后退回自然日口径', () => {
    const state = makeState('2025-06-06', [makeTask({ id: 'a', scheduledDate: '2025-06-06' })], {
      countWeekends: true,
    })
    applySettle(state, new Date('2025-06-09T10:00:00'))

    expect(state.tasks[0].carryOverCount).toBe(3) // 六、日、一
  })
})
