import { actions, useStore } from '@/store/store'

/** 顺延提示条（FR-06）：非阻塞，可关闭 */
export function RolloverNotice({ today }: { today: string }): JSX.Element | null {
  const notice = useStore((s) => s.ui.lastRolloverNotice)
  const enabled = useStore((s) => s.settings.showRolloverNotice)

  if (!enabled || !notice || notice.dismissed || notice.date !== today || notice.count === 0) {
    return null
  }

  return (
    <div className="banner banner--info" role="status">
      <span className="banner__icon" aria-hidden="true">
        ↻
      </span>
      <span>
        昨天有 <strong>{notice.count}</strong> 个任务没完成，已顺延到今天
      </span>
      <div className="topbar__spacer" />
      <button type="button" className="btn btn--xs" onClick={actions.dismissRolloverNotice}>
        知道了
      </button>
    </div>
  )
}
