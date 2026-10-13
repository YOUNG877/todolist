import { useEffect, useState } from 'react'
import { clock } from '@/core/clock'
import { logicalDateOf } from '@/core/date'
import { actions, useStore } from '@/store/store'
import { BacklogPanel } from './components/BacklogPanel'
import { DebugPanel } from './components/DebugPanel'
import { HistoryView } from './components/HistoryView'
import { RolloverNotice } from './components/RolloverNotice'
import { TodayDonePanel } from './components/TodayDonePanel'
import { TodayPanel } from './components/TodayPanel'
import { TopBar } from './components/TopBar'

export default function App(): JSX.Element {
  const hydrated = useStore((s) => s.hydrated)
  const settings = useStore((s) => s.settings)
  const storageWarning = useStore((s) => s.storageWarning)
  const view = useStore((s) => s.ui.view)
  // 订阅结算结果，保证跨天 / 时间旅行后整个界面跟着换日期
  const settledToday = useStore((s) => s.lastSettle?.today ?? null)
  const [debugOpen, setDebugOpen] = useState(false)

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

  return (
    <div className="app">
      <h1 className="visually-hidden">待办事项管理</h1>
      <TopBar today={today} debugOpen={debugOpen} onToggleDebug={() => setDebugOpen((v) => !v)} />

      {storageWarning && (
        <div className="banner banner--warn" role="alert">
          <span className="banner__tag">注意</span>
          <span>{storageWarning}</span>
        </div>
      )}

      <RolloverNotice today={today} />
      {debugOpen && <DebugPanel today={today} />}

      {view === 'history' ? (
        <main className="layout layout--single">
          <HistoryView today={today} />
        </main>
      ) : (
        <main className="layout">
          <BacklogPanel today={today} />
          <TodayPanel today={today} />
          <TodayDonePanel today={today} />
        </main>
      )}
    </div>
  )
}
