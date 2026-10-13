/**
 * settle.test.ts —— 需求文档 8.4 要求的 10 条核心用例
 *
 * 覆盖映射：
 *   1 → 同日重复调用 settle() 状态不变（幂等）
 *   2 → 跨 1 天顺延，carryOverCount +1，1 条快照
 *   3 → 跨 5 天逐日推演，carryOverCount +5，5 条快照且中间日期正确
 *   4 → 已完成任务不被顺延
 *   5 → pinned-only 策略下普通任务退回池中
 *   6 → rolloverMaxDays = 3 时超限任务退回池中
 *   7 → 取消历史完成 → 回到今日且 carryOverCount 不变
 *   8 → 日界 04:00：02:00 的逻辑日期是前一天
 *   9 → 回收站任务超过 30 天被物理清理
 *  10 → 排序中值插入 + 差值过小时全量重排
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clock } from './clock'
import { logicalDateOf } from './date'
import { moveToIndex, needsRebalance, orderBetween } from './order'
import { PURGE_AFTER_DAYS, settle, shouldReturnToPool } from './settle'
import { actions, useStore, type StoreState } from '@/store/store'
import {
  CURRENT_VERSION,
  DEFAULT_SETTINGS,
  type PersistedState,
  type Task,
  type UiState,
} from '@/store/types'

/* -------------------------------------------------------------------------- */
/* 测试夹具                                                                    */
/* -------------------------------------------------------------------------- */

const DAY1 = '2025-06-01'
const DAY2 = '2025-06-02'
const DAY6 = '2025-06-06'

/** 本地时间构造，避免时区影响断言 */
function at(year: number, month: number, day: number, hour = 9, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

let seq = 0
function makeTask(partial: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: partial.id ?? `task-${seq}`,
    title: partial.title ?? `任务 ${seq}`,
    status: 'today',
    createdAt: '2025-05-31T01:00:00.000Z',
    updatedAt: '2025-05-31T01:00:00.000Z',
    scheduledDate: DAY1,
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

const emptyUi: UiState = {
  lastRolloverNotice: null,
  sortMode: 'manual',
  view: 'board',
  calendarMode: 'count',
  tagFilter: [],
  expandedCompletedDates: [],
}

function makeState(tasks: Task[], overrides: Partial<PersistedState> = {}): PersistedState {
  return {
    version: CURRENT_VERSION,
    tasks,
    snapshots: {},
    settings: { ...DEFAULT_SETTINGS },
    lastSettledDate: DAY1,
    ui: { ...emptyUi },
    updatedAt: '2025-05-31T01:00:00.000Z',
    ...overrides,
  }
}

function resetStore(state: PersistedState): void {
  useStore.setState({ ...state, hydrated: false, storageWarning: null, lastSettle: null } as StoreState)
}

beforeEach(() => {
  seq = 0
  clock.reset()
})

afterEach(() => {
  clock.reset()
})

/* -------------------------------------------------------------------------- */

describe('settle() 结算与顺延', () => {
  it('1. 同一天重复调用 settle() 不产生任何副作用（幂等）', () => {
    const before = makeState([makeTask({ id: 'a', pinned: true })])
    const now = at(2025, 6, 1, 9)

    const first = settle(before, now)
    expect(first.result.changed).toBe(false)
    expect(first.result.rolled).toHaveLength(0)

    const second = settle(first.state, now)
    const third = settle(second.state, at(2025, 6, 1, 23, 59))

    expect(second.result.changed).toBe(false)
    expect(third.result.changed).toBe(false)
    expect(third.state.tasks[0].carryOverCount).toBe(0)
    expect(third.state.tasks[0].scheduledDate).toBe(DAY1)
    expect(third.state.snapshots).toEqual({})
    // 反复调用后状态与初始状态逐字段一致
    expect(third.state.tasks).toEqual(before.tasks)
    expect(third.state.lastSettledDate).toBe(DAY1)
  })

  it('2. 跨 1 天：未完成任务顺延到今天，carryOverCount +1，生成 1 条快照', () => {
    const state = makeState([makeTask({ id: 'a', title: '写周报' })])
    const { state: next, result } = settle(state, at(2025, 6, 2, 9))

    expect(result.changed).toBe(true)
    expect(result.rolled).toHaveLength(1)
    expect(result.rolled[0]).toMatchObject({ id: 'a', from: DAY1, to: DAY2, carryOverCount: 1 })

    const task = next.tasks[0]
    expect(task.scheduledDate).toBe(DAY2)
    expect(task.status).toBe('today')
    expect(task.carryOverCount).toBe(1)
    // clock.now() 是活时钟，travelTo 之后时间仍在流动，因此只比到分钟
    expect(task.lastRolledAt?.slice(0, 16)).toBe(at(2025, 6, 2, 9).toISOString().slice(0, 16))

    expect(result.snapshotsWritten).toEqual([DAY1])
    expect(next.snapshots[DAY1]).toMatchObject({ planned: 1, completed: 0, carriedOutIds: ['a'] })
    expect(next.lastSettledDate).toBe(DAY2)

    // 顺延提示条（FR-06）
    expect(next.ui.lastRolloverNotice).toMatchObject({ count: 1, taskIds: ['a'], date: DAY2 })
  })

  it('3. 跨 5 天：逐日推演，carryOverCount +5，5 条快照且中间日期统计正确', () => {
    const done = makeTask({
      id: 'done',
      title: '已完成的事',
      status: 'done',
      completedAt: '2025-06-03T02:00:00.000Z',
      completedDate: '2025-06-03',
    })
    const state = makeState([
      makeTask({ id: 'a', title: '拖了很久' }),
      makeTask({ id: 'b', title: '也拖了很久' }),
      done,
    ])

    const { state: next, result } = settle(state, at(2025, 6, 6, 9))
    const byId = new Map(next.tasks.map((t) => [t.id, t]))

    expect(byId.get('a')?.carryOverCount).toBe(5)
    expect(byId.get('b')?.carryOverCount).toBe(5)
    expect(byId.get('a')?.scheduledDate).toBe(DAY6)
    expect(byId.get('done')?.status).toBe('done')
    expect(byId.get('done')?.carryOverCount).toBe(0)

    expect(result.snapshotsWritten).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
      '2025-06-04',
      '2025-06-05',
    ])

    // 06-01：3 个任务都在，其中 1 个之后才被完成 → planned 3
    expect(next.snapshots['2025-06-01']).toMatchObject({ planned: 3, completed: 0 })
    // 06-03：done 是在这天完成的，a/b 在这天被顺延出去
    expect(next.snapshots['2025-06-03']).toMatchObject({
      planned: 3,
      completed: 1,
      completedTaskIds: ['done'],
      carriedOutIds: ['a', 'b'],
    })
    expect(next.snapshots['2025-06-03'].completionRate).toBeCloseTo(1 / 3, 6)
    // 06-05：只剩两个被拖的任务
    expect(next.snapshots['2025-06-05']).toMatchObject({ planned: 2, completed: 0 })
  })

  it('4. 已完成的任务永远不会被顺延', () => {
    const state = makeState([
      makeTask({ id: 'done', status: 'done', completedAt: '2025-06-01T10:00:00.000Z', completedDate: DAY1 }),
      makeTask({ id: 'open' }),
    ])
    const { state: next } = settle(state, at(2025, 6, 2, 9))
    const done = next.tasks.find((t) => t.id === 'done')
    const open = next.tasks.find((t) => t.id === 'open')

    expect(done?.carryOverCount).toBe(0)
    expect(done?.scheduledDate).toBe(DAY1)
    expect(done?.completedDate).toBe(DAY1)
    expect(open?.carryOverCount).toBe(1)
  })

  it('5. pinned-only 策略：普通任务退回待办池，必做任务继续顺延', () => {
    const state = makeState(
      [makeTask({ id: 'normal', pinned: false }), makeTask({ id: 'pinned', pinned: true })],
      { settings: { ...DEFAULT_SETTINGS, rolloverStrategy: 'pinned-only' } },
    )
    const { state: next, result } = settle(state, at(2025, 6, 2, 9))
    const normal = next.tasks.find((t) => t.id === 'normal')
    const pinned = next.tasks.find((t) => t.id === 'pinned')

    expect(normal?.status).toBe('pool')
    expect(normal?.scheduledDate).toBeNull()
    expect(pinned?.status).toBe('today')
    expect(pinned?.scheduledDate).toBe(DAY2)

    expect(result.rolled.map((r) => r.id)).toEqual(['pinned'])
    expect(result.returnedToPool.map((r) => r.id)).toEqual(['normal'])
    expect(next.snapshots[DAY1].returnedToPoolIds).toEqual(['normal'])
  })

  it('6. rolloverMaxDays = 3：超过顺延上限的任务退回待办池', () => {
    const state = makeState([makeTask({ id: 'a', carryOverCount: 3 })], {
      settings: { ...DEFAULT_SETTINGS, rolloverMaxDays: 3 },
    })
    const { state: next, result } = settle(state, at(2025, 6, 2, 9))
    const task = next.tasks[0]

    expect(task.carryOverCount).toBe(4) // 累加后 4 > 3
    expect(task.status).toBe('pool')
    expect(task.scheduledDate).toBeNull()
    expect(result.returnedToPool).toHaveLength(1)

    // 边界：刚好等于上限时仍应继续顺延
    expect(shouldReturnToPool({ pinned: true }, { rolloverStrategy: 'all', rolloverMaxDays: 3 }, 3)).toBe(false)
    expect(shouldReturnToPool({ pinned: true }, { rolloverStrategy: 'all', rolloverMaxDays: 3 }, 4)).toBe(true)
  })

  it('7. 取消历史完成：任务回到今天，且 carryOverCount 不因这次操作变化', () => {
    const state = makeState([
      makeTask({
        id: 'old',
        title: '三天前完成的事',
        status: 'done',
        completedAt: '2025-06-01T10:00:00.000Z',
        completedDate: DAY1,
        carryOverCount: 2,
      }),
    ])
    resetStore(state)
    clock.travelTo(at(2025, 6, 4, 9))

    actions.toggleComplete('old')

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('today')
    expect(task.completedAt).toBeNull()
    expect(task.completedDate).toBeNull()
    expect(task.scheduledDate).toBe('2025-06-04')
    expect(task.carryOverCount).toBe(2) // 保持不变
  })

  it('7b. 勾选完成：写入当前逻辑日期作为 completedDate', () => {
    resetStore(makeState([makeTask({ id: 'x', scheduledDate: '2025-06-11' })], { lastSettledDate: '2025-06-11' }))
    clock.travelTo(at(2025, 6, 11, 14, 32))

    actions.toggleComplete('x')

    const task = useStore.getState().tasks[0]
    expect(task.status).toBe('done')
    expect(task.completedDate).toBe('2025-06-11')
    expect(task.completedAt?.slice(0, 16)).toBe(at(2025, 6, 11, 14, 32).toISOString().slice(0, 16))
  })

  it('8. 日界 04:00：凌晨 02:00 的逻辑日期是前一天', () => {
    expect(logicalDateOf(at(2025, 6, 11, 2, 0), 4)).toBe('2025-06-10')
    expect(logicalDateOf(at(2025, 6, 11, 3, 59), 4)).toBe('2025-06-10')
    expect(logicalDateOf(at(2025, 6, 11, 4, 0), 4)).toBe('2025-06-11')
    expect(logicalDateOf(at(2025, 6, 11, 9, 0), 4)).toBe('2025-06-11')
    // 日界设为 0 点时，永远就是日历日
    expect(logicalDateOf(at(2025, 6, 11, 0, 30), 0)).toBe('2025-06-11')

    // 凌晨完成的任务应归到前一天（场景 D）
    const state = makeState([makeTask({ id: 'night', scheduledDate: '2025-06-10' })], {
      lastSettledDate: '2025-06-10',
    })
    resetStore(state)
    clock.travelTo(at(2025, 6, 11, 2, 0))
    actions.toggleComplete('night')
    expect(useStore.getState().tasks[0].completedDate).toBe('2025-06-10')
  })

  it('9. 回收站中超过 30 天的任务被物理清理，未超期的不受影响', () => {
    const now = at(2025, 6, 30, 9)
    const oldDeletedAt = new Date(now.getTime() - (PURGE_AFTER_DAYS + 1) * 86_400_000).toISOString()
    const recentDeletedAt = new Date(now.getTime() - 5 * 86_400_000).toISOString()

    const state = makeState(
      [
        makeTask({ id: 'old', status: 'trash', deletedAt: oldDeletedAt, prevStatus: 'pool', scheduledDate: null }),
        makeTask({ id: 'recent', status: 'trash', deletedAt: recentDeletedAt, prevStatus: 'pool', scheduledDate: null }),
      ],
      { lastSettledDate: '2025-06-29' },
    )

    const { state: next, result } = settle(state, now)
    expect(result.purgedIds).toEqual(['old'])
    expect(next.tasks.map((t) => t.id)).toEqual(['recent'])
  })

  it('9b. 系统时间被回拨时不回滚数据、不推进游标', () => {
    const state = makeState([makeTask({ id: 'a', scheduledDate: '2025-06-10' })], {
      lastSettledDate: '2025-06-10',
    })
    const { state: next, result } = settle(state, at(2025, 6, 5, 9))
    expect(result.changed).toBe(false)
    expect(next.lastSettledDate).toBe('2025-06-10')
    expect(next.tasks).toEqual(state.tasks)
  })

  it('9c. ask 策略下不擅自顺延，只回报待确认的任务', () => {
    const state = makeState([makeTask({ id: 'a' })], {
      settings: { ...DEFAULT_SETTINGS, rolloverStrategy: 'ask' },
    })
    const { state: next, result } = settle(state, at(2025, 6, 2, 9))
    expect(result.pendingAskIds).toEqual(['a'])
    expect(next.tasks[0].scheduledDate).toBe(DAY1)
    expect(next.tasks[0].carryOverCount).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */

describe('排序权重（需求 6.4）', () => {
  it('10. 中值插入与差值过小时的全量重排', () => {
    // 取中值
    expect(orderBetween(null, null)).toBe(1)
    expect(orderBetween(null, 5)).toBe(4)
    expect(orderBetween(3, null)).toBe(4)
    expect(orderBetween(1, 2)).toBe(1.5)
    expect(orderBetween(1, 1.5)).toBe(1.25)

    // 差值过小判定
    expect(needsRebalance([1, 2, 3])).toBe(false)
    expect(needsRebalance([1, 1 + 1e-9])).toBe(true)

    // 正常插入：把 c 移到最前
    const items = [
      { id: 'a', order: 1 },
      { id: 'b', order: 2 },
      { id: 'c', order: 3 },
      { id: 'd', order: 4 },
    ]
    const moved = moveToIndex(items, 'c', 0)
    expect(moved.changed).toBe(true)
    expect(moved.ordered.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd'])
    expect(items.find((t) => t.id === 'c')?.order).toBe(0)

    // 精度即将耗尽 → 触发全量重排为 1..n
    const tight = [
      { id: 'a', order: 1 },
      { id: 'b', order: 1 + 1e-9 },
      { id: 'c', order: 2 },
    ]
    const rebalanced = moveToIndex(tight, 'c', 1)
    expect(rebalanced.ordered.map((t) => t.id)).toEqual(['a', 'c', 'b'])
    expect(rebalanced.ordered.map((t) => t.order)).toEqual([1, 2, 3])
    expect(needsRebalance(rebalanced.ordered.map((t) => t.order))).toBe(false)
  })

  it('10b. store.moveTask 在今日列表内移动并持久化顺序', () => {
    const tasks = [
      makeTask({ id: 'a', order: 1 }),
      makeTask({ id: 'b', order: 2 }),
      makeTask({ id: 'c', order: 3 }),
    ]
    resetStore(makeState(tasks, { lastSettledDate: DAY1 }))
    clock.travelTo(at(2025, 6, 1, 9))

    actions.moveTask('c', 0)

    const after = useStore
      .getState()
      .tasks.slice()
      .sort((x, y) => x.order - y.order)
      .map((t) => t.id)
    expect(after).toEqual(['c', 'a', 'b'])
  })
})
