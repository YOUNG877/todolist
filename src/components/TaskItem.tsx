import type { ReactNode } from 'react'
import type { Task } from '@/store/types'
import { PRIORITY_LABEL } from '@/store/types'
import { describeRelativeDay } from '@/core/date'

export interface TaskItemProps {
  task: Task
  today: string
  /** 任务当前所在的区域，决定显示哪些操作 */
  context: 'today' | 'pool' | 'future' | 'done'
  /** 0 = 顶层任务，1 = 二级任务（缩进、字号更小、少显示一些元信息） */
  depth?: number
  /** 子任务完成进度，显示成「子任务 2/5」角标 */
  progress?: { done: number; total: number }
  /** 在所属列表中的下标，用于上下移动 */
  index?: number
  listLength?: number
  /** 插在勾选框之前的额外内容 */
  leading?: ReactNode
  /** 插在操作区末尾的额外内容（例如待办池的批量选择框） */
  trailing?: ReactNode
  onToggle: (id: string) => void
  onMoveToToday: (id: string) => void
  onMoveToPool: (id: string) => void
  onDelete: (id: string) => void
  onMove?: (id: string, toIndex: number) => void
  /** 传入后显示「＋」按钮，用来添加二级任务 */
  onAddSubtask?: (id: string) => void
}

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
      <path
        d="M2.5 8.5l3.2 3.2L13.5 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TaskItem({
  task,
  today,
  context,
  depth = 0,
  progress,
  index = 0,
  listLength = 1,
  leading,
  trailing,
  onToggle,
  onMoveToToday,
  onMoveToPool,
  onDelete,
  onMove,
  onAddSubtask,
}: TaskItemProps): JSX.Element {
  const done = !!task.completedAt
  const overdue = !!task.dueDate && !done && task.dueDate < today
  const severe = task.carryOverCount >= 3
  const isSub = depth > 0

  return (
    <div
      className={['task', `task--p-${task.priority}`, done ? 'is-done' : '', isSub ? 'task--sub' : '']
        .filter(Boolean)
        .join(' ')}
    >
      {leading}
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={`${done ? '取消完成' : '完成任务'}：${task.title}`}
        className="task__check"
        onClick={() => onToggle(task.id)}
      >
        <CheckIcon />
      </button>

      <div className="task__body">
        <span className="task__title">{task.title}</span>

        <div className="task__meta">
          {task.carryOverCount > 0 && (
            <span className="chip chip--warn" data-severe={severe}>
              顺延 {task.carryOverCount >= 30 ? '30+' : task.carryOverCount} 天
            </span>
          )}

          {progress && progress.total > 0 && (
            <span
              className={`chip${progress.done === progress.total ? ' chip--tag' : ' chip--muted'}`}
            >
              子任务 {progress.done}/{progress.total}
            </span>
          )}

          {!isSub && task.priority !== 'none' && (
            <span className={`chip chip--p-${task.priority}`}>
              优先级 {PRIORITY_LABEL[task.priority]}
            </span>
          )}

          {!isSub && task.dueDate && (
            <span className={`chip${overdue ? ' chip--danger' : ''}`}>
              截止 {task.dueDate}（{describeRelativeDay(task.dueDate, today)}）
            </span>
          )}

          {!isSub && task.estimateMinutes !== null && (
            <span className="chip chip--muted">约 {task.estimateMinutes} 分钟</span>
          )}

          {task.tags.map((tag) => (
            <span key={tag} className="chip chip--tag">
              #{tag}
            </span>
          ))}

          {done && task.completedAt && (
            <span className="time">{task.completedAt.slice(11, 16)} 完成</span>
          )}
        </div>
      </div>

      <div className="task__actions">
        {!isSub && onMove && (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={`上移：${task.title}`}
              title="上移"
              disabled={index === 0}
              onClick={() => onMove(task.id, index - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`下移：${task.title}`}
              title="下移"
              disabled={index >= listLength - 1}
              onClick={() => onMove(task.id, index + 1)}
            >
              ↓
            </button>
          </>
        )}

        {!isSub && onAddSubtask && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`添加子任务：${task.title}`}
            title="添加子任务"
            onClick={() => onAddSubtask(task.id)}
          >
            ＋
          </button>
        )}

        {!isSub && context !== 'done' && context !== 'today' && (
          <button
            type="button"
            className="btn btn--xs btn--primary-soft"
            onClick={() => onMoveToToday(task.id)}
          >
            → 今日
          </button>
        )}

        {!isSub && context === 'today' && (
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            title="移回待办池"
            onClick={() => onMoveToPool(task.id)}
          >
            移回池子
          </button>
        )}

        <button
          type="button"
          className="icon-btn icon-btn--danger"
          aria-label={`删除：${task.title}`}
          title="删除"
          onClick={() => onDelete(task.id)}
        >
          ✕
        </button>
        {trailing}
      </div>
    </div>
  )
}
