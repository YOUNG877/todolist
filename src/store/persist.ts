/**
 * persist.ts —— localStorage 读写（需求文档 7.2 / FR-17）
 *
 * 职责：
 *  1. 读取时做结构校验 + 版本迁移，脏数据不会污染 store
 *  2. 写入做 300ms 防抖，并在覆盖前留一份上一版备份，便于崩溃恢复
 *  3. localStorage 不可用（隐私模式 / 配额满）时降级为内存模式并回报警告
 */

import { clock } from '@/core/clock'
import { logicalDateOf } from '@/core/date'
import { createId } from '@/core/id'
import {
  CURRENT_VERSION,
  DEFAULT_SETTINGS,
  type DaySnapshot,
  type PersistedState,
  type Priority,
  type Settings,
  type Task,
  type TaskStatus,
  type UiState,
} from './types'

export const STORAGE_KEY = 'todolist:v1'
export const BACKUP_KEY = 'todolist:v1:backup'
const SAVE_DEBOUNCE_MS = 300

/** 内存降级：localStorage 不可用时在这里保存 */
let memoryState: PersistedState | null = null
let storageUsable: boolean | null = null

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 5) : []
}

/* -------------------------------------------------------------------------- */
/* 归一化                                                                      */
/* -------------------------------------------------------------------------- */

const TASK_STATUSES: TaskStatus[] = ['pool', 'today', 'done', 'trash']
const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']

export function normalizeTask(raw: unknown, index: number): Task | null {
  const r = asRecord(raw)
  if (!r) return null
  const title = asString(r.title).trim()
  if (!title) return null

  const status = TASK_STATUSES.includes(r.status as TaskStatus) ? (r.status as TaskStatus) : 'pool'
  const priority = PRIORITIES.includes(r.priority as Priority) ? (r.priority as Priority) : 'none'
  const nowIso = clock.now().toISOString()
  const estimate = r.estimateMinutes

  return {
    id: asString(r.id) || createId(),
    title,
    note: asStringOrNull(r.note) ?? undefined,
    status,
    createdAt: asString(r.createdAt, nowIso),
    updatedAt: asString(r.updatedAt, nowIso),
    scheduledDate: asStringOrNull(r.scheduledDate),
    completedAt: asStringOrNull(r.completedAt),
    completedDate: asStringOrNull(r.completedDate),
    deletedAt: asStringOrNull(r.deletedAt),
    prevStatus: TASK_STATUSES.includes(r.prevStatus as TaskStatus)
      ? (r.prevStatus as TaskStatus)
      : undefined,
    priority,
    tags: asStringArray(r.tags),
    dueDate: asStringOrNull(r.dueDate),
    estimateMinutes:
      typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0
        ? Math.round(estimate)
        : null,
    pinned: asBoolean(r.pinned),
    carryOverCount: Math.max(0, Math.round(asNumber(r.carryOverCount))),
    lastRolledAt: asStringOrNull(r.lastRolledAt),
    order: asNumber(r.order, index),
    parentId: asStringOrNull(r.parentId),
    recurringId: asStringOrNull(r.recurringId),
  }
}

function normalizeSnapshot(raw: unknown, date: string): DaySnapshot | null {
  const r = asRecord(raw)
  if (!r) return null
  const completedTaskIds = Array.isArray(r.completedTaskIds)
    ? r.completedTaskIds.filter((v): v is string => typeof v === 'string')
    : []
  const carriedOutIds = Array.isArray(r.carriedOutIds)
    ? r.carriedOutIds.filter((v): v is string => typeof v === 'string')
    : []
  const returnedToPoolIds = Array.isArray(r.returnedToPoolIds)
    ? r.returnedToPoolIds.filter((v): v is string => typeof v === 'string')
    : []
  const planned = Math.max(0, Math.round(asNumber(r.planned)))
  const completed = Math.max(0, Math.round(asNumber(r.completed, completedTaskIds.length)))
  return {
    date,
    planned,
    completed,
    completedTaskIds,
    carriedOutIds,
    returnedToPoolIds,
    completionRate: planned > 0 ? Math.min(1, completed / planned) : 0,
  }
}

export function normalizeSettings(raw: unknown): Settings {
  const r = asRecord(raw) ?? {}
  const strategy = r.rolloverStrategy
  const theme = r.theme
  const dayStart = asNumber(r.dayStartHour, DEFAULT_SETTINGS.dayStartHour)
  return {
    dayStartHour: Math.min(6, Math.max(0, Math.round(dayStart))),
    rolloverStrategy:
      strategy === 'all' || strategy === 'pinned-only' || strategy === 'ask'
        ? strategy
        : DEFAULT_SETTINGS.rolloverStrategy,
    rolloverMaxDays: Math.max(0, Math.round(asNumber(r.rolloverMaxDays))),
    theme: theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system',
    animation: asBoolean(r.animation, DEFAULT_SETTINGS.animation),
    weekStart: asNumber(r.weekStart, 1) === 0 ? 0 : 1,
    dateFormat: r.dateFormat === 'MM/DD/YYYY' ? 'MM/DD/YYYY' : 'YYYY-MM-DD',
    showRolloverNotice: asBoolean(r.showRolloverNotice, true),
    autoCompleteParent: asBoolean(r.autoCompleteParent, true),
    hotkeys: asBoolean(r.hotkeys, true),
    notifyEnabled: asBoolean(r.notifyEnabled, false),
    notifyTime: /^\d{2}:\d{2}$/.test(asString(r.notifyTime)) ? asString(r.notifyTime) : '09:00',
  }
}

function normalizeUi(raw: unknown): UiState {
  const r = asRecord(raw) ?? {}
  const notice = asRecord(r.lastRolloverNotice)
  const sortMode = r.sortMode
  return {
    lastRolloverNotice: notice
      ? {
          count: Math.max(0, Math.round(asNumber(notice.count))),
          taskIds: Array.isArray(notice.taskIds)
            ? notice.taskIds.filter((v): v is string => typeof v === 'string')
            : [],
          dismissed: asBoolean(notice.dismissed),
          date: asString(notice.date),
        }
      : null,
    sortMode:
      sortMode === 'priority' || sortMode === 'due' || sortMode === 'created'
        ? sortMode
        : 'manual',
    view: r.view === 'history' ? 'history' : 'board',
    calendarMode: r.calendarMode === 'detail' ? 'detail' : 'count',
    expandedCompletedDates: Array.isArray(r.expandedCompletedDates)
      ? r.expandedCompletedDates.filter((v): v is string => typeof v === 'string')
      : [],
  }
}

/** 迁移链：版本 N → N+1。目前只有 v1，占位以保证后续可平滑升级。 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {}

export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let current = raw
  let version = Math.round(asNumber(current.version, 1))
  while (version < CURRENT_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) break
    current = step(current)
    version += 1
  }
  return current
}

/** 任意输入 → 合法的 PersistedState（结构校验的兜底） */
export function normalizeState(raw: unknown, now: Date = clock.now()): PersistedState | null {
  const record = asRecord(raw)
  if (!record) return null
  const migrated = migrate(record)
  if (!Array.isArray(migrated.tasks)) return null

  const tasks = migrated.tasks
    .map((t, i) => normalizeTask(t, i))
    .filter((t): t is Task => t !== null)

  const snapshots: Record<string, DaySnapshot> = {}
  const rawSnapshots = asRecord(migrated.snapshots)
  if (rawSnapshots) {
    for (const [date, value] of Object.entries(rawSnapshots)) {
      const snap = normalizeSnapshot(value, date)
      if (snap) snapshots[date] = snap
    }
  }

  const settings = normalizeSettings(migrated.settings)
  const lastSettledDate =
    asStringOrNull(migrated.lastSettledDate) ?? logicalDateOf(now, settings.dayStartHour)

  return {
    version: CURRENT_VERSION,
    tasks,
    snapshots,
    settings,
    lastSettledDate,
    ui: normalizeUi(migrated.ui),
    updatedAt: asString(migrated.updatedAt, now.toISOString()),
  }
}

/* -------------------------------------------------------------------------- */
/* 存储可用性                                                                  */
/* -------------------------------------------------------------------------- */

export function isStorageAvailable(): boolean {
  if (storageUsable !== null) return storageUsable
  try {
    const probe = `${STORAGE_KEY}:probe`
    globalThis.localStorage.setItem(probe, '1')
    globalThis.localStorage.removeItem(probe)
    storageUsable = true
  } catch {
    storageUsable = false
  }
  return storageUsable
}

/** 仅供测试重置缓存 */
export function resetStorageProbe(): void {
  storageUsable = null
  memoryState = null
}

/* -------------------------------------------------------------------------- */
/* 读                                                                          */
/* -------------------------------------------------------------------------- */

export interface LoadResult {
  state: PersistedState | null
  /** 非致命问题的提示文案，供 UI 显示警告横幅 */
  warning: string | null
}

export function createInitialState(now: Date = clock.now()): PersistedState {
  return {
    version: CURRENT_VERSION,
    tasks: [],
    snapshots: {},
    settings: { ...DEFAULT_SETTINGS },
    lastSettledDate: logicalDateOf(now, DEFAULT_SETTINGS.dayStartHour),
    ui: {
      lastRolloverNotice: null,
      sortMode: 'manual',
      view: 'board',
      calendarMode: 'count',
      expandedCompletedDates: [],
    },
    updatedAt: now.toISOString(),
  }
}

export function loadState(now: Date = clock.now()): LoadResult {
  if (!isStorageAvailable()) {
    return {
      state: memoryState,
      warning: '浏览器本地存储不可用（可能处于隐私模式），本次改动不会被保存，请及时导出备份。',
    }
  }
  const raw = globalThis.localStorage.getItem(STORAGE_KEY)
  if (!raw) return { state: null, warning: null }
  try {
    const parsed: unknown = JSON.parse(raw)
    const state = normalizeState(parsed, now)
    if (!state) {
      return { state: null, warning: '本地数据格式异常，已忽略并重新开始（原数据仍保留在浏览器中）。' }
    }
    return { state, warning: null }
  } catch {
    return { state: null, warning: '本地数据解析失败，已忽略并重新开始。' }
  }
}

/* -------------------------------------------------------------------------- */
/* 写                                                                          */
/* -------------------------------------------------------------------------- */

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pending: PersistedState | null = null

export function saveState(state: PersistedState): void {
  // 时间旅行只存在于内存（需求 6.6 / 调试面板）。如果把它造成的后果（任务被推到明天、
  // lastSettledDate 前进）写进 localStorage，一旦页面刷新、时钟回到真实时间，
  // 「今天」就退回到 D 而任务躺在 D+1，用户会发现今日待办里的任务全都不见了。
  if (clock.isTraveling) return

  if (!isStorageAvailable()) {
    memoryState = state
    return
  }
  pending = state
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    flushSave()
  }, SAVE_DEBOUNCE_MS)
}

/** 立即落盘，取消防抖。页面隐藏 / 卸载时调用，避免丢数据。 */
export function flushSave(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const state = pending
  pending = null
  if (!state) return
  if (!isStorageAvailable()) {
    memoryState = state
    return
  }
  try {
    const previous = globalThis.localStorage.getItem(STORAGE_KEY)
    if (previous) globalThis.localStorage.setItem(BACKUP_KEY, previous)
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 配额满：降级为内存模式，不再反复抛错
    memoryState = state
    storageUsable = false
  }
}

export function clearStorage(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  pending = null
  memoryState = null
  if (!isStorageAvailable()) return
  try {
    globalThis.localStorage.removeItem(STORAGE_KEY)
    globalThis.localStorage.removeItem(BACKUP_KEY)
  } catch {
    storageUsable = false
  }
}

/** 读取备份（崩溃恢复入口） */
export function loadBackup(now: Date = clock.now()): PersistedState | null {
  if (!isStorageAvailable()) return null
  const raw = globalThis.localStorage.getItem(BACKUP_KEY)
  if (!raw) return null
  try {
    return normalizeState(JSON.parse(raw), now)
  } catch {
    return null
  }
}
