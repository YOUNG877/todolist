import { useMemo } from 'react'
import { buildTaskTree } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { TaskNode } from './TaskNode'

/**
 * 待追踪（用户要求：与「今日已完成」分开，单独成列表）。
 *
 * 放的是「事情做完了、但结果还要继续跟」的任务。这类任务跨天存在是常态，
 * 所以**不按完成日期过滤**——只要还在追踪就一直留在这里，
 * 直到点「完成」结束追踪（否则隔天就从界面上消失，追踪就失去意义了）。
 *
 * 这里的勾选框语义是「完成」而不是「取消完成」（finishMode）：
 * 任务早就完成了，点它表示收尾、结束追踪，之后回到「今日已完成」
 * （或按原完成日期回到「回顾」里的那一天）。
 */
export function TrackingPanel({
  today,
  onEdit,
}: {
  today: string
  onEdit: (id: string) => void
}): JSX.Element {
  const tasks = useStore((s) => s.tasks)

  const tracked = useMemo(
    () =>
      tasks
        .filter((t) => !t.parentId && t.tracking && t.completedAt && !t.deletedAt)
        // 最近完成的排前面：刚移交过来的应该一眼看到
        .sort((a, b) => (a.completedAt! < b.completedAt! ? 1 : -1)),
    [tasks],
  )

  const nodes = useMemo(() => buildTaskTree(tracked, tasks), [tracked, tasks])
  const activeCount = tracked.filter((t) => t.trackingProgress < 100).length

  return (
    <section className="panel panel--tracking" aria-label="待追踪">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            待追踪 <span className="panel__count">{tracked.length}</span>
          </h2>
          <p className="panel__sub">
            {tracked.length > 0
              ? `已完成但还要跟结果${activeCount > 0 ? `，${activeCount} 件未收尾` : ''}`
              : '做完了但结果还要继续盯的任务'}
          </p>
        </div>
      </div>

      <div className="panel__body">
        {nodes.length === 0 ? (
          <p className="empty empty--sm">
            暂无追踪中的任务。在今日待办里点「→ 追踪」，把需要跟进结果的任务移交到这里。
          </p>
        ) : (
          <ul className="task-list">
            {nodes.map((node) => (
              <TaskNode
                key={node.task.id}
                node={node}
                today={today}
                context="done"
                allowSubtasks={false}
                showChildren={false}
                finishMode
                onEdit={onEdit}
                /* 勾选框 = 完成收尾（不是取消完成，那样会把任务退回今日待办） */
                onToggle={actions.stopTracking}
                onMoveToToday={actions.moveToToday}
                onMoveToPool={actions.moveToPool}
                onDelete={actions.deleteTask}
                onTrackingProgressChange={actions.setTrackingProgress}
                onReopen={actions.reopenTask}
                onAddTrackingNote={actions.addTrackingNote}
                onDeleteTrackingNote={actions.deleteTrackingNote}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
