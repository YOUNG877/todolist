/**
 * types.ts —— 数据模型（需求文档 7.1）
 * 这里是唯一的数据契约，UI 与 core 都必须以此为准。
 */

export type Priority = 'none' | 'low' | 'medium' | 'high'

export type TaskStatus = 'pool' | 'today' | 'done' | 'trash'

export type RolloverStrategy = 'all' | 'pinned-only' | 'ask'

export type ThemeMode = 'light' | 'dark' | 'system'

export type SortMode = 'manual' | 'priority' | 'due' | 'created'

/** 主视图：今天是干活的地方，回顾是看历史的地方（用户要求分开成两页） */
export type ViewMode = 'board' | 'history'

/** 日历格子的显示方式：只显示完成件数 / 显示具体做了哪些事 */
export type CalendarMode = 'count' | 'detail'

export interface Task {
  id: string
  title: string
  note?: string
  status: TaskStatus
  createdAt: string
  updatedAt: string

  /** 安排到哪一天（`YYYY-MM-DD`）；未安排为 null */
  scheduledDate: string | null
  /** 完成时刻 ISO */
  completedAt: string | null
  /** 完成时所归属的**逻辑日期**（`YYYY-MM-DD`） */
  completedDate: string | null
  /** 删除时刻 ISO（软删除） */
  deletedAt: string | null
  /** 用于回收站恢复：删除前的状态 */
  prevStatus?: TaskStatus

  priority: Priority
  tags: string[]
  dueDate: string | null
  estimateMinutes: number | null
  /** 必做标记，配合 rolloverStrategy = 'pinned-only' 使用 */
  pinned: boolean

  /** 顺延累计天数（默认只算工作日，周末不算延期） */
  carryOverCount: number
  lastRolledAt: string | null

  /** 完成进度 0–100（今日待办里可以直接拖） */
  progress: number
  /** 标记为「待追踪」：已完成但还要继续跟进结果 */
  tracking: boolean
  /** 追踪进度 0–100 */
  trackingProgress: number
  /** 追踪备注，可多条，按时间先后追加 */
  trackingNotes: TrackingNote[]

  /** 栏内排序权重（浮点，取中值插入） */
  order: number
  parentId: string | null
  recurringId: string | null
}

/** 追踪备注：做完了但还要跟结果时，一条条记录进展 */
export interface TrackingNote {
  id: string
  text: string
  /** 写这条备注的时刻（ISO） */
  createdAt: string
  /** 写这条备注时的追踪进度，便于回看「当时走到哪一步」 */
  progress: number
}

/** 某一天结束时的快照，用于历史回看与统计（FR-15 / FR-16） */
export interface DaySnapshot {
  date: string
  /** 当天今日列表上的任务数 */
  planned: number
  completed: number
  completedTaskIds: string[]
  /** 当天未完成、被顺延到次日的任务 */
  carriedOutIds: string[]
  /** 当天未完成、按策略退回待办池的任务 */
  returnedToPoolIds: string[]
  /** 0–1 */
  completionRate: number
}

export interface Settings {
  /** 日界时间（小时），默认 4 表示凌晨 04:00 换日 */
  dayStartHour: number
  rolloverStrategy: RolloverStrategy
  /** 顺延上限：carryOverCount 超过该值退回池中；0 = 不限 */
  rolloverMaxDays: number
  theme: ThemeMode
  animation: boolean
  weekStart: 0 | 1
  dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY'
  showRolloverNotice: boolean
  /** 顺延天数是否把周末算进去。默认 false：周六日算节假日，不计入延期 */
  countWeekends: boolean
  autoCompleteParent: boolean
  hotkeys: boolean
  notifyEnabled: boolean
  notifyTime: string
}

export interface RolloverNotice {
  count: number
  taskIds: string[]
  dismissed: boolean
  /** 产生该提示的逻辑日期，避免跨天重复提示 */
  date: string
}

export interface UiState {
  lastRolloverNotice: RolloverNotice | null
  sortMode: SortMode
  /** 当前主视图 */
  view: ViewMode
  /** 日历格子显示件数还是明细 */
  calendarMode: CalendarMode
  /** 按标签筛选（多选，任一命中即显示）；空数组表示不筛选 */
  tagFilter: string[]
  /** 回顾页中处于展开状态的历史分组日期（保留字段，供后续扩展） */
  expandedCompletedDates: string[]
}

/** 会被持久化到 localStorage 的完整状态 */
export interface PersistedState {
  version: number
  tasks: Task[]
  snapshots: Record<string, DaySnapshot>
  settings: Settings
  lastSettledDate: string | null
  ui: UiState
  updatedAt: string
}

export const CURRENT_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  dayStartHour: 4,
  rolloverStrategy: 'all',
  rolloverMaxDays: 0,
  theme: 'system',
  animation: true,
  weekStart: 1,
  dateFormat: 'YYYY-MM-DD',
  showRolloverNotice: true,
  countWeekends: false,
  autoCompleteParent: true,
  hotkeys: true,
  notifyEnabled: false,
  notifyTime: '09:00',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
}

export const PRIORITY_WEIGHT: Record<Priority, number> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
}
