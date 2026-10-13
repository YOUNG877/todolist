/**
 * filters.ts —— 按标签筛选（FR-12）
 *
 * 规则刻意保持简单可预期：
 *  - 空筛选 = 全部显示
 *  - 多选时任一标签命中即显示（OR 语义）
 *  - 命中父任务时，它的子任务一并保留（否则父任务会变成光杆）
 *  - 命中的子任务本身也会保留；它的父任务没命中时，buildTaskTree 会把它提升为顶层显示
 */

import type { Task } from '@/store/types'

export function filterByTags(tasks: Task[], tagFilter: string[]): Task[] {
  if (tagFilter.length === 0) return tasks

  const wanted = new Set(tagFilter)
  const matched = tasks.filter((t) => t.tags.some((tag) => wanted.has(tag)))
  if (matched.length === 0) return []

  const keep = new Set(matched.map((t) => t.id))
  // 命中任务的子任务一起保留
  for (const t of tasks) {
    if (t.parentId && keep.has(t.parentId)) keep.add(t.id)
  }

  return tasks.filter((t) => keep.has(t.id))
}

/** 任务是否命中当前筛选（用于给条目加高亮之类） */
export function matchesFilter(task: Task, tagFilter: string[]): boolean {
  if (tagFilter.length === 0) return true
  return task.tags.some((tag) => tagFilter.includes(tag))
}
