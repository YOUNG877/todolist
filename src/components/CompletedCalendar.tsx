import { useMemo, useState } from 'react'
import {
  addMonths,
  buildMonthGrid,
  formatMonthLabel,
  formatShortDate,
  isSameMonth,
  startOfMonth,
  weekdayLabels,
} from '@/core/date'
import {
  completedCountOn,
  heatLevelOf,
  mapCompletedByDate,
  selectMonthStats,
  type HeatLevel,
} from '@/core/selectors'
import { actions, useStore } from '@/store/store'

/** 明细模式下每格最多直接列出的任务条数，超出显示 +N */
const MAX_TITLES_PER_DAY = 3

export interface CompletedCalendarProps {
  today: string
  selectedDate: string
  onSelectDate: (date: string) => void
}

export function CompletedCalendar({
  today,
  selectedDate,
  onSelectDate,
}: CompletedCalendarProps): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const snapshots = useStore((s) => s.snapshots)
  const weekStart = useStore((s) => s.settings.weekStart)
  const calendarMode = useStore((s) => s.ui.calendarMode)

  // 打开日历时默认定位到所选日期所在月份
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(selectedDate))

  const grid = useMemo(() => buildMonthGrid(monthCursor, weekStart), [monthCursor, weekStart])
  const weekdays = useMemo(() => weekdayLabels(weekStart), [weekStart])
  const monthStats = useMemo(
    () => selectMonthStats(tasks, snapshots, monthCursor),
    [tasks, snapshots, monthCursor],
  )
  /** date → 当天完成的任务（明细模式用） */
  const doneByDate = useMemo(() => mapCompletedByDate(tasks), [tasks])

  /** 每一天的 { 完成件数, 热力等级 } */
  const dayData = useMemo(() => {
    const map = new Map<string, { completed: number; level: HeatLevel }>()
    for (const date of grid) {
      const completed = completedCountOn(tasks, snapshots, date)
      const planned = snapshots[date]?.planned ?? 0
      map.set(date, { completed, level: heatLevelOf(completed, planned) })
    }
    return map
  }, [grid, tasks, snapshots])

  const goMonth = (delta: number): void => setMonthCursor((prev) => addMonths(prev, delta))
  const goToday = (): void => {
    setMonthCursor(startOfMonth(today))
    onSelectDate(today)
  }

  return (
    <div className="calendar">
      <div className="calendar__nav">
        <button type="button" className="icon-btn" aria-label="上个月" onClick={() => goMonth(-1)}>
          ‹
        </button>
        <span className="calendar__month" aria-live="polite">
          {formatMonthLabel(monthCursor)}
        </span>
        <button type="button" className="icon-btn" aria-label="下个月" onClick={() => goMonth(1)}>
          ›
        </button>
        <button type="button" className="btn btn--ghost btn--xs" onClick={goToday}>
          回到今天
        </button>

        <div className="segmented segmented--sm" role="group" aria-label="日历显示方式">
          <button
            type="button"
            aria-pressed={calendarMode === 'count'}
            onClick={() => actions.setCalendarMode('count')}
          >
            件数
          </button>
          <button
            type="button"
            aria-pressed={calendarMode === 'detail'}
            onClick={() => actions.setCalendarMode('detail')}
          >
            明细
          </button>
        </div>
      </div>

      <div className="calendar__weekdays" aria-hidden="true">
        {weekdays.map((w) => (
          <span key={w} className="calendar__weekday">
            {w}
          </span>
        ))}
      </div>

      <div
        className={`calendar__grid${calendarMode === 'detail' ? ' calendar__grid--detail' : ''}`}
        role="grid"
        aria-label={`${formatMonthLabel(monthCursor)}完成情况`}
      >
        {grid.map((date) => {
          const data = dayData.get(date) ?? { completed: 0, level: 0 as HeatLevel }
          const dayTasks = doneByDate.get(date) ?? []
          const outside = !isSameMonth(date, monthCursor)
          const isToday = date === today
          const isSelected = date === selectedDate
          const dayNumber = Number(date.slice(8, 10))
          const weekday = formatShortDate(date).slice(6)

          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-label={
                data.completed > 0
                  ? `${date} ${weekday}，完成 ${data.completed} 件`
                  : `${date} ${weekday}，无完成记录`
              }
              title={
                dayTasks.length > 0 ? dayTasks.map((t) => t.title).join('、') : undefined
              }
              className={[
                'day',
                `heat-${data.level}`,
                calendarMode === 'detail' ? 'day--detail' : '',
                outside ? 'day--outside' : '',
                isToday ? 'day--today' : '',
                isSelected ? 'day--selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelectDate(date)}
            >
              <span className="day__head">
                <span className="day__num">{dayNumber}</span>
                {(calendarMode === 'count' || data.completed > 0) && data.completed > 0 && (
                  <span className="day__count">{data.completed}</span>
                )}
              </span>

              {calendarMode === 'detail' && (
                <span className="day__list">
                  {dayTasks.slice(0, MAX_TITLES_PER_DAY).map((t) => (
                    <span key={t.id} className="day__task">
                      {t.title}
                    </span>
                  ))}
                  {dayTasks.length > MAX_TITLES_PER_DAY && (
                    <span className="day__more">+{dayTasks.length - MAX_TITLES_PER_DAY}</span>
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="calendar__foot">
        <span className="calendar__summary">
          本月完成 <strong>{monthStats.completed}</strong> 件 · 有记录{' '}
          <strong>{monthStats.activeDays}</strong> 天
        </span>
        <span className="calendar__legend" aria-hidden="true">
          少
          {([0, 1, 2, 3, 4] as HeatLevel[]).map((lv) => (
            <i key={lv} className={`legend-dot heat-${lv}`} />
          ))}
          多
        </span>
      </div>
    </div>
  )
}
