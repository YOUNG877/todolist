import { useState, type FormEvent, type ReactNode } from 'react'
import type { TaskNode } from '@/core/selectors'
import { childProgress } from '@/core/selectors'
import { actions } from '@/store/store'
import { TaskItem } from './TaskItem'

type Context = 'today' | 'pool' | 'future' | 'done'

export interface TaskNodeProps {
  node: TaskNode
  today: string
  context: Context
  index?: number
  listLength?: number
  leading?: ReactNode
  trailing?: ReactNode
  /** 把完成勾选框放到行尾（待办池用：最前面留给批量选择框） */
  completionLast?: boolean
  onEdit?: (id: string) => void
  onToggle: (id: string) => void
  onMoveToToday: (id: string) => void
  onMoveToPool: (id: string) => void
  onDelete: (id: string) => void
  onMove?: (id: string, toIndex: number) => void
  onProgressChange?: (id: string, value: number) => void
  onToggleTracking?: (id: string) => void
  onTrackingProgressChange?: (id: string, value: number) => void
  onReopen?: (id: string) => void
  onCompleteAndTrack?: (id: string) => void
  /** 勾选框语义改成「完成」（待追踪列表用） */
  finishMode?: boolean
  onAddTrackingNote?: (id: string, text: string) => void
  onDeleteTrackingNote?: (id: string, noteId: string) => void
  /** 是否允许在这一行新增二级任务（已完成的归档区不允许） */
  allowSubtasks?: boolean
  /**
   * 是否渲染子任务。
   * 待追踪列表传 false：子任务没有追踪标记，点它们的勾选框没有意义，
   * 留着只会让人点了发现「没反应」。父任务上的「子任务 2/3」角标已足够表达进度。
   */
  showChildren?: boolean
}

/**
 * 一个任务节点：顶层任务 + 它下面缩进的二级任务（FR-13）。
 * 「已完成」区只读展示，所以不允许再加子任务。
 */
export function TaskNode({
  node,
  today,
  context,
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
  onMove,
  onProgressChange,
  onToggleTracking,
  onTrackingProgressChange,
  onReopen,
  onCompleteAndTrack,
  finishMode = false,
  onAddTrackingNote,
  onDeleteTrackingNote,
  allowSubtasks = true,
  showChildren = true,
}: TaskNodeProps): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const progress = childProgress(node)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const title = draft.trim()
    if (!title) return
    actions.addSubtask(node.task.id, title)
    setDraft('')
    // 连续录入：保持输入框打开
  }

  return (
    <li className="task-node">
      <TaskItem
        task={node.task}
        today={today}
        context={context}
        index={index}
        listLength={listLength}
        leading={leading}
        trailing={trailing}
        progress={progress}
        completionLast={completionLast}
        onEdit={onEdit}
        onToggle={onToggle}
        onMoveToToday={onMoveToToday}
        onMoveToPool={onMoveToPool}
        onDelete={onDelete}
        onMove={onMove}
        onProgressChange={onProgressChange}
        onToggleTracking={onToggleTracking}
        onTrackingProgressChange={onTrackingProgressChange}
        onReopen={onReopen}
        onCompleteAndTrack={onCompleteAndTrack}
        finishMode={finishMode}
        onAddTrackingNote={onAddTrackingNote}
        onDeleteTrackingNote={onDeleteTrackingNote}
        onAddSubtask={allowSubtasks ? () => setAdding((v) => !v) : undefined}
      />

      {adding && (
        <form className="subtask-add" onSubmit={submit}>
          <span className="subtask-add__bend" aria-hidden="true" />
          <input
            className="subtask-add__input"
            autoFocus
            value={draft}
            aria-label={`为「${node.task.title}」添加子任务`}
            placeholder="二级任务，回车确认"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setAdding(false)
                setDraft('')
              }
            }}
          />
          <button type="submit" className="btn btn--xs btn--primary">
            添加
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="收起子任务输入框"
            onClick={() => {
              setAdding(false)
              setDraft('')
            }}
          >
            ✕
          </button>
        </form>
      )}

      {showChildren && node.children.length > 0 && (
        <ul className="subtask-list">
          {node.children.map((child) => (
            <li className="task-node task-node--sub" key={child.id}>
              <TaskItem
                task={child}
                today={today}
                context={context}
                depth={1}
                onEdit={onEdit}
                onToggle={onToggle}
                onMoveToToday={onMoveToToday}
                onMoveToPool={onMoveToPool}
                onDelete={onDelete}
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}
