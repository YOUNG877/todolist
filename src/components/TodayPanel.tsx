import { useMemo } from 'react'
import { filterByTags } from '@/core/filters'
import {
  buildTaskTree,
  selectStreak,
  selectTodayProgress,
  selectTodayTasks,
  selectTotalEstimatedMinutes,
  sortByMode,
} from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { QuickAdd } from './QuickAdd'
import { TaskNode } from './TaskNode'

export function TodayPanel({
  today,
  onEdit,
}: {
  today: string
  onEdit: (id: string) => void
}): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const snapshots = useStore((s) => s.snapshots)
  const sortMode = useStore((s) => s.ui.sortMode)
  const tagFilter = useStore((s) => s.ui.tagFilter)

  const visible = useMemo(() => filterByTags(tasks, tagFilter), [tasks, tagFilter])
  const todayTasks = useMemo(
    () => sortByMode(selectTodayTasks(visible, today), sortMode),
    [visible, today, sortMode],
  )
  const nodes = useMemo(() => buildTaskTree(todayTasks, visible), [todayTasks, visible])
  const progress = useMemo(() => selectTodayProgress(tasks, today), [tasks, today])
  const streak = useMemo(() => selectStreak(tasks, snapshots, today), [tasks, snapshots, today])
  const totalMinutes = selectTotalEstimatedMinutes(todayTasks)
  const manual = sortMode === 'manual'
  const percent = Math.round(progress.rate * 100)
  const allDone = progress.total > 0 && progress.completed === progress.total

  return (
    <section className="panel panel--today" aria-label="今日待办">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">
            今日待办 <span className="panel__count">{progress.completed}/{progress.total}</span>
          </h2>
          <p className="panel__sub">
            完成率 {percent}%
            {totalMinutes > 0 && <> · 预计 {(totalMinutes / 60).toFixed(1)} 小时</>}
            {streak.current > 0 && <> · 连续 {streak.current} 天</>}
          </p>
        </div>
        <select
          className="select"
          aria-label="排序方式"
          value={sortMode}
          onChange={(e) => actions.setSortMode(e.target.value as typeof sortMode)}
        >
          <option value="manual">手动排序</option>
          <option value="priority">按优先级</option>
          <option value="created">按创建时间</option>
        </select>
      </div>

      <div className="panel__body">
        <div
          className={`progress${allDone ? ' progress--full' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <div className="progress__bar" style={{ width: `${percent}%` }} />
        </div>

        <QuickAdd toToday placeholder="直接添加到今天…" ariaLabel="添加今日任务" />

        {todayTasks.length === 0 ? (
          <p className="empty">
            {tagFilter.length > 0
              ? '当前筛选下没有今日待办。'
              : progress.completed > 0
                ? `今天的任务全部完成，共 ${progress.completed} 件 🎉`
                : '今天还没有安排任务，从左边挑几件吧'}
          </p>
        ) : (
          <ul className="task-list">
            {nodes.map((node, index) => (
              <TaskNode
                key={node.task.id}
                node={node}
                today={today}
                context="today"
                index={index}
                listLength={nodes.length}
                onEdit={onEdit}
                onToggle={actions.toggleComplete}
                onMoveToToday={actions.moveToToday}
                onMoveToPool={actions.moveToPool}
                onDelete={actions.deleteTask}
                onMove={manual ? actions.moveTask : undefined}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
