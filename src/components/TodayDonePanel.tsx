import { useMemo } from 'react'
import { filterByTags } from '@/core/filters'
import { buildTaskTree, sortManual } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { TaskNode } from './TaskNode'

/**
 * 今日已完成（用户要求：今天完成的就放在这一页）。
 * 历史完成记录统一去「回顾」页看，两处不重复。
 */
export function TodayDonePanel({
  today,
  onEdit,
}: {
  today: string
  onEdit: (id: string) => void
}): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const tagFilter = useStore((s) => s.ui.tagFilter)

  const visible = useMemo(() => filterByTags(tasks, tagFilter), [tasks, tagFilter])
  const doneToday = useMemo(
    () =>
      sortManual(
        visible.filter(
          (t) => !t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate === today,
        ),
      ),
    [visible, today],
  )
  const nodes = useMemo(() => buildTaskTree(doneToday, visible), [doneToday, visible])

  return (
    <section className="panel panel--done" aria-label="今日已完成">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            今日已完成 <span className="panel__count">{doneToday.length}</span>
          </h2>
          <p className="panel__sub">打勾后自动归档到今天</p>
        </div>
      </div>

      <div className="panel__body">
        {doneToday.length === 0 ? (
          <p className="empty empty--sm">
            {tagFilter.length > 0
              ? '当前筛选下没有已完成的记录。'
              : '还没有完成的任务。打勾后会自动出现在这里。'}
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
                onEdit={onEdit}
                onToggle={actions.toggleComplete}
                onMoveToToday={actions.moveToToday}
                onMoveToPool={actions.moveToPool}
                onDelete={actions.deleteTask}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="panel__foot">
        <button type="button" className="btn btn--sm" onClick={() => actions.setView('history')}>
          查看历史回顾 →
        </button>
      </div>
    </section>
  )
}
