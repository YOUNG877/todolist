import { useState } from 'react'
import { clock } from '@/core/clock'
import { actions, useStore } from '@/store/store'
import type { RolloverStrategy } from '@/store/types'

/**
 * 时间调试面板（需求 6.6）—— 用于验证跨天顺延。
 * 时间旅行只影响内存中的时钟，不写入数据。
 */
export function DebugPanel({ today }: { today: string }): JSX.Element {
  const settings = useStore((s) => s.settings)
  const lastSettle = useStore((s) => s.lastSettle)
  const snapshots = useStore((s) => s.snapshots)
  const lastSettledDate = useStore((s) => s.lastSettledDate)
  const [detailOpen, setDetailOpen] = useState(false)

  const snapshotDates = Object.keys(snapshots).sort()

  return (
    <div className="debug">
      <div className="debug__row">
        <span className="debug__tag">时间调试</span>
        <span className="debug__item">
          逻辑日期 <code>{today}</code>
        </span>
        <span className="debug__item">
          上次结算 <code>{lastSettledDate ?? '未初始化'}</code>
        </span>
        <span className="debug__item">
          偏移{' '}
          <code>
            {clock.offsetDays >= 0 ? '+' : ''}
            {clock.offsetDays} 天
          </code>
        </span>

        <button type="button" className="btn btn--xs btn--primary" onClick={() => actions.travelDays(1)}>
          +1 天
        </button>
        <button type="button" className="btn btn--xs" onClick={() => actions.travelDays(7)}>
          +7 天
        </button>
        <button type="button" className="btn btn--xs btn--ghost" onClick={() => actions.resetClock()}>
          时间归零
        </button>
        <button
          type="button"
          className="btn btn--xs btn--ghost"
          aria-expanded={detailOpen}
          onClick={() => setDetailOpen((v) => !v)}
        >
          {detailOpen ? '收起设置' : '顺延设置与快照'}
        </button>

        {lastSettle && (
          <span className="debug__item debug__item--muted">
            最近一次：顺延 {lastSettle.rolled.length} · 退回池中 {lastSettle.returnedToPool.length} · 清理{' '}
            {lastSettle.purgedIds.length}
          </span>
        )}
      </div>

      {detailOpen && (
        <div className="debug__detail">
          <div className="debug__controls">
            <label className="field">
              <span className="field__label">日界</span>
              <select
                className="select select--sm"
                value={settings.dayStartHour}
                onChange={(e) => actions.setSettings({ dayStartHour: Number(e.target.value) })}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field__label">顺延策略</span>
              <select
                className="select select--sm"
                value={settings.rolloverStrategy}
                onChange={(e) =>
                  actions.setSettings({ rolloverStrategy: e.target.value as RolloverStrategy })
                }
              >
                <option value="all">全部顺延</option>
                <option value="pinned-only">仅必做任务顺延</option>
                <option value="ask">每次询问</option>
              </select>
            </label>

            <label className="field">
              <span className="field__label">顺延上限</span>
              <input
                type="number"
                min={0}
                className="input input--sm"
                value={settings.rolloverMaxDays}
                onChange={(e) => actions.setSettings({ rolloverMaxDays: Number(e.target.value) })}
              />
              <span className="field__hint">天，0 = 不限</span>
            </label>

            <label className="field">
              <span className="field__label">周末也计延期</span>
              <input
                type="checkbox"
                checked={settings.countWeekends}
                aria-label="周末也计入延期天数"
                onChange={(e) => actions.setSettings({ countWeekends: e.target.checked })}
              />
              <span className="field__hint">
                不勾：周六日算节假日，延到周末不增加延期天数
              </span>
            </label>
          </div>

          {snapshotDates.length === 0 ? (
            <p className="debug__hint">
              还没有历史快照。点「+1 天」并留下未完成任务，就会生成逐日快照。
            </p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th className="num">计划</th>
                    <th className="num">完成</th>
                    <th className="num">顺延出</th>
                    <th className="num">退回池</th>
                    <th className="num">完成率</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotDates.map((date) => {
                    const s = snapshots[date]
                    return (
                      <tr key={date}>
                        <td>{date}</td>
                        <td className="num">{s.planned}</td>
                        <td className="num">{s.completed}</td>
                        <td className="num">{s.carriedOutIds.length}</td>
                        <td className="num">{s.returnedToPoolIds.length}</td>
                        <td className="num">{Math.round(s.completionRate * 100)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
