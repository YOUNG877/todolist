/**
 * selectors.ts —— 派生数据（纯函数，方便单测与记忆化）
 * 组件只允许通过这些选择器拿数据，不要在组件里重算业务规则。
 */

import type { DaySnapshot, Priority, SortMode, Task } from '@/store/types'
import { PRIORITY_WEIGHT } from '@/store/types'
import { addDays, diffDays } from './date'

/**
 * 子任务（FR-13）：`parentId` 指向父任务。
 * 它们跟随父任务显示、不单独进入统计，所以下面所有「计数 / 归档 / 日历」类选择器
 * 都必须把它们排除掉，否则完成率会被子步骤撑爆。
 */
export function isSubtask(task: Pick<Task, 'parentId'>): boolean {
  return !!task.parentId
}

/** 任务树节点：一个顶层任务 + 它的子任务 */
export interface TaskNode {
  task: Task
  children: Task[]
}

/**
 * 把「顶层任务列表」和「全部任务」组装成树。
 * - 子任务按 order 排序挂在父任务下
 * - 父任务不在 allTasks 里的孤儿子任务会被提升为顶层，避免凭空消失
 */
export function buildTaskTree(topLevel: Task[], allTasks: Task[]): TaskNode[] {
  const childrenByParent = new Map<string, Task[]>()
  const topIds = new Set(topLevel.map((t) => t.id))

  for (const t of allTasks) {
    if (!t.parentId || t.deletedAt) continue
    const list = childrenByParent.get(t.parentId)
    if (list) list.push(t)
    else childrenByParent.set(t.parentId, [t])
  }

  const knownIds = new Set(allTasks.map((t) => t.id))
  const sortByOrder = (a: Task, b: Task): number => a.order - b.order

  const nodes: TaskNode[] = topLevel.map((task) => ({
    task,
    children: (childrenByParent.get(task.id) ?? []).sort(sortByOrder),
  }))

  // 孤儿兜底：父任务已不在任何列表里，就把子任务当顶层显示出来
  for (const [parentId, children] of childrenByParent) {
    if (topIds.has(parentId) || knownIds.has(parentId)) continue
    for (const child of children) nodes.push({ task: child, children: [] })
  }

  return nodes
}

/** 父任务的子任务完成进度，供「2/5」角标使用 */
export function childProgress(node: TaskNode): { done: number; total: number } {
  const total = node.children.length
  const done = node.children.filter((c) => !!c.completedAt).length
  return { done, total }
}

/** 该任务是否还有未完成的子任务 */
export function hasOpenChildren(node: TaskNode): boolean {
  return node.children.some((c) => !c.completedAt)
}

/** 已完成的当日列表顺序：手动 order */
export function sortManual(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.order - b.order)
}

export function sortByMode(tasks: Task[], mode: SortMode): Task[] {
  const list = [...tasks]
  switch (mode) {
    case 'priority':
      return list.sort(
        (a, b) =>
          PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || a.order - b.order,
      )
    case 'due':
      return list.sort((a, b) => {
        if (a.dueDate === b.dueDate) return a.order - b.order
        if (!a.dueDate) return 1
        if (!b.dueDate) return -1
        return a.dueDate < b.dueDate ? -1 : 1
      })
    case 'created':
      return list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    case 'manual':
    default:
      return sortManual(list)
  }
}

/** 关联到某一天的「今日待办」（只返回顶层任务，子任务由 buildTaskTree 挂上去） */
export function selectTodayTasks(tasks: Task[], today: string): Task[] {
  return sortManual(
    tasks.filter(
      (t) =>
        !t.parentId &&
        t.status === 'today' &&
        !t.deletedAt &&
        !t.completedAt &&
        t.scheduledDate === today,
    ),
  )
}

/** 提前排到未来某天的任务（FR-03 场景，界面上单列为「已排期」） */
export function selectScheduledFuture(tasks: Task[], today: string): Task[] {
  return sortManual(
    tasks.filter(
      (t) =>
        !t.parentId &&
        t.status === 'today' &&
        !t.deletedAt &&
        !t.completedAt &&
        !!t.scheduledDate &&
        t.scheduledDate > today,
    ),
  )
}

/** 待办池：想做但还没安排到任何一天 */
export function selectPoolTasks(tasks: Task[]): Task[] {
  return sortManual(
    tasks.filter((t) => !t.parentId && t.status === 'pool' && !t.deletedAt && !t.completedAt),
  )
}

export interface CompletedGroup {
  date: string
  tasks: Task[]
}

/** completedDate → 该天完成的任务（已完成任务按完成时间倒序）。日历按日期查表用。 */
export function mapCompletedByDate(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    // 子任务只算父任务的一部分，不单独进日历，避免和父任务重复计数
    if (t.parentId || t.status !== 'done' || t.deletedAt || !t.completedDate) continue
    const list = map.get(t.completedDate)
    if (list) list.push(t)
    else map.set(t.completedDate, [t])
  }
  for (const list of map.values()) {
    list.sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1))
  }
  return map
}

/** 已完成任务按 completedDate 倒序分组 */
export function groupCompletedByDate(tasks: Task[]): CompletedGroup[] {  const map = new Map<string, Task[]>()
  for (const t of tasks) {
    if (t.status !== 'done' || t.deletedAt || !t.completedDate) continue
    const list = map.get(t.completedDate)
    if (list) list.push(t)
    else map.set(t.completedDate, [t])
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({
      date,
      // 同一天内按完成时间倒序，最新的在最上面
      tasks: [...list].sort((a, b) => ((a.completedAt ?? '') < (b.completedAt ?? '') ? 1 : -1)),
    }))
}

export interface Progress {
  total: number
  completed: number
  rate: number
}

/** 今日完成率（FR-04 / FR-15）—— 只统计顶层任务，子任务不单独计入 */
export function selectTodayProgress(tasks: Task[], today: string): Progress {
  const open = selectTodayTasks(tasks, today).length
  const done = tasks.filter(
    (t) => !t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate === today,
  ).length
  const total = open + done
  return { total, completed: done, rate: total > 0 ? done / total : 0 }
}

export function selectTotalEstimatedMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimateMinutes ?? 0), 0)
}

/** 回收站列表 */
export function selectTrash(tasks: Task[]): Task[] {
  return [...tasks]
    .filter((t) => t.status === 'trash')
    .sort((a, b) => ((a.deletedAt ?? '') < (b.deletedAt ?? '') ? 1 : -1))
}

/** 某一天完成了多少（优先用实时数据，历史日期用快照兜底）。子任务不单独计数。 */
export function completedCountOn(tasks: Task[], snapshots: Record<string, DaySnapshot>, date: string): number {
  const live = tasks.filter(
    (t) => !t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate === date,
  ).length
  if (live > 0) return live
  return snapshots[date]?.completed ?? 0
}

/** 连续完成天数（FR-15 卡片 3） */
export function selectStreak(
  tasks: Task[],
  snapshots: Record<string, DaySnapshot>,
  today: string,
): { current: number; best: number } {
  const hasCompletion = (date: string): boolean => completedCountOn(tasks, snapshots, date) > 0

  // 今天还没完成不算断签，从昨天开始算
  let cursor = hasCompletion(today) ? today : addDays(today, -1)
  let current = 0
  while (hasCompletion(cursor) && current < 3650) {
    current += 1
    cursor = addDays(cursor, -1)
  }

  // 历史最长：从所有有记录的日期里找最长连续段
  const known = new Set<string>(Object.keys(snapshots))
  for (const t of tasks) if (t.completedDate) known.add(t.completedDate)
  const days = [...known].filter(hasCompletion).sort()
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const d of days) {
    if (prev && diffDays(prev, d) === 1) run += 1
    else run = 1
    best = Math.max(best, run)
    prev = d
  }

  return { current, best: Math.max(best, current) }
}

/** 近 N 天的完成数，供柱状图使用（FR-15 卡片 2） */
export function selectRecentDays(
  tasks: Task[],
  snapshots: Record<string, DaySnapshot>,
  today: string,
  days = 7,
): Array<{ date: string; completed: number; planned: number }> {
  const out: Array<{ date: string; completed: number; planned: number }> = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i)
    out.push({
      date,
      completed: completedCountOn(tasks, snapshots, date),
      planned: snapshots[date]?.planned ?? 0,
    })
  }
  return out
}

/** 最会拖的 Top N（FR-15 卡片 4） */
export function selectTopCarryOver(tasks: Task[], n = 5): Task[] {
  return [...tasks]
    .filter((t) => !t.parentId && !t.deletedAt && t.carryOverCount > 0)
    .sort((a, b) => b.carryOverCount - a.carryOverCount)
    .slice(0, n)
}

/** 标签统计，供筛选与自动补全 */
export function selectAllTags(tasks: Task[]): string[] {
  const set = new Set<string>()
  for (const t of tasks) if (!t.deletedAt) for (const tag of t.tags) set.add(tag)
  return [...set].sort()
}

export const PRIORITY_ORDER: Priority[] = ['high', 'medium', 'low', 'none']

/* -------------------------------------------------------------------------- */
/* 月历（FR-16）                                                               */
/* -------------------------------------------------------------------------- */

/** 日历热力等级：0 无完成，4 全部完成 */
export type HeatLevel = 0 | 1 | 2 | 3 | 4

/**
 * 有快照时按**完成率**分档（需求 FR-16 要求），没有快照时退化为按完成件数分档。
 */
export function heatLevelOf(completed: number, planned: number): HeatLevel {
  if (completed <= 0) return 0
  if (planned <= 0) {
    if (completed >= 6) return 4
    if (completed >= 4) return 3
    if (completed >= 2) return 2
    return 1
  }
  const rate = completed / planned
  if (rate >= 1) return 4
  if (rate >= 0.67) return 3
  if (rate >= 0.34) return 2
  return 1
}

/** 某个月的完成汇总，用于月历页脚 */
export function selectMonthStats(
  tasks: Task[],
  snapshots: Record<string, DaySnapshot>,
  monthCursor: string,
): { completed: number; activeDays: number } {
  const prefix = monthCursor.slice(0, 7)
  const dates = new Set<string>()
  for (const t of tasks) {
    if (!t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate?.startsWith(prefix)) {
      dates.add(t.completedDate)
    }
  }
  for (const [date, snap] of Object.entries(snapshots)) {
    if (date.startsWith(prefix) && snap.completed > 0) dates.add(date)
  }
  let completed = 0
  for (const date of dates) completed += completedCountOn(tasks, snapshots, date)
  return { completed, activeDays: dates.size }
}
