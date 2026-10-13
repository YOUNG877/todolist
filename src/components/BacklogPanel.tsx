import { useMemo, useState } from 'react'
import { buildTaskTree, selectPoolTasks, selectScheduledFuture, sortByMode } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { QuickAdd } from './QuickAdd'
import { TaskNode } from './TaskNode'

export function BacklogPanel({ today }: { today: string }): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const sortMode = useStore((s) => s.ui.sortMode)
  const [selected, setSelected] = useState<string[]>([])

  const pool = useMemo(() => sortByMode(selectPoolTasks(tasks), sortMode), [tasks, sortMode])
  const poolNodes = useMemo(() => buildTaskTree(pool, tasks), [pool, tasks])
  const future = useMemo(
    () => sortByMode(selectScheduledFuture(tasks, today), sortMode),
    [tasks, today, sortMode],
  )

  const toggleSelected = (id: string): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const moveSelected = (): void => {
    actions.moveManyToToday(selected)
    setSelected([])
  }

  const moveAll = (): void => {
    if (pool.length === 0) return
    if (window.confirm(`将 ${pool.length} 个任务安排到今天？`)) {
      actions.moveAllToToday()
      setSelected([])
    }
  }

  return (
    <section className="panel panel--pool" aria-label="待办池">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            待办池 <span className="panel__count">{pool.length}</span>
          </h2>
          <p className="panel__sub">想做但还没安排到某一天的事</p>
        </div>
      </div>

      <div className="panel__body">
        <QuickAdd toToday={false} placeholder="记一件想做的事…" ariaLabel="添加待办" />

        {pool.length === 0 ? (
          <p className="empty">池子空空的，记一件想做的事吧 👇</p>
        ) : (
          <ul className="task-list">
            {poolNodes.map((node, index) => (
              <TaskNode
                key={node.task.id}
                node={node}
                today={today}
                context="pool"
                index={index}
                listLength={poolNodes.length}
                trailing={
                  <label className="task__pick" title="选中后可批量安排到今天">
                    <input
                      type="checkbox"
                      aria-label={`选中：${node.task.title}`}
                      checked={selected.includes(node.task.id)}
                      onChange={() => toggleSelected(node.task.id)}
                    />
                  </label>
                }
                onToggle={actions.toggleComplete}
                onMoveToToday={actions.moveToToday}
                onMoveToPool={actions.moveToPool}
                onDelete={actions.deleteTask}
                /* 待办池列窄，不放 ↑↓ 按钮（手动排序主要对「今日待办」有意义），
                   把宽度留给标题，避免「读《重构》30 页」这类标题被挤成三行 */
              />
            ))}
          </ul>
        )}

        {future.length > 0 && (
          <div className="subsection">
            <h3 className="subsection__title">已排期（未来 {future.length}）</h3>
            <ul className="task-list">
              {buildTaskTree(future, tasks).map((node) => (
                <TaskNode
                  key={node.task.id}
                  node={node}
                  today={today}
                  context="future"
                  onToggle={actions.toggleComplete}
                  onMoveToToday={actions.moveToToday}
                  onMoveToPool={actions.moveToPool}
                  onDelete={actions.deleteTask}
                />
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="panel__foot panel__foot--actions">
        <button
          type="button"
          className="btn btn--sm"
          disabled={selected.length === 0}
          onClick={moveSelected}
        >
          安排选中的 {selected.length} 个到今日
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={pool.length === 0}
          onClick={moveAll}
        >
          全部安排到今日
        </button>
      </div>
    </section>
  )
}
