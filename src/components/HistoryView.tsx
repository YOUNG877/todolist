import { useMemo, useState } from 'react'
import { formatShortDate } from '@/core/date'
import {
  buildTaskTree,
  completedCountOn,
  selectStreak,
  selectTrash,
  sortManual,
} from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { CompletedCalendar } from './CompletedCalendar'
import { TaskNode } from './TaskNode'

/** 回顾页：历史完成记录（日历 + 选中日清单 + 统计 + 回收站） */
export function HistoryView({ today }: { today: string }): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const snapshots = useStore((s) => s.snapshots)
  const calendarMode = useStore((s) => s.ui.calendarMode)
  const [selectedDate, setSelectedDate] = useState(today)

  // 跨天后把选中日期跟到新的今天
  const [lastToday, setLastToday] = useState(today)
  if (lastToday !== today) {
    setLastToday(today)
    setSelectedDate(today)
  }

  const trash = useMemo(() => selectTrash(tasks), [tasks])
  const todayCount = completedCountOn(tasks, snapshots, today)
  const streak = useMemo(() => selectStreak(tasks, snapshots, today), [tasks, snapshots, today])
  const totalDone = useMemo(
    () => tasks.filter((t) => !t.parentId && t.status === 'done' && !t.deletedAt).length,
    [tasks],
  )
  const monthCount = useMemo(() => {
    const prefix = today.slice(0, 7)
    let sum = 0
    const dates = new Set(
      tasks
        .filter(
          (t) =>
            !t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate?.startsWith(prefix),
        )
        .map((t) => t.completedDate as string),
    )
    for (const d of dates) sum += completedCountOn(tasks, snapshots, d)
    return sum
  }, [tasks, snapshots, today])

  const dayTasks = useMemo(
    () =>
      sortManual(
        tasks.filter(
          (t) =>
            !t.parentId && t.status === 'done' && !t.deletedAt && t.completedDate === selectedDate,
        ),
      ),
    [tasks, selectedDate],
  )
  const dayNodes = useMemo(() => buildTaskTree(dayTasks, tasks), [dayTasks, tasks])

  const selectedCount = dayTasks.length

  return (
    <section className="panel panel--history" aria-label="已完成回顾">
      <div className="panel__head">
        <div>
          <h2 className="panel__title">已完成回顾</h2>
          <p className="panel__sub">按日期回看每一天完成了什么</p>
        </div>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => actions.setView('board')}
        >
          ← 回到今天
        </button>
      </div>

      <div
        className={`panel__body panel__body--split${
          calendarMode === 'detail' ? ' panel__body--split-wide' : ''
        }`}
      >
        <CompletedCalendar
          today={today}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />

        <div className="day-detail">
          <div className="stat-cards">
            <div className="stat">
              <span className="stat__value">
                {todayCount}
                <small>件</small>
              </span>
              <span className="stat__label">今天完成</span>
            </div>
            <div className="stat">
              <span className="stat__value">
                {streak.current}
                <small>天</small>
              </span>
              <span className="stat__label">连续打卡</span>
            </div>
            <div className="stat">
              <span className="stat__value">
                {streak.best}
                <small>天</small>
              </span>
              <span className="stat__label">最长纪录</span>
            </div>
            <div className="stat">
              <span className="stat__value">
                {monthCount}
                <small>/ {totalDone}</small>
              </span>
              <span className="stat__label">本月 / 累计</span>
            </div>
          </div>

          <div className="day-detail__head">
            <h3 className="day-detail__title">
              {selectedDate === today ? '今天' : formatShortDate(selectedDate)}
            </h3>
            <span className="chip chip--muted">
              完成 {selectedCount} 件
              {selectedDate === today ? ` · ${formatShortDate(today)}` : ''}
            </span>
          </div>

          {selectedCount === 0 ? (
            <p className="empty empty--sm">
              {selectedDate === today
                ? '今天还没有完成的任务，打勾后会自动归档到这里。'
                : '这一天没有完成记录。'}
            </p>
          ) : (
            <ul className="task-list">
              {dayNodes.map((node) => (
                <TaskNode
                  key={node.task.id}
                  node={node}
                  today={today}
                  context="done"
                  allowSubtasks={false}
                  onToggle={actions.toggleComplete}
                  onMoveToToday={actions.moveToToday}
                  onMoveToPool={actions.moveToPool}
                  onDelete={actions.deleteTask}
                />
              ))}
            </ul>
          )}

          {trash.length > 0 && (
            <details className="trash">
              <summary className="trash__summary">回收站（{trash.length}）</summary>
              <ul className="task-list">
                {trash.map((task) => (
                  <li key={task.id} className="task task--flat">
                    <div className="task__body">
                      <span className="task__title">{task.title}</span>
                      <div className="task__meta">
                        <span className="time">
                          {task.deletedAt ? `${task.deletedAt.slice(0, 10)} 删除` : '已删除'}
                        </span>
                      </div>
                    </div>
                    <div className="task__actions">
                      <button
                        type="button"
                        className="btn btn--xs"
                        onClick={() => actions.restoreTask(task.id)}
                      >
                        恢复
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        aria-label={`彻底删除：${task.title}`}
                        onClick={() => actions.purgeTask(task.id)}
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn btn--xs btn--danger"
                onClick={() => {
                  if (window.confirm('清空回收站？此操作不可恢复。')) actions.emptyTrash()
                }}
              >
                清空回收站
              </button>
            </details>
          )}
        </div>
      </div>
    </section>
  )
}
