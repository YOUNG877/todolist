/**
 * store.ts —— 全局状态（Zustand + Immer）
 *
 * 约定：
 *  - state 里只有数据，没有方法；所有写操作是下面的 actions
 *  - 所有写操作统一走 immer，保证引用变化最小化
 *  - 持久化由 subscribe 驱动，用 `updatedAt` 作为「数据真的变了」的闸门
 */

import { produce } from 'immer'
import { create } from 'zustand'
import { clock } from '@/core/clock'
import { addDays, logicalDateOf } from '@/core/date'
import { createId } from '@/core/id'
import { moveToIndex } from '@/core/order'
import { settle, type SettleResult } from '@/core/settle'
import {
  clearStorage,
  createInitialState,
  flushSave,
  loadState,
  normalizeState,
  saveState,
  STORAGE_KEY,
} from './persist'
import type {
  CalendarMode,
  PersistedState,
  Priority,
  Settings,
  SortMode,
  Task,
  TaskStatus,
  ViewMode,
} from './types'

export interface StoreState extends PersistedState {
  hydrated: boolean
  storageWarning: string | null
  /** 最近一次结算的过程信息（调试面板与顺延提示使用） */
  lastSettle: SettleResult | null
}

export function toPersisted(state: PersistedState): PersistedState {
  return {
    version: state.version,
    tasks: state.tasks,
    snapshots: state.snapshots,
    settings: state.settings,
    lastSettledDate: state.lastSettledDate,
    ui: state.ui,
    updatedAt: state.updatedAt,
  }
}

export const useStore = create<StoreState>()(() => ({
  ...createInitialState(),
  hydrated: false,
  storageWarning: null,
  lastSettle: null,
}))

/* -------------------------------------------------------------------------- */
/* 持久化：用 updatedAt 作为闸门，纯 UI 变化（如切换 Tab）不写盘               */
/* -------------------------------------------------------------------------- */

let lastSavedUpdatedAt: string | null = null

useStore.subscribe((state) => {
  if (!state.hydrated) return
  if (state.updatedAt === lastSavedUpdatedAt) return
  lastSavedUpdatedAt = state.updatedAt
  saveState(toPersisted(state))
})

let storageSyncInstalled = false
function installStorageSync(): void {
  if (storageSyncInstalled || typeof globalThis.addEventListener !== 'function') return
  storageSyncInstalled = true

  globalThis.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return
    try {
      const external = normalizeState(JSON.parse(event.newValue), clock.now())
      if (!external) return
      // 跨标签页：以较新者为准（需求 6.5）
      const local = useStore.getState()
      if (external.updatedAt <= local.updatedAt) return
      lastSavedUpdatedAt = external.updatedAt
      useStore.setState({ ...external })
    } catch {
      /* 忽略其他标签页的脏数据 */
    }
  })

  const flush = (): void => flushSave()
  globalThis.addEventListener('beforeunload', flush)
  globalThis.addEventListener('pagehide', flush)
  globalThis.document?.addEventListener('visibilitychange', () => {
    if (globalThis.document.visibilityState === 'hidden') flush()
  })
}

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function nextOrder(tasks: Task[], status: TaskStatus, scheduledDate: string | null): number {
  const peers = tasks.filter(
    (t) =>
      t.status === status &&
      !t.deletedAt &&
      (status !== 'today' || t.scheduledDate === scheduledDate),
  )
  return peers.reduce((max, t) => Math.max(max, t.order), 0) + 1
}

export interface NewTaskInput {
  title: string
  note?: string
  priority?: Priority
  tags?: string[]
  dueDate?: string | null
  estimateMinutes?: number | null
  pinned?: boolean
  /** true = 直接安排到今天的今日列表 */
  toToday?: boolean
}

function buildTask(input: NewTaskInput, tasks: Task[], now: Date, today: string): Task {
  const toToday = input.toToday ?? false
  return {
    id: createId(),
    title: input.title.trim(),
    note: input.note,
    status: toToday ? 'today' : 'pool',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    scheduledDate: toToday ? today : null,
    completedAt: null,
    completedDate: null,
    deletedAt: null,
    priority: input.priority ?? 'none',
    tags: input.tags ?? [],
    dueDate: input.dueDate ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    pinned: input.pinned ?? false,
    carryOverCount: 0,
    lastRolledAt: null,
    order: nextOrder(tasks, toToday ? 'today' : 'pool', toToday ? today : null),
    parentId: null,
    recurringId: null,
  }
}

/* -------------------------------------------------------------------------- */
/* 子任务（FR-13）辅助                                                          */
/* -------------------------------------------------------------------------- */

/** 某个任务的所有未删除子任务 */
function childrenOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parentId === parentId && !t.deletedAt)
}

/**
 * 某个任务的**全部**子任务，含已在回收站的。
 * 恢复 / 彻底删除必须用它：那时候子任务自己也带着 deletedAt，
 * 用 childrenOf 会一个都匹配不到，级联就静默失效了。
 */
function allChildrenOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((t) => t.parentId === parentId)
}

/**
 * 父任务的子任务全部完成时，自动把父任务也标记完成。
 * 只在「子任务被勾选完成」这个事件里调用，因此用户手动取消父任务后不会被立刻重新勾上。
 */
function maybeAutoCompleteParent(
  draft: StoreState,
  parentId: string,
  now: Date,
  today: string,
): void {
  if (!draft.settings.autoCompleteParent) return
  const parent = draft.tasks.find((t) => t.id === parentId)
  if (!parent || parent.deletedAt || parent.completedAt) return

  const children = childrenOf(draft.tasks, parentId)
  if (children.length === 0) return
  if (!children.every((c) => !!c.completedAt)) return

  parent.completedAt = now.toISOString()
  parent.completedDate = today
  parent.status = 'done'
  parent.updatedAt = now.toISOString()
}

/** 把父任务的安排（日期 / 状态）同步给子任务，避免父子分居两个列表 */
function syncChildren(draft: StoreState, parent: Task, nowIso: string): void {
  for (const child of draft.tasks) {
    if (child.parentId !== parent.id || child.deletedAt) continue
    child.scheduledDate = parent.scheduledDate
    if (!child.completedAt) child.status = parent.status === 'done' ? 'today' : parent.status
    child.updatedAt = nowIso
  }
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export const actions = {
  /** 应用启动：读盘 → 结构校验 → 结算 → 落盘 */
  init(): void {
    if (useStore.getState().hydrated) return
    const now = clock.now()
    const { state, warning } = loadState(now)
    const base = state ?? createInitialState(now)
    const { state: settled, result } = settle(base, now)
    lastSavedUpdatedAt = settled.updatedAt
    useStore.setState({
      ...settled,
      hydrated: true,
      storageWarning: warning,
      lastSettle: result,
    })
    saveState(settled)
    installStorageSync()
  },

  /** 幂等结算：启动、窗口重获焦点、每分钟心跳都调用它 */
  runSettle(): SettleResult {
    const state = useStore.getState()
    const now = clock.now()
    const { state: next, result } = settle(toPersisted(state), now)
    if (result.changed) {
      useStore.setState({ ...next, lastSettle: result })
      lastSavedUpdatedAt = null // 强制落盘
    } else {
      useStore.setState({ lastSettle: result })
    }
    return result
  },

  addTask(input: NewTaskInput): string | null {
    const title = input.title.trim()
    if (!title) return null
    const now = clock.now()
    const current = useStore.getState()
    const today = logicalDateOf(now, current.settings.dayStartHour)
    // 先在 immer 之外构造好完整任务，避免在 recipe 里做有副作用的计算
    const task = buildTask({ ...input, title }, current.tasks, now, today)
    useStore.setState(
      produce((draft: StoreState) => {
        draft.tasks.push(task)
        draft.updatedAt = now.toISOString()
      }),
    )
    return task.id
  },

  updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const task = draft.tasks.find((t) => t.id === id)
        if (!task) return
        Object.assign(task, patch)
        if (patch.title !== undefined) task.title = patch.title.trim()
        if (task.estimateMinutes !== null && task.estimateMinutes !== undefined) {
          task.estimateMinutes = Math.max(5, Math.round(task.estimateMinutes))
        }
        task.updatedAt = now.toISOString()
        draft.updatedAt = now.toISOString()
      }),
    )
  },

  /**
   * 新增二级任务（FR-13）。子任务继承父任务的安排，并排在已有子任务之后。
   * 如果父任务已经完成，说明它其实还没做完，顺手恢复成未完成。
   */
  addSubtask(parentId: string, title: string): string | null {
    const trimmed = title.trim()
    if (!trimmed) return null
    const now = clock.now()
    const current = useStore.getState()
    const parent = current.tasks.find((t) => t.id === parentId && !t.deletedAt)
    if (!parent) return null

    const today = logicalDateOf(now, current.settings.dayStartHour)
    const nowIso = now.toISOString()
    const order =
      childrenOf(current.tasks, parentId).reduce((max, t) => Math.max(max, t.order), 0) + 1

    const child: Task = {
      id: createId(),
      title: trimmed,
      status: parent.status === 'done' || parent.status === 'trash' ? 'today' : parent.status,
      createdAt: nowIso,
      updatedAt: nowIso,
      scheduledDate: parent.scheduledDate ?? (parent.status === 'pool' ? null : today),
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
      order,
      parentId,
      recurringId: null,
    }

    useStore.setState(
      produce((draft: StoreState) => {
        draft.tasks.push(child)
        // 给已完成的父任务加了个还没做的子任务 → 它不再算完成
        if (parent.completedAt) {
          const p = draft.tasks.find((t) => t.id === parentId)
          if (p) {
            p.completedAt = null
            p.completedDate = null
            p.scheduledDate = today
            p.status = 'today'
            p.order = nextOrder(draft.tasks, 'today', today)
            p.updatedAt = nowIso
          }
        }
        draft.updatedAt = nowIso
      }),
    )
    return child.id
  },

  /** 勾选 / 取消勾选（FR-05 / FR-07 / FR-13） */
  toggleComplete(id: string): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const task = draft.tasks.find((t) => t.id === id)
        if (!task || task.deletedAt) return
        const today = logicalDateOf(now, draft.settings.dayStartHour)
        const nowIso = now.toISOString()

        if (task.completedAt) {
          /* ---- 取消完成 ---- */
          task.completedAt = null
          task.completedDate = null

          if (task.parentId) {
            // 子任务：安排跟随父任务，不要自己跳到今天
            const parent = draft.tasks.find((t) => t.id === task.parentId)
            task.scheduledDate = parent?.scheduledDate ?? today
            task.status = parent && parent.status !== 'pool' ? 'today' : (parent?.status ?? 'today')
            // 子任务被取消 → 父任务不可能「全部完成」
            if (parent && parent.completedAt) {
              parent.completedAt = null
              parent.completedDate = null
              parent.scheduledDate = today
              parent.status = 'today'
              parent.order = nextOrder(draft.tasks, 'today', today)
              parent.updatedAt = nowIso
            }
          } else {
            task.scheduledDate = today
            task.status = 'today'
            task.order = nextOrder(draft.tasks, 'today', today)
          }
        } else {
          /* ---- 勾选完成 ---- */
          task.completedAt = nowIso
          task.completedDate = today
          task.status = 'done'

          if (task.parentId) {
            maybeAutoCompleteParent(draft, task.parentId, now, today)
          } else {
            // 完成父任务 → 未完成的子任务一并完成
            for (const child of childrenOf(draft.tasks, task.id)) {
              if (child.completedAt) continue
              child.completedAt = nowIso
              child.completedDate = today
              child.status = 'done'
              child.updatedAt = nowIso
            }
          }
        }

        task.updatedAt = nowIso
        draft.updatedAt = nowIso
      }),
    )
  },

  moveToToday(id: string): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const task = draft.tasks.find((t) => t.id === id)
        if (!task || task.deletedAt || task.completedAt) return
        const today = logicalDateOf(now, draft.settings.dayStartHour)
        // 提前执行未来排期的任务不算顺延
        task.scheduledDate = today
        task.status = 'today'
        task.order = nextOrder(draft.tasks, 'today', today)
        task.updatedAt = now.toISOString()
        // 子任务跟着父任务一起进今日
        syncChildren(draft, task, now.toISOString())
        draft.updatedAt = now.toISOString()
      }),
    )
  },

  moveManyToToday(ids: string[]): void {
    if (ids.length === 0) return
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const today = logicalDateOf(now, draft.settings.dayStartHour)
        const nowIso = now.toISOString()
        let order = nextOrder(draft.tasks, 'today', today)
        for (const id of ids) {
          const task = draft.tasks.find((t) => t.id === id)
          // 子任务不单独安排，跟着父任务走
          if (!task || task.deletedAt || task.completedAt || task.parentId) continue
          task.scheduledDate = today
          task.status = 'today'
          task.order = order
          order += 1
          task.updatedAt = nowIso
          syncChildren(draft, task, nowIso)
        }
        draft.updatedAt = nowIso
      }),
    )
  },

  moveAllToToday(): void {
    const state = useStore.getState()
    const ids = state.tasks
      .filter((t) => !t.parentId && t.status === 'pool' && !t.deletedAt)
      .map((t) => t.id)
    actions.moveManyToToday(ids)
  },

  moveToPool(id: string): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const task = draft.tasks.find((t) => t.id === id)
        if (!task || task.deletedAt) return
        task.scheduledDate = null
        task.status = 'pool'
        task.order = nextOrder(draft.tasks, 'pool', null)
        task.updatedAt = now.toISOString()
        syncChildren(draft, task, now.toISOString())
        draft.updatedAt = now.toISOString()
      }),
    )
  },

  /** 手动排序：把任务移动到所在列表的目标下标（FR-08）。子任务在兄弟之间排序。 */
  moveTask(id: string, toIndex: number): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const task = draft.tasks.find((t) => t.id === id)
        if (!task || task.deletedAt || task.completedAt) return

        const scope = task.parentId
          ? childrenOf(draft.tasks, task.parentId)
          : draft.tasks.filter(
              (t) =>
                !t.parentId &&
                !t.deletedAt &&
                !t.completedAt &&
                (task.status === 'today'
                  ? t.status === 'today' && t.scheduledDate === task.scheduledDate
                  : t.status === 'pool'),
            )
        if (scope.length < 2) return

        const { changed } = moveToIndex(scope, id, toIndex)
        if (!changed) return
        task.updatedAt = now.toISOString()
        draft.updatedAt = now.toISOString()
      }),
    )
  },

  /** 软删除（FR-10）：连同子任务一起进回收站，避免留下孤儿 */
  deleteTask(id: string): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const targets = [id, ...childrenOf(draft.tasks, id).map((t) => t.id)]
        for (const targetId of targets) {
          const task = draft.tasks.find((t) => t.id === targetId)
          if (!task || task.deletedAt) continue
          task.prevStatus = task.status
          task.status = 'trash'
          task.deletedAt = now.toISOString()
          task.updatedAt = now.toISOString()
        }
        draft.updatedAt = now.toISOString()
      }),
    )
  },

  /** 恢复：连同一起被删掉的子任务一起恢复 */
  restoreTask(id: string): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        // 注意用 allChildrenOf：子任务此刻就在回收站里
        const targets = [id, ...allChildrenOf(draft.tasks, id).map((t) => t.id)]
        for (const targetId of targets) {
          const task = draft.tasks.find((t) => t.id === targetId)
          if (!task || !task.deletedAt) continue
          task.status = task.prevStatus ?? (task.parentId ? 'today' : 'pool')
          task.prevStatus = undefined
          task.deletedAt = null
          task.updatedAt = now.toISOString()
        }
        draft.updatedAt = now.toISOString()
      }),
    )
    // 恢复的可能是过去某天的任务，需要重新结算
    actions.runSettle()
  },

  purgeTask(id: string): void {
    useStore.setState(
      produce((draft: StoreState) => {
        // 彻底删除父任务时，它的子任务也一并清掉，不留孤儿
        const removeIds = new Set([id, ...allChildrenOf(draft.tasks, id).map((t) => t.id)])
        draft.tasks = draft.tasks.filter((t) => !removeIds.has(t.id))
        draft.updatedAt = clock.now().toISOString()
      }),
    )
  },

  emptyTrash(): void {
    useStore.setState(
      produce((draft: StoreState) => {
        draft.tasks = draft.tasks.filter((t) => t.status !== 'trash')
        draft.updatedAt = clock.now().toISOString()
      }),
    )
  },

  setSettings(patch: Partial<Settings>): void {
    useStore.setState(
      produce((draft: StoreState) => {
        Object.assign(draft.settings, patch)
        draft.updatedAt = clock.now().toISOString()
      }),
    )
    actions.runSettle()
  },

  setSortMode(mode: SortMode): void {
    useStore.setState(
      produce((draft: StoreState) => {
        draft.ui.sortMode = mode
      }),
    )
  },

  setView(view: ViewMode): void {
    useStore.setState(
      produce((draft: StoreState) => {
        draft.ui.view = view
      }),
    )
  },

  setCalendarMode(mode: CalendarMode): void {
    useStore.setState(
      produce((draft: StoreState) => {
        draft.ui.calendarMode = mode
      }),
    )
  },

  /** 切换单个标签的筛选状态（多选，OR 语义） */
  toggleTagFilter(tag: string): void {
    useStore.setState(
      produce((draft: StoreState) => {
        const list = draft.ui.tagFilter
        const idx = list.indexOf(tag)
        if (idx >= 0) list.splice(idx, 1)
        else list.push(tag)
      }),
    )
  },

  clearTagFilter(): void {
    useStore.setState(
      produce((draft: StoreState) => {
        draft.ui.tagFilter = []
      }),
    )
  },

  /** 重命名标签：把旧标签从所有任务上换成新标签，合并重复项 */
  renameTag(from: string, to: string): void {
    const next = to.trim()
    if (!next || next === from) return
    const now = clock.now().toISOString()
    useStore.setState(
      produce((draft: StoreState) => {
        for (const task of draft.tasks) {
          if (!task.tags.includes(from)) continue
          const replaced = task.tags.map((t) => (t === from ? next : t))
          // 同一个任务上重名只保留一个
          task.tags = [...new Set(replaced)]
          task.updatedAt = now
        }
        draft.ui.tagFilter = draft.ui.tagFilter.map((t) => (t === from ? next : t))
        draft.updatedAt = now
      }),
    )
  },

  /** 删除标签：从所有任务上摘掉，并从筛选条件里移除 */
  deleteTag(tag: string): void {
    const now = clock.now().toISOString()
    useStore.setState(
      produce((draft: StoreState) => {
        for (const task of draft.tasks) {
          if (!task.tags.includes(tag)) continue
          task.tags = task.tags.filter((t) => t !== tag)
          task.updatedAt = now
        }
        draft.ui.tagFilter = draft.ui.tagFilter.filter((t) => t !== tag)
        draft.updatedAt = now
      }),
    )
  },

  toggleCompletedDate(date: string): void {
    useStore.setState(
      produce((draft: StoreState) => {
        const list = draft.ui.expandedCompletedDates
        const idx = list.indexOf(date)
        if (idx >= 0) list.splice(idx, 1)
        else list.push(date)
      }),
    )
  },

  dismissRolloverNotice(): void {
    useStore.setState(
      produce((draft: StoreState) => {
        if (draft.ui.lastRolloverNotice) draft.ui.lastRolloverNotice.dismissed = true
      }),
    )
  },

  /** 调试用：时间旅行 n 天并立即结算 */
  travelDays(days: number): SettleResult {
    clock.travelDays(days)
    return actions.runSettle()
  },

  /**
   * 时间归零：回到真实时间，并**恢复时间旅行前的数据**。
   * 旅行期间不落盘（见 persist.saveState），所以 localStorage 里就是旅行前的状态，
   * 直接读回来即可，不会把任务留在「明天」。
   */
  resetClock(): void {
    const wasTraveling = clock.isTraveling
    clock.reset()
    if (!wasTraveling) return

    const { state: stored } = loadState(clock.now())
    if (stored) {
      const { state: settled } = settle(stored, clock.now())
      // 恢复出来的状态与磁盘一致，不需要再触发一次写盘
      lastSavedUpdatedAt = settled.updatedAt
      useStore.setState({ ...settled, storageWarning: null, lastSettle: null })
      actions.runSettle()
      return
    }
    actions.runSettle()
  },

  /** 载入示例数据（FR-21） */
  loadSampleData(): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const today = logicalDateOf(now, draft.settings.dayStartHour)
        const samples: NewTaskInput[] = [
          { title: '回复客户邮件', priority: 'high', tags: ['工作'], toToday: true },
          { title: '写周报', priority: 'medium', tags: ['工作'], toToday: true },
          { title: '跑步 5km', priority: 'low', tags: ['健康'] },
          { title: '读《重构》30 页', tags: ['学习'], estimateMinutes: 45 },
        ]
        for (const sample of samples) {
          draft.tasks.push(buildTask(sample, draft.tasks, now, today))
        }

        // 给「写周报」挂两个二级任务，让示例数据就能看出 FR-13 的效果
        const weekly = draft.tasks.find((t) => t.title === '写周报' && !t.parentId)
        if (weekly) {
          ;['汇总本周进度', '整理下周计划'].forEach((title, i) => {
            const sub = buildTask({ title }, draft.tasks, now, today)
            sub.parentId = weekly.id
            sub.status = weekly.status
            sub.scheduledDate = weekly.scheduledDate
            sub.order = i + 1
            draft.tasks.push(sub)
          })
        }

        draft.updatedAt = now.toISOString()
      }),
    )
  },

  /**
   * 演示模式（`?demo=1`）：补一批过去 3 周的历史完成记录与快照，
   * 让日历热力、连续打卡、完成率这些「需要历史数据才看得出来」的部分立刻有内容。
   */
  loadDemoHistory(): void {
    const now = clock.now()
    useStore.setState(
      produce((draft: StoreState) => {
        const today = logicalDateOf(now, draft.settings.dayStartHour)
        const titles = [
          '写周报',
          '跑步 5km',
          '读《重构》30 页',
          '代码评审',
          '回复客户邮件',
          '整理笔记',
          '复盘本周',
        ]

        for (let i = 1; i <= 21; i += 1) {
          const date = addDays(today, -i)
          const completed = (i * 5) % 4 // 0..3 件，每隔几天留一个空白日
          const planned = completed + ((i * 3) % 2) // 分母略大于分子，制造非满完成率

          for (let k = 0; k < completed; k += 1) {
            draft.tasks.push({
              id: createId(),
              title: titles[(i + k) % titles.length],
              status: 'done',
              createdAt: `${date}T01:00:00.000Z`,
              updatedAt: `${date}T10:00:00.000Z`,
              scheduledDate: date,
              completedAt: `${date}T${String(9 + k).padStart(2, '0')}:15:00.000Z`,
              completedDate: date,
              deletedAt: null,
              priority: 'none',
              tags: [],
              dueDate: null,
              estimateMinutes: null,
              pinned: false,
              carryOverCount: 0,
              lastRolledAt: null,
              order: k + 1,
              parentId: null,
              recurringId: null,
            })
          }

          draft.snapshots[date] = {
            date,
            planned,
            completed,
            completedTaskIds: [],
            carriedOutIds: [],
            returnedToPoolIds: [],
            completionRate: planned > 0 ? completed / planned : 0,
          }
        }

        // 顺手把今天的一件任务标成完成，这样「今日已完成」也有内容可看
        const firstToday = draft.tasks.find(
          (t) => t.status === 'today' && !t.completedAt && t.scheduledDate === today,
        )
        if (firstToday) {
          firstToday.status = 'done'
          firstToday.completedAt = `${today}T10:30:00.000Z`
          firstToday.completedDate = today
        }

        draft.updatedAt = now.toISOString()
      }),
    )
  },

  exportJSON(): string {
    return JSON.stringify(toPersisted(useStore.getState()), null, 2)
  },

  /** 导入：失败时不破坏现有数据（边界条件 #8） */
  importJSON(json: string): { ok: true } | { ok: false; error: string } {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return { ok: false, error: '文件格式不正确，现有数据未受影响' }
    }
    const imported = normalizeState(parsed, clock.now())
    if (!imported) {
      return { ok: false, error: '文件格式不正确，现有数据未受影响' }
    }
    const { state: settled } = settle(imported, clock.now())
    lastSavedUpdatedAt = null
    useStore.setState({ ...settled, storageWarning: null, lastSettle: null })
    flushSave()
    return { ok: true }
  },

  clearAll(): void {
    clearStorage()
    const now = clock.now()
    const fresh = createInitialState(now)
    lastSavedUpdatedAt = null
    useStore.setState({ ...fresh, storageWarning: null, lastSettle: null })
    flushSave()
  },
}

export type Actions = typeof actions
