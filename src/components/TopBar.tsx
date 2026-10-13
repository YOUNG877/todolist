import { useMemo, useRef, useState } from 'react'
import { formatDisplayDate } from '@/core/date'
import { selectAllTags } from '@/core/selectors'
import { actions, useStore } from '@/store/store'

export interface TopBarProps {
  today: string
  debugOpen: boolean
  onToggleDebug: () => void
  onOpenExport: () => void
  onOpenTags: () => void
}

export function TopBar({
  today,
  debugOpen,
  onToggleDebug,
  onOpenExport,
  onOpenTags,
}: TopBarProps): JSX.Element {
  const settings = useStore((s) => s.settings)
  const tasks = useStore((s) => s.tasks)
  const taskCount = tasks.length
  const view = useStore((s) => s.ui.view)
  const tagFilter = useStore((s) => s.ui.tagFilter)
  // 注意：选择器必须返回稳定引用。selectAllTags 每次都生成新数组，
  // 直接写进 useStore(...) 会让 zustand 判定快照变化、触发无限重渲染。
  const allTags = useMemo(() => selectAllTags(tasks), [tasks])
  const fileRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagMenuOpen, setTagMenuOpen] = useState(false)

  const exportJSON = (): void => {
    setMenuOpen(false)
    const json = actions.exportJSON()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `todolist-backup-${today.replace(/-/g, '')}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJSON = async (file: File): Promise<void> => {
    const text = await file.text()
    const result = actions.importJSON(text)
    if (!result.ok) window.alert(result.error)
  }

  const clearAll = (): void => {
    setMenuOpen(false)
    const answer = window.prompt('此操作不可恢复，请输入「确认清空」：')
    if (answer === '确认清空') actions.clearAll()
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand__mark" aria-hidden="true">
          ✓
        </span>
        <span className="brand__name">今日待办</span>
      </div>

      <span className="date-pill">{formatDisplayDate(today)}</span>

      <nav className="segmented" aria-label="主视图切换">
        <button
          type="button"
          aria-current={view === 'board' ? 'page' : undefined}
          onClick={() => actions.setView('board')}
        >
          今天
        </button>
        <button
          type="button"
          aria-current={view === 'history' ? 'page' : undefined}
          onClick={() => actions.setView('history')}
        >
          回顾
        </button>
      </nav>

      <div className="topbar__spacer" />

      <div className="topbar__actions">
        {taskCount === 0 && (
          <button type="button" className="btn btn--sm" onClick={() => actions.loadSampleData()}>
            载入示例数据
          </button>
        )}

        <div className="menu-wrap">
          <button
            type="button"
            className={`btn btn--sm${tagFilter.length > 0 ? ' is-active' : ''}`}
            aria-expanded={tagMenuOpen}
            aria-label="按标签筛选"
            title="按标签筛选"
            onClick={() => setTagMenuOpen((v) => !v)}
          >
            <span aria-hidden="true">#</span>
            <span className="btn__label">
              标签{tagFilter.length > 0 ? ` ${tagFilter.length}` : ''}
            </span>
          </button>

          {tagMenuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setTagMenuOpen(false)} />
              <div className="menu menu--tags" role="menu">
                {allTags.length === 0 ? (
                  <p className="menu__empty">还没有标签。点下面「管理标签」或在任务编辑里添加。</p>
                ) : (
                  allTags.map((tag) => (
                    <label key={tag} className="menu__check">
                      <input
                        type="checkbox"
                        checked={tagFilter.includes(tag)}
                        onChange={() => actions.toggleTagFilter(tag)}
                      />
                      #{tag}
                    </label>
                  ))
                )}
                <div className="menu__sep" />
                {tagFilter.length > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={() => actions.clearTagFilter()}
                  >
                    清除筛选
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setTagMenuOpen(false)
                    onOpenTags()
                  }}
                >
                  管理标签…
                </button>
              </div>
            </>
          )}
        </div>

        <button
          type="button"
          className={`btn btn--sm${debugOpen ? ' is-active' : ''}`}
          aria-pressed={debugOpen}
          title="展开时间旅行面板，用来验证跨天顺延"
          onClick={onToggleDebug}
        >
          <span aria-hidden="true">🐞</span>
          <span className="btn__label">时间调试</span>
        </button>

        <button
          type="button"
          className="icon-btn"
          aria-label={settings.theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          title={settings.theme === 'dark' ? '亮色' : '暗色'}
          onClick={() => actions.setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        >
          {settings.theme === 'dark' ? '☀' : '☾'}
        </button>

        <div className="menu-wrap">
          <button
            type="button"
            className="icon-btn"
            aria-label="数据管理"
            aria-expanded={menuOpen}
            title="数据管理"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>

          {menuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
              <div className="menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenExport()
                  }}
                >
                  导出数据（按日期，适合述职）
                </button>
                <div className="menu__sep" />
                <button type="button" role="menuitem" className="menu__item" onClick={exportJSON}>
                  导出 JSON 备份
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setMenuOpen(false)
                    fileRef.current?.click()
                  }}
                >
                  导入 JSON 备份
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setMenuOpen(false)
                    actions.loadSampleData()
                  }}
                >
                  载入示例数据
                </button>
                <div className="menu__sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item menu__item--danger"
                  onClick={clearAll}
                >
                  清空全部数据
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importJSON(file)
          e.target.value = ''
        }}
      />
    </header>
  )
}
