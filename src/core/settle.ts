/**
 * settle.ts —— 结算与顺延（需求文档 6.2，核心算法）
 *
 * 幂等性保证：同一天重复调用（切窗口、刷新、每分钟心跳）不会产生任何副作用。
 * 跨天时逐日推演，保证中间每一天都留下正确的 DaySnapshot。
 *
 * ⚠️ 本文件不得直接调用 new Date()，时间一律由调用方传入。
 */

import { produce } from 'immer'
import type { DaySnapshot, PersistedState, Settings, Task } from '@/store/types'
import { MS_PER_DAY, addDays, diffDays, logicalDateOf } from './date'

/** 回收站保留天数，超期物理删除（FR-10） */
export const PURGE_AFTER_DAYS = 30

/** 逐日推演的安全上限，防止脏数据导致死循环 */
const MAX_CATCHUP_DAYS = 3650

export interface RolledInfo {
  id: string
  title: string
  /** 顺延后的累计次数 */
  carryOverCount: number
  /** 原本安排在哪一天 */
  from: string
  /** 顺延到哪一天 */
  to: string
}

export interface SettleResult {
  /** 结算后的逻辑日期 */
  today: string
  changed: boolean
  /** 被顺延到今天的任务 */
  rolled: RolledInfo[]
  /** 按策略退回待办池的任务 */
  returnedToPool: RolledInfo[]
  /** 被物理清除（回收站超期）的任务 id */
  purgedIds: string[]
  /** 本次写入快照的日期 */
  snapshotsWritten: string[]
  /** 策略为 ask 时，等待用户决定去向的任务 id */
  pendingAskIds: string[]
}

function emptyResult(today: string): SettleResult {
  return {
    today,
    changed: false,
    rolled: [],
    returnedToPool: [],
    purgedIds: [],
    snapshotsWritten: [],
    pendingAskIds: [],
  }
}

/**
 * 是否应退回待办池而不是继续顺延。
 * - pinned-only 策略：非「必做」任务退回池中
 * - 设置了顺延上限：超过上限退回池中
 * carryOverCount 传**累加之后**的值。
 */
export function shouldReturnToPool(
  task: Pick<Task, 'pinned'>,
  settings: Pick<Settings, 'rolloverStrategy' | 'rolloverMaxDays'>,
  carryOverCount: number,
): boolean {
  if (settings.rolloverStrategy === 'pinned-only' && !task.pinned) return true
  if (settings.rolloverMaxDays > 0 && carryOverCount > settings.rolloverMaxDays) return true
  return false
}

/** 未完成、未删除、仍然挂在「今日」上的**顶层**任务。子任务不参与结算，跟随父任务。 */
function isOpenTodayTask(task: Task): boolean {
  return (
    !task.parentId &&
    task.status === 'today' &&
    !task.completedAt &&
    !task.deletedAt &&
    !!task.scheduledDate
  )
}

/**
 * FR-13：子任务不独立顺延，跟随父任务的去向。
 * 只同步「安排到哪一天 / 状态」，不动子任务自己的完成时间与顺延次数。
 */
function syncChildrenPlacement(tasks: Task[], parent: Task, nowIso: string): void {
  for (const child of tasks) {
    if (child.parentId !== parent.id || child.deletedAt) continue
    child.scheduledDate = parent.scheduledDate
    if (!child.completedAt) child.status = parent.status
    child.updatedAt = nowIso
  }
}

/** 把任务推进到 target 日，并累加顺延次数。返回被记录的信息。 */
function rollTask(
  task: Task,
  target: string,
  nowIso: string,
  settings: Settings,
): { kind: 'rolled' | 'pool' | 'ask'; info: RolledInfo } {
  const from = task.scheduledDate as string
  const days = Math.max(1, diffDays(from, target))

  if (settings.rolloverStrategy === 'ask') {
    // ask 策略：保持原样，等待用户在下次启动时决定（边界条件 #12）
    return {
      kind: 'ask',
      info: { id: task.id, title: task.title, carryOverCount: task.carryOverCount, from, to: target },
    }
  }

  task.carryOverCount += days
  task.lastRolledAt = nowIso
  task.updatedAt = nowIso

  if (shouldReturnToPool(task, settings, task.carryOverCount)) {
    task.scheduledDate = null
    task.status = 'pool'
    return {
      kind: 'pool',
      info: { id: task.id, title: task.title, carryOverCount: task.carryOverCount, from, to: target },
    }
  }

  task.scheduledDate = target
  return {
    kind: 'rolled',
    info: { id: task.id, title: task.title, carryOverCount: task.carryOverCount, from, to: target },
  }
}

/** 统计某一天的快照 */
function buildSnapshot(
  tasks: Task[],
  date: string,
  carriedOutIds: string[],
  returnedToPoolIds: string[],
): DaySnapshot {
  const completedTaskIds = tasks
    .filter((t) => !t.parentId && t.completedDate === date && t.status === 'done')
    .map((t) => t.id)

  const planned = new Set<string>([...completedTaskIds, ...carriedOutIds, ...returnedToPoolIds])
  // 当天被排在今日列表上的任务（含跨天补记的完成、以及兜住脏数据的未完成项）
  for (const t of tasks) {
    if (!t.parentId && !t.deletedAt && t.scheduledDate === date) planned.add(t.id)
  }

  return {
    date,
    planned: planned.size,
    completed: completedTaskIds.length,
    completedTaskIds,
    carriedOutIds,
    returnedToPoolIds,
    completionRate: planned.size > 0 ? completedTaskIds.length / planned.size : 0,
  }
}

/**
 * 在 immer draft 上执行结算。直接修改 draft，并把过程信息写入 result。
 * 供 store 与单元测试共用；外部请优先使用 settle()。
 */
export function applySettle(draft: PersistedState, now: Date): SettleResult {
  const settings = draft.settings
  const today = logicalDateOf(now, settings.dayStartHour)
  const nowIso = now.toISOString()
  const result = emptyResult(today)
  const pendingAsk = new Set<string>()
  /**
   * 逐日推演时同一个任务会被推好几次（跨 3 天就顺手推 3 次），
   * 直接 push 会让「顺延提示」报成「有 3 个任务没完成」。这里按 id 去重，
   * 保留最后一次（也就是最终落到哪一天）。
   */
  const rolledById = new Map<string, RolledInfo>()
  const finalize = (): SettleResult => {
    result.rolled = [...rolledById.values()]
    result.pendingAskIds = [...pendingAsk]
    return result
  }

  /* ---------- 0. 回收站超期清理（边界条件：超过 30 天物理删除） ---------- */
  const purgeCutoff = now.getTime() - PURGE_AFTER_DAYS * MS_PER_DAY
  draft.tasks = draft.tasks.filter((task) => {
    if (!task.deletedAt) return true
    const ts = new Date(task.deletedAt).getTime()
    if (Number.isNaN(ts) || ts >= purgeCutoff) return true
    result.purgedIds.push(task.id)
    result.changed = true
    return false
  })

  /* ---------- 1. 处理异常数据：把落后的任务推到今天（不写快照） ---------- */
  const sweepStale = (): void => {
    for (const task of draft.tasks) {
      if (!isOpenTodayTask(task)) continue
      const scheduled = task.scheduledDate as string
      if (scheduled >= today) continue

      const { kind, info } = rollTask(task, today, nowIso, settings)
      if (kind === 'ask') {
        pendingAsk.add(task.id)
      } else if (kind === 'pool') {
        result.returnedToPool.push(info)
        rolledById.delete(task.id)
      } else {
        rolledById.set(task.id, info)
      }
      // FR-13：子任务跟着父任务走
      syncChildrenPlacement(draft.tasks, task, nowIso)
      result.changed = true
    }
  }

  const cursorStart = draft.lastSettledDate

  // 首次使用：只初始化游标
  if (!cursorStart) {
    draft.lastSettledDate = today
    draft.updatedAt = nowIso
    result.changed = true
    return finalize()
  }

  // 幂等出口：同一天重复调用只做补漏扫描，不产生快照、不重复累加
  if (cursorStart === today) {
    sweepStale()
    if (result.changed) draft.updatedAt = nowIso
    return finalize()
  }

  // 系统时间被回拨（边界条件 #2）：不回滚数据，也不推进游标。
  // 但仍要补漏：把「已经逾期却还挂在今日」的任务拉到今天，否则它们会
  // 同时不属于今日待办（日期不等于今天）也不属于待办池（status 不是 pool），
  // 变成界面上完全看不见的幽灵任务。
  if (cursorStart > today) {
    sweepStale()
    if (result.changed) draft.updatedAt = nowIso
    return finalize()
  }

  /* ---------- 2. 逐日推演 ---------- */
  let cursor = cursorStart
  let guard = 0

  while (cursor < today && guard < MAX_CATCHUP_DAYS) {
    guard += 1
    const next = addDays(cursor, 1)
    const carriedOutIds: string[] = []
    const returnedToPoolIds: string[] = []

    for (const task of draft.tasks) {
      if (!isOpenTodayTask(task)) continue
      const scheduled = task.scheduledDate as string
      // 只处理「截止到 cursor 这一天仍未完成」的任务
      if (scheduled > cursor) continue

      const { kind, info } = rollTask(task, next, nowIso, settings)
      if (kind === 'ask') {
        pendingAsk.add(task.id)
        continue
      }
      if (kind === 'pool') {
        returnedToPoolIds.push(task.id)
        result.returnedToPool.push(info)
        rolledById.delete(task.id)
      } else {
        carriedOutIds.push(task.id)
        rolledById.set(task.id, info)
      }
      // FR-13：子任务跟着父任务走
      syncChildrenPlacement(draft.tasks, task, nowIso)
      result.changed = true
    }

    draft.snapshots[cursor] = buildSnapshot(draft.tasks, cursor, carriedOutIds, returnedToPoolIds)
    result.snapshotsWritten.push(cursor)
    result.changed = true
    cursor = next
  }

  draft.lastSettledDate = today

  /* ---------- 3. 兜底：游标已推进，但仍可能存在落后任务 ---------- */
  sweepStale()

  /* ---------- 4. 顺延提示（FR-06） ---------- */
  // 注意用 rolledById 而不是 result.rolled —— 后者要到 finalize() 才赋值，
  // 而且去重后的「任务件数」才是用户看到的真实数字（跨 3 天不等于 3 个任务）。
  if (settings.showRolloverNotice && rolledById.size > 0) {
    draft.ui.lastRolloverNotice = {
      count: rolledById.size,
      taskIds: [...rolledById.keys()],
      dismissed: false,
      date: today,
    }
  } else if (draft.ui.lastRolloverNotice && draft.ui.lastRolloverNotice.date !== today) {
    // 昨天的提示不该留到今天
    draft.ui.lastRolloverNotice = null
  }

  draft.updatedAt = nowIso
  return finalize()
}

/**
 * 纯函数入口：返回新的 state 与结算结果，不修改入参。
 * store 与单测都走这里。
 */
export function settle(
  state: PersistedState,
  now: Date,
): { state: PersistedState; result: SettleResult } {
  let result = emptyResult(logicalDateOf(now, state.settings.dayStartHour))
  const nextState = produce(state, (draft) => {
    result = applySettle(draft, now)
  })
  return { state: nextState, result }
}
