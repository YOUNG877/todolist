import { useMemo, useState } from 'react'
import { buildTaskTree, selectTodayProgress, selectTodayTasks } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { QuickAdd } from './QuickAdd'
import { TaskNode } from './TaskNode'

declare global {
  interface Window {
    /** 由 Electron preload 注入；浏览器里不存在 */
    desktop?: {
      hideWidget: () => void
      openMain: () => void
      quit: () => void
    }
  }
}

export interface WidgetViewProps {
  today: string
  onEditTask: (id: string) => void
}

/**
 * 桌面悬浮小窗（?widget=1）。
 *
 * 由 Electron 主进程在用户「关闭」主窗口时创建/显示：无边框、置顶、贴屏幕右上角，
 * 只显示今天的待办，打勾即可完成。顶栏区域可拖动窗口。
 *
 * 与主窗口共用同一个 app://local 来源，所以 localStorage 是同一份；
 * 两边通过 storage 事件自动同步（见 store/persist.ts）。
 */
export function WidgetView({ today, onEditTask }: WidgetViewProps): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const [collapsed, setCollapsed] = useState(false)

  const todayTasks = useMemo(() => selectTodayTasks(tasks, today), [tasks, today])
  const nodes = useMemo(() => buildTaskTree(todayTasks, tasks), [todayTasks, tasks])
  const progress = useMemo(() => selectTodayProgress(tasks, today), [tasks, today])

  const desktop = typeof window !== 'undefined' ? window.desktop : undefined

  return (
    <div className={`widget${collapsed ? ' widget--collapsed' : ''}`}>
      <header className="widget__bar">
        <span className="widget__title">
          今日待办
          <span className="widget__count">
            {progress.completed}/{progress.total}
          </span>
        </span>

        <div className="widget__tools">
          <button
            type="button"
            className="widget__btn"
            aria-label="打开主窗口"
            title="打开主窗口"
            onClick={() => desktop?.openMain()}
          >
            ⤢
          </button>
          <button
            type="button"
            className="widget__btn"
            aria-label={collapsed ? '展开' : '收起'}
            title={collapsed ? '展开' : '收起'}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? '▾' : '▴'}
          </button>
          <button
            type="button"
            className="widget__btn widget__btn--close"
            aria-label="隐藏悬浮窗"
            title="隐藏悬浮窗"
            onClick={() => {
              // 浏览器里没有 desktop 桥接，退化成收起，避免按钮点了没反应
              if (desktop) desktop.hideWidget()
              else setCollapsed(true)
            }}
          >
            ✕
          </button>
        </div>
      </header>

      {!collapsed && (
        <>
          <div className="widget__progress">
            <div className="progress">
              <div className="progress__bar" style={{ width: `${Math.round(progress.rate * 100)}%` }} />
            </div>
          </div>

          <div className="widget__body">
            {nodes.length === 0 ? (
              <p className="widget__empty">
                {progress.total > 0 ? '今天的任务全部完成 🎉' : '今天还没有安排任务'}
              </p>
            ) : (
              <ul className="task-list task-list--compact">
                {nodes.map((node) => (
                  <TaskNode
                    key={node.task.id}
                    node={node}
                    today={today}
                    context="today"
                    allowSubtasks={false}
                    onEdit={onEditTask}
                    onToggle={actions.toggleComplete}
                    onMoveToToday={actions.moveToToday}
                    onMoveToPool={actions.moveToPool}
                    onDelete={actions.deleteTask}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* 小窗底部随时加一条今天的任务，回车即可 */}
          <footer className="widget__foot">
            <QuickAdd toToday compact ariaLabel="添加今日任务（悬浮窗）" placeholder="加一条今天要做的事…" />
          </footer>
        </>
      )}
    </div>
  )
}
