/**
 * tracking.test.ts —— 追踪相关字段的持久化契约
 *
 * 「待追踪」列表是独立于「今日已完成」的，所以 tracking / trackingProgress /
 * trackingNotes 必须能完整地存盘再读回来；否则刷新一次任务就从追踪列表里消失了。
 */

import { describe, expect, it } from 'vitest'
import { normalizeState } from './persist'
import { DEFAULT_SETTINGS, type Task } from './types'

const BASE = {
  id: 't1',
  title: '等审批',
  status: 'done' as const,
  createdAt: '2026-03-01T01:00:00.000Z',
  updatedAt: '2026-03-01T02:00:00.000Z',
  scheduledDate: '2026-03-01',
  completedAt: '2026-03-01T02:00:00.000Z',
  completedDate: '2026-03-01',
  deletedAt: null,
  priority: 'none' as const,
  tags: [],
  dueDate: null,
  estimateMinutes: null,
  pinned: false,
  carryOverCount: 0,
  lastRolledAt: null,
  progress: 0,
  tracking: true,
  trackingProgress: 60,
  trackingNotes: [
    { id: 'n1', text: '已提交', createdAt: '2026-03-01T03:00:00.000Z', progress: 40 },
    { id: 'n2', text: '初审通过', createdAt: '2026-03-01T04:00:00.000Z', progress: 60 },
  ],
  order: 1,
  parentId: null,
  recurringId: null,
} satisfies Task

function wrap(tasks: unknown[]): Record<string, unknown> {
  return {
    version: 1,
    tasks,
    snapshots: {},
    settings: DEFAULT_SETTINGS,
    lastSettledDate: '2026-03-01',
    ui: { sortMode: 'manual', view: 'board', calendarMode: 'count', tagFilter: [] },
    updatedAt: '2026-03-01T00:00:00.000Z',
  }
}

describe('追踪字段的持久化', () => {
  it('tracking / trackingProgress / trackingNotes 完整往返', () => {
    // 走一遍 JSON 序列化，模拟真实的存盘-读盘
    const raw = JSON.parse(JSON.stringify(wrap([BASE])))
    const state = normalizeState(raw)
    expect(state).not.toBeNull()

    const t = state!.tasks[0]
    expect(t.tracking).toBe(true)
    expect(t.trackingProgress).toBe(60)
    expect(t.trackingNotes).toHaveLength(2)
    expect(t.trackingNotes[0]).toMatchObject({ text: '已提交', progress: 40 })
    expect(t.trackingNotes[1]).toMatchObject({ text: '初审通过', progress: 60 })
  })

  it('旧数据没有这些字段时给安全默认值', () => {
    const legacy = { ...BASE } as Record<string, unknown>
    delete legacy.tracking
    delete legacy.trackingProgress
    delete legacy.trackingNotes
    delete legacy.progress

    const state = normalizeState(wrap([legacy]))
    const t = state!.tasks[0]
    expect(t.tracking).toBe(false)
    expect(t.trackingProgress).toBe(0)
    expect(t.trackingNotes).toEqual([])
    expect(t.progress).toBe(0)
  })

  it('越界的百分比被夹到 0–100，空文本备注被丢掉', () => {
    const dirty = {
      ...BASE,
      trackingProgress: 250,
      progress: -30,
      trackingNotes: [
        { id: 'a', text: '正常', createdAt: '2026-03-01T03:00:00.000Z', progress: 999 },
        { id: 'b', text: '   ', createdAt: '2026-03-01T03:00:00.000Z', progress: 10 },
        { id: 'c', createdAt: '2026-03-01T03:00:00.000Z', progress: 10 },
      ],
    }
    const state = normalizeState(wrap([dirty]))
    const t = state!.tasks[0]
    expect(t.trackingProgress).toBe(100)
    expect(t.progress).toBe(0)
    // 只有第一条有有效文本
    expect(t.trackingNotes).toHaveLength(1)
    expect(t.trackingNotes[0].progress).toBe(100)
  })
})
