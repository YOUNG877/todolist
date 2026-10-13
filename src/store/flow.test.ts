/**
 * flow.test.ts —— 需求文档 11.2「跨天测试脚本」的自动化版本
 *
 * 直接跑用户四条核心诉求的闭环：
 *   待办池 → 安排到今日 → 勾选完成归档到当天 → 未完成自动顺延
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clock } from '@/core/clock'
import { logicalDateOf } from '@/core/date'
import { groupCompletedByDate, selectPoolTasks, selectTodayProgress, selectTodayTasks } from '@/core/selectors'
import { actions, useStore, type StoreState } from '@/store/store'
import { CURRENT_VERSION, DEFAULT_SETTINGS, type PersistedState, type Task } from '@/store/types'

function at(year: number, month: number, day: number, hour = 9): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

function baseState(today: string): PersistedState {
  return {
    version: CURRENT_VERSION,
    tasks: [],
    snapshots: {},
    settings: { ...DEFAULT_SETTINGS },
    lastSettledDate: today,
    ui: { lastRolloverNotice: null, sortMode: 'manual', view: 'board', calendarMode: 'count', tagFilter: [], expandedCompletedDates: [] },
    updatedAt: at(2025, 6, 1).toISOString(),
  }
}

const state = (): StoreState => useStore.getState()
const today = (): string => logicalDateOf(clock.now(), state().settings.dayStartHour)
const titleOf = (id: string): string => state().tasks.find((t) => t.id === id)?.title ?? '??'
const idOf = (title: string): string => {
  const task = state().tasks.find((t) => t.title === title)
  if (!task) throw new Error(`找不到任务：${title}`)
  return task.id
}

beforeEach(() => {
  clock.reset()
  clock.travelTo(at(2025, 6, 1, 9))
  useStore.setState({
    ...baseState('2025-06-01'),
    hydrated: false,
    storageWarning: null,
    lastSettle: null,
  } as StoreState)
})

afterEach(() => {
  clock.reset()
})

describe('完整闭环：待办池 → 今日 → 完成归档 → 未完成顺延', () => {
  it('按需求 11.2 的脚本走一遍，每一步状态都正确', () => {
    /* --- 第 1 步：池中随手记 4 件事 --- */
    actions.addTask({ title: '写周报', priority: 'high', tags: ['工作'] })
    actions.addTask({ title: '跑步 5km' })
    actions.addTask({ title: '读《重构》' })
    actions.addTask({ title: '整理书桌' })

    expect(selectPoolTasks(state().tasks)).toHaveLength(4)
    expect(selectTodayTasks(state().tasks, today())).toHaveLength(0)

    /* --- 第 2 步：挑 3 件安排到今天 --- */
    actions.moveManyToToday([idOf('写周报'), idOf('跑步 5km'), idOf('读《重构》')])

    expect(selectTodayTasks(state().tasks, today())).toHaveLength(3)
    expect(selectPoolTasks(state().tasks).map((t) => t.title)).toEqual(['整理书桌'])
    expect(today()).toBe('2025-06-01')

    /* --- 第 3 步：完成 1 件，它应归档到「今天」--- */
    actions.toggleComplete(idOf('写周报'))

    const doneTask = state().tasks.find((t) => t.title === '写周报')
    expect(doneTask?.status).toBe('done')
    expect(doneTask?.completedDate).toBe('2025-06-01')
    // 活时钟：只比到分钟（见 README「已知偏差」）
    expect(doneTask?.completedAt?.slice(0, 16)).toBe(at(2025, 6, 1, 9).toISOString().slice(0, 16))

    expect(selectTodayTasks(state().tasks, '2025-06-01')).toHaveLength(2)
    expect(selectTodayProgress(state().tasks, '2025-06-01')).toEqual({
      total: 3,
      completed: 1,
      rate: 1 / 3,
    })

    /* --- 第 4 步：跨到第 2 天，未完成的 2 件自动顺延 --- */
    const day2 = actions.travelDays(1)
    expect(today()).toBe('2025-06-02')
    expect(day2.rolled.map((r) => r.title).sort()).toEqual(['跑步 5km', '读《重构》'].sort())

    const carried = selectTodayTasks(state().tasks, '2025-06-02')
    expect(carried).toHaveLength(2)
    expect(carried.every((t) => t.carryOverCount === 1)).toBe(true)

    // 已完成的那件不会被顺延，且仍然归在第 1 天
    expect(state().tasks.find((t) => t.title === '写周报')?.scheduledDate).toBe('2025-06-01')
    const groups = groupCompletedByDate(state().tasks)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ date: '2025-06-01' })
    expect(groups[0].tasks.map((t) => t.title)).toEqual(['写周报'])

    // 第 2 天的「已完成」是空的
    expect(groups.find((g) => g.date === '2025-06-02')).toBeUndefined()

    /* --- 第 5 步：连续跳 3 天，顺延次数累加为 4 --- */
    actions.travelDays(3)
    expect(today()).toBe('2025-06-05')
    const carried4 = selectTodayTasks(state().tasks, '2025-06-05')
    expect(carried4).toHaveLength(2)
    expect(carried4.map((t) => t.carryOverCount)).toEqual([4, 4])

    // 中间每一天都有快照，且第 1 天记录了顺延出 2 件
    expect(Object.keys(state().snapshots).sort()).toEqual([
      '2025-06-01',
      '2025-06-02',
      '2025-06-03',
      '2025-06-04',
    ])
    expect(state().snapshots['2025-06-01']).toMatchObject({ planned: 3, completed: 1 })

    /* --- 第 6 步：完成其中 2 件，完成记录归属当前逻辑日期 --- */
    const [first, second] = selectTodayTasks(state().tasks, '2025-06-05')
    actions.toggleComplete(first.id)
    actions.toggleComplete(second.id)

    expect(selectTodayProgress(state().tasks, '2025-06-05')).toEqual({
      total: 2,
      completed: 2,
      rate: 1,
    })
    for (const t of state().tasks.filter((x) => x.status === 'done')) {
      expect(t.completedDate).toBe(t.title === '写周报' ? '2025-06-01' : '2025-06-05')
    }

    /* --- 第 7 步：取消一个历史完成，回到今天且顺延次数不变 --- */
    actions.toggleComplete(idOf('写周报'))
    const revived = state().tasks.find((t) => t.title === '写周报')

    expect(revived?.status).toBe('today')
    expect(revived?.completedAt).toBeNull()
    expect(revived?.scheduledDate).toBe('2025-06-05')
    expect(revived?.carryOverCount).toBe(0) // 原本就没被顺延过，取消完成不应改变它
    expect(selectTodayTasks(state().tasks, '2025-06-05')).toHaveLength(1)
    expect(groupCompletedByDate(state().tasks).find((g) => g.date === '2025-06-01')).toBeUndefined()
  })

  it('「全部安排到今日」把池子清空，任务全部落到今天', () => {
    actions.addTask({ title: 'A' })
    actions.addTask({ title: 'B' })
    actions.addTask({ title: 'C' })

    actions.moveAllToToday()

    expect(selectPoolTasks(state().tasks)).toHaveLength(0)
    expect(selectTodayTasks(state().tasks, '2025-06-01')).toHaveLength(3)
  })

  it('删除后进入回收站，恢复后回到原来的位置', () => {
    actions.addTask({ title: '待删除' })
    const id = idOf('待删除')

    actions.deleteTask(id)
    expect(selectPoolTasks(state().tasks)).toHaveLength(0)
    expect(state().tasks.find((t) => t.id === id)?.status).toBe('trash')
    expect(state().tasks.find((t) => t.id === id)?.prevStatus).toBe('pool')

    actions.restoreTask(id)
    expect(state().tasks.find((t) => t.id === id)?.status).toBe('pool')
    expect(selectPoolTasks(state().tasks).map((t) => t.title)).toEqual(['待删除'])
  })

  it('顺延提示条只在发生顺延时出现，并可被关闭', () => {
    actions.addTask({ title: '拖着的任务', toToday: true })

    actions.travelDays(1)
    expect(state().ui.lastRolloverNotice).toMatchObject({ count: 1, date: '2025-06-02', dismissed: false })

    actions.dismissRolloverNotice()
    expect(state().ui.lastRolloverNotice?.dismissed).toBe(true)

    // 再跨一天：没有新的顺延对象吗？有的，仍是这 1 件 → 提示刷新
    actions.travelDays(1)
    expect(state().ui.lastRolloverNotice).toMatchObject({ count: 1, date: '2025-06-03' })
  })

  it('同一批任务重复结算不会让顺延次数翻倍', () => {
    actions.addTask({ title: 'X', toToday: true })

    actions.travelDays(1)
    expect(state().tasks[0].carryOverCount).toBe(1)

    // 模拟切窗口 / 心跳反复触发
    actions.runSettle()
    actions.runSettle()
    actions.runSettle()

    expect(state().tasks[0].carryOverCount).toBe(1)
    expect(titleOf(state().tasks[0].id)).toBe('X')
  })
})

describe('二级任务（FR-13）', () => {
  const childIds = (parentId: string): string[] =>
    state()
      .tasks.filter((t) => t.parentId === parentId && !t.deletedAt)
      .map((t) => t.id)
  const byTitle = (title: string): Task => {
    const task = state().tasks.find((t) => t.title === title)
    if (!task) throw new Error(`找不到任务：${title}`)
    return task
  }
  /** 顶层任务标题（子任务不算） */
  const titlesIn = (): string[] =>
    state()
      .tasks.filter((t) => !t.parentId && !t.deletedAt)
      .map((t) => t.title)

  it('新增子任务：继承父任务的安排，不进入顶层列表', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')

    actions.addSubtask(parentId, '开发进度')
    actions.addSubtask(parentId, '接口联调')

    expect(titlesIn()).toEqual(['用户权限开发']) // 子任务不单独出现
    expect(childIds(parentId)).toHaveLength(2)

    const child = byTitle('开发进度')
    expect(child.status).toBe('today')
    expect(child.scheduledDate).toBe(today())
    expect(child.carryOverCount).toBe(0)
  })

  it('子任务不单独计入今日完成进度', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')
    actions.addSubtask(parentId, '接口联调')

    // 只有 1 个顶层任务，所以分母是 1，不是 3
    expect(selectTodayProgress(state().tasks, today())).toEqual({
      total: 1,
      completed: 0,
      rate: 0,
    })
  })

  it('子任务全部完成 → 自动完成父任务（autoCompleteParent 开启时）', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')
    actions.addSubtask(parentId, '接口联调')

    actions.toggleComplete(idOf('开发进度'))
    expect(byTitle('用户权限开发').completedAt).toBeNull() // 还没全完成

    actions.toggleComplete(idOf('接口联调'))
    const parent = byTitle('用户权限开发')
    expect(parent.status).toBe('done')
    expect(parent.completedDate).toBe(today())
  })

  it('关掉 autoCompleteParent 时父任务保持未完成', () => {
    actions.setSettings({ autoCompleteParent: false })
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')

    actions.toggleComplete(idOf('开发进度'))
    expect(byTitle('用户权限开发').status).toBe('today')
  })

  it('勾选父任务会连带完成所有子任务', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')
    actions.addSubtask(parentId, '接口联调')

    actions.toggleComplete(parentId)

    expect(byTitle('用户权限开发').status).toBe('done')
    for (const id of childIds(parentId)) {
      expect(state().tasks.find((t) => t.id === id)?.completedAt).not.toBeNull()
    }
  })

  it('取消某个子任务会同时把父任务恢复成未完成', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')
    actions.toggleComplete(parentId) // 全员完成
    expect(byTitle('用户权限开发').status).toBe('done')

    actions.toggleComplete(idOf('开发进度'))

    expect(byTitle('用户权限开发').status).toBe('today')
    expect(byTitle('开发进度').completedAt).toBeNull()
  })

  it('★ 子任务不参与顺延：跨天时跟随父任务，carryOverCount 不会被累加', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')
    actions.addSubtask(parentId, '接口联调')

    actions.travelDays(3)

    const parent = byTitle('用户权限开发')
    expect(parent.carryOverCount).toBe(3)
    expect(parent.scheduledDate).toBe('2025-06-04')

    for (const title of ['开发进度', '接口联调']) {
      const child = byTitle(title)
      expect(child.scheduledDate).toBe('2025-06-04') // 跟着父任务走
      expect(child.carryOverCount).toBe(0) // 但不累加自己的顺延次数
      expect(child.lastRolledAt).toBeNull()
    }

    // 顺延提示里只应出现父任务，不该把子任务也算成「一个没完成的任务」
    expect(state().ui.lastRolloverNotice?.taskIds).toEqual([parentId])
  })

  it('把父任务退回待办池时子任务一起跟随', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')

    actions.moveToPool(parentId)

    expect(byTitle('用户权限开发').scheduledDate).toBeNull()
    expect(byTitle('开发进度').scheduledDate).toBeNull()
    expect(byTitle('开发进度').status).toBe('pool')
  })

  it('删除父任务会连同子任务一起进回收站，恢复时一起回来', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.addSubtask(parentId, '开发进度')

    actions.deleteTask(parentId)
    expect(childIds(parentId)).toHaveLength(0) // 未删除的子任务为 0
    expect(state().tasks.filter((t) => t.parentId === parentId && t.deletedAt)).toHaveLength(1)

    actions.restoreTask(parentId)
    expect(byTitle('用户权限开发').deletedAt).toBeNull()
    expect(childIds(parentId)).toHaveLength(1)
  })

  it('给已完成的父任务加子任务 → 父任务重新变成未完成', () => {
    actions.addTask({ title: '用户权限开发', toToday: true })
    const parentId = idOf('用户权限开发')
    actions.toggleComplete(parentId)
    expect(byTitle('用户权限开发').status).toBe('done')

    actions.addSubtask(parentId, '补充用例')

    const parent = byTitle('用户权限开发')
    expect(parent.status).toBe('today')
    expect(parent.completedAt).toBeNull()
    expect(parent.scheduledDate).toBe(today())
  })
})
