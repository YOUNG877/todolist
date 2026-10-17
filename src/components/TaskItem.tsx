import type { CSSProperties, ReactNode } from 'react'
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
  /** 插在勾选框之前的额外内容（例如待办池的批量选择框） */
  leading?: ReactNode
  /** 插在操作区末尾的额外内容 */
  trailing?: ReactNode
  /**
   * 把「完成」勾选框放到行尾。
   * 待办池用它：最前面留给批量选择框，完成操作退到右边，避免两个圆圈挤在一起。
   */
  completionLast?: boolean
  /** 点标题进入编辑 */
  onEdit?: (id: string) => void
  onToggle: (id: string) => void
  onMoveToToday: (id: string) => void
  onMoveToPool: (id: string) => void
  onDelete: (id: string) => void
  /** 传入后显示进度滑块（今日待办里用） */
  onProgressChange?: (id: string, value: number) => void
  /** 已完成任务：切换「待追踪」 */
  onToggleTracking?: (id: string) => void
  /** 已完成任务：设置追踪进度 */
  onTrackingProgressChange?: (id: string, value: number) => void
  /** 已完成任务：退回今日待办 */
  onReopen?: (id: string) => void
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
  completionLast = false,
  onEdit,
  onToggle,
  onMoveToToday,
  onMoveToPool,
  onDelete,
  onProgressChange,
  onToggleTracking,
  onTrackingProgressChange,
  onReopen,
  onMove,
  onAddSubtask,
}: TaskItemProps): JSX.Element {
  const done = !!task.completedAt
  const overdue = !!task.dueDate && !done && task.dueDate < today
  const severe = task.carryOverCount >= 3
  const isSub = depth > 0
  const showProgress = !isSub && context === 'today' && !!onProgressChange
  const showTracking = !isSub && task.tracking && done

  const checkButton = (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? '取消完成' : '完成任务'}：${task.title}`}
      title={done ? '取消完成' : '标记完成'}
      className="task__check"
      onClick={() => onToggle(task.id)}
    >
      <CheckIcon />
    </button>
  )

  const titleNode = onEdit ? (
    <button type="button" className="task__title task__title--button" onClick={() => onEdit(task.id)}>
      {task.title}
    </button>
  ) : (
    <span className="task__title">{task.title}</span>
  )

  return (
    <div
      className={[
        'task',
        `task--p-${task.priority}`,
        done ? 'is-done' : '',
        isSub ? 'task--sub' : '',
        showTracking ? 'task--tracking' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {leading}
      {!completionLast && checkButton}

      <div className="task__body">
        {titleNode}

        <div className="task__meta">
          {task.pinned && <span className="chip chip--warn">必做</span>}

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

          {/* 不在今日列表里时也把进度显示出来，方便回看 */}
          {!isSub && task.progress > 0 && !showProgress && (
            <span className="chip chip--muted">完成 {task.progress}%</span>
          )}

          {showTracking && (
            <span className="chip chip--track">
              待追踪{task.trackingProgress > 0 ? ` ${task.trackingProgress}%` : ''}
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

        {showProgress && (
          <div className="task__slider">
            <span className="task__slider-label">进度</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              className="task__range"
              aria-label={`完成进度：${task.title}`}
              value={task.progress}
              style={{ '--fill': `${task.progress}%` } as CSSProperties}
              onChange={(e) => onProgressChange?.(task.id, Number(e.target.value))}
            />
            <span className="task__slider-value">{task.progress}%</span>
          </div>
        )}

        {showTracking && onTrackingProgressChange && (
          <div className="task__slider task__slider--track">
            <span className="task__slider-label">追踪</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              className="task__range task__range--track"
              aria-label={`追踪进度：${task.title}`}
              value={task.trackingProgress}
              style={{ '--fill': `${task.trackingProgress}%` } as CSSProperties}
              onChange={(e) => onTrackingProgressChange(task.id, Number(e.target.value))}
            />
            <span className="task__slider-value">{task.trackingProgress}%</span>
          </div>
        )}
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

        {/* 已完成的：标记待追踪 / 取消追踪 */}
        {!isSub && done && onToggleTracking && (
          <button
            type="button"
            className={`btn btn--xs${task.tracking ? ' btn--track-on' : ' btn--ghost'}`}
            aria-pressed={task.tracking}
            aria-label={`${task.tracking ? '取消追踪' : '标记为待追踪'}：${task.title}`}
            title={task.tracking ? '不再追踪这条的结果' : '事情做完了，但结果还要继续跟进'}
            onClick={() => onToggleTracking(task.id)}
          >
            {task.tracking ? '追踪中' : '追踪'}
          </button>
        )}

        {/* 已完成的：退回今日待办 */}
        {!isSub && done && onReopen && (
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            aria-label={`退回今日待办：${task.title}`}
            title="退回今日待办，重新做"
            onClick={() => onReopen(task.id)}
          >
            退回今日
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

        {completionLast && checkButton}

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
