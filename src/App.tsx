import { useEffect, useState } from 'react'
import { clock } from '@/core/clock'
import { logicalDateOf } from '@/core/date'
import { actions, useStore } from '@/store/store'
import { BacklogPanel } from './components/BacklogPanel'
import { DebugPanel } from './components/DebugPanel'
import { ExportDialog } from './components/ExportDialog'
import { HistoryView } from './components/HistoryView'
import { RolloverNotice } from './components/RolloverNotice'
import { TagManagerDialog } from './components/TagManagerDialog'
import { TaskEditorModal } from './components/TaskEditorModal'
import { TodayDonePanel } from './components/TodayDonePanel'
import { TodayPanel } from './components/TodayPanel'
import { TrackingPanel } from './components/TrackingPanel'
import { TopBar } from './components/TopBar'
import { WidgetView } from './components/WidgetView'

/** 悬浮小窗模式（?widget=1），由 Electron 主进程在关闭主窗口时打开 */
function isWidgetMode(): boolean {
  return new URLSearchParams(window.location.search).get('widget') === '1'
}

export default function App(): JSX.Element {
  const hydrated = useStore((s) => s.hydrated)
  const settings = useStore((s) => s.settings)
  const storageWarning = useStore((s) => s.storageWarning)
  const view = useStore((s) => s.ui.view)
  const tagFilter = useStore((s) => s.ui.tagFilter)
  // 订阅结算结果，保证跨天 / 时间旅行后整个界面跟着换日期
  const settledToday = useStore((s) => s.lastSettle?.today ?? null)
  const [debugOpen, setDebugOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [editorTaskId, setEditorTaskId] = useState<string | null>(null)
  const widget = isWidgetMode()

  const today = settledToday ?? logicalDateOf(clock.now(), settings.dayStartHour)

  /* 启动：读盘 → 结构校验 → 首次结算 */
  useEffect(() => {
    actions.init()
    // 演示模式：http://localhost:5173/?demo=1 —— 只在空数据时补示例内容
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      if (useStore.getState().tasks.length === 0) {
        actions.loadSampleData()
        actions.loadDemoHistory()
      }
    }
  }, [])

  /* 结算触发时机：窗口重获焦点 + 每分钟心跳（需求 FR-06） */
  useEffect(() => {
    const handleFocus = (): void => {
      actions.runSettle()
    }
    const handleVisibility = (): void => {
      if (document.visibilityState === 'visible') actions.runSettle()
    }
    window.addEventListener('focus', handleFocus)
    document.addEventListener('visibilitychange', handleVisibility)
    const timer = window.setInterval(handleFocus, 60_000)
    return () => {
      window.removeEventListener('focus', handleFocus)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(timer)
    }
  }, [])

  /* 主题与动效（FR-18 / FR-22） */
  useEffect(() => {
    const root = document.documentElement
    // 部分环境（老浏览器 / 内嵌 WebView / jsdom）没有 matchMedia，必须兜底
    const media =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null
    const apply = (): void => {
      const prefersDark = media?.matches ?? false
      const dark = settings.theme === 'dark' || (settings.theme === 'system' && prefersDark)
      root.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    root.dataset.animation = settings.animation ? 'on' : 'off'
    media?.addEventListener('change', apply)
    return () => media?.removeEventListener('change', apply)
  }, [settings.theme, settings.animation])

  if (!hydrated) {
    return (
      <div className="boot">
        <span className="boot__spinner" aria-hidden="true" />
        <p>正在加载本地数据…</p>
      </div>
    )
  }

  if (widget) {
    return <WidgetView today={today} onEditTask={setEditorTaskId} />
  }

  const openEditor = (id: string): void => setEditorTaskId(id)

  return (
    <div className="app">
      <h1 className="visually-hidden">待办事项管理</h1>
      <TopBar
        today={today}
        debugOpen={debugOpen}
        onToggleDebug={() => setDebugOpen((v) => !v)}
        onOpenExport={() => setExportOpen(true)}
        onOpenTags={() => setTagsOpen(true)}
      />

      {storageWarning && (
        <div className="banner banner--warn" role="alert">
          <span className="banner__tag">注意</span>
          <span>{storageWarning}</span>
        </div>
      )}

      {tagFilter.length > 0 && (
        <div className="banner banner--filter" role="status">
          <span className="banner__icon" aria-hidden="true">
            #
          </span>
          <span>
            正在按标签筛选：
            {tagFilter.map((tag) => (
              <span key={tag} className="chip chip--tag banner__chip">
                #{tag}
              </span>
            ))}
          </span>
          <div className="topbar__spacer" />
          <button type="button" className="btn btn--xs" onClick={actions.clearTagFilter}>
            清除筛选
          </button>
        </div>
      )}

      <RolloverNotice today={today} />
      {debugOpen && <DebugPanel today={today} />}

      {view === 'history' ? (
        <main className="layout layout--single">
          <HistoryView today={today} onOpenExport={() => setExportOpen(true)} onEdit={openEditor} />
        </main>
      ) : (
        <main className="layout">
          <BacklogPanel today={today} onEdit={openEditor} />
          <TodayPanel today={today} onEdit={openEditor} />
          {/* 右栏叠放：待追踪在上（进行中），今日已完成在下（归档）。
              不并成第 4 列，是因为那样会把中间的今日待办挤到 350px 左右。 */}
          <div className="board__side">
            <TrackingPanel today={today} onEdit={openEditor} />
            <TodayDonePanel today={today} onEdit={openEditor} />
          </div>
        </main>
      )}

      {exportOpen && <ExportDialog today={today} onClose={() => setExportOpen(false)} />}
      {tagsOpen && <TagManagerDialog onClose={() => setTagsOpen(false)} />}
      {editorTaskId && (
        <TaskEditorModal
          taskId={editorTaskId}
          onClose={() => setEditorTaskId(null)}
          onManageTags={() => {
            setEditorTaskId(null)
            setTagsOpen(true)
          }}
        />
      )}
    </div>
  )
}
