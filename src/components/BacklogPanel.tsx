import { useMemo, useState } from 'react'
import { filterByTags } from '@/core/filters'
import { buildTaskTree, selectPoolTasks, selectScheduledFuture, sortByMode } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { QuickAdd } from './QuickAdd'
import { TaskNode } from './TaskNode'

export function BacklogPanel({
  today,
  onEdit,
}: {
  today: string
  onEdit: (id: string) => void
}): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const sortMode = useStore((s) => s.ui.sortMode)
  const tagFilter = useStore((s) => s.ui.tagFilter)
  const [selected, setSelected] = useState<string[]>([])

  const visible = useMemo(() => filterByTags(tasks, tagFilter), [tasks, tagFilter])
  const pool = useMemo(() => sortByMode(selectPoolTasks(visible), sortMode), [visible, sortMode])
  const poolNodes = useMemo(() => buildTaskTree(pool, visible), [pool, visible])
  const future = useMemo(
    () => sortByMode(selectScheduledFuture(visible, today), sortMode),
    [visible, today, sortMode],
  )

  // 选中态只保留仍然存在于池子里的 id，避免删掉任务后计数虚高
  const selectedInPool = useMemo(
    () => selected.filter((id) => pool.some((t) => t.id === id)),
    [selected, pool],
  )
  const allSelected = pool.length > 0 && selectedInPool.length === pool.length

  const toggleSelected = (id: string): void => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = (): void => {
    setSelected(allSelected ? [] : pool.map((t) => t.id))
  }

  const moveSelected = (): void => {
    actions.moveManyToToday(selectedInPool)
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
        {pool.length > 0 && (
          <label className="checkbox-field checkbox-field--head">
            <input
              type="checkbox"
              aria-label="全选待办池任务"
              checked={allSelected}
              onChange={toggleSelectAll}
            />
            全选
          </label>
        )}
      </div>

      <div className="panel__body">
        <QuickAdd toToday={false} placeholder="记一件想做的事…" ariaLabel="添加待办" />

        {pool.length === 0 ? (
          <p className="empty">
            {tagFilter.length > 0 ? '当前筛选下没有待办池任务。' : '池子空空的，记一件想做的事吧 👇'}
          </p>
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
                /* 选择框在最前，完成框退到行尾——两个圆圈并排容易点错 */
                leading={
                  <input
                    type="checkbox"
                    className="task__select"
                    aria-label={`选中：${node.task.title}`}
                    checked={selectedInPool.includes(node.task.id)}
                    onChange={() => toggleSelected(node.task.id)}
                  />
                }
                completionLast
                onEdit={onEdit}
                onToggle={actions.toggleComplete}
                onMoveToToday={actions.moveToToday}
                onMoveToPool={actions.moveToPool}
                onDelete={actions.deleteTask}
              />
            ))}
          </ul>
        )}

        {future.length > 0 && (
          <div className="subsection">
            <h3 className="subsection__title">已排期（未来 {future.length}）</h3>
            <ul className="task-list">
              {buildTaskTree(future, visible).map((node) => (
                <TaskNode
                  key={node.task.id}
                  node={node}
                  today={today}
                  context="future"
                  onEdit={onEdit}
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
          disabled={selectedInPool.length === 0}
          onClick={moveSelected}
        >
          安排选中的 {selectedInPool.length} 个到今日
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
