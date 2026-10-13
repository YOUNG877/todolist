import { useState, type FormEvent } from 'react'
import { actions } from '@/store/store'

export interface QuickAddProps {
  /** true = 直接创建到今日列表 */
  toToday: boolean
  placeholder?: string
  ariaLabel: string
  /** 紧凑模式：不显示「添加」按钮，只靠回车提交（悬浮小窗那种窄容器用） */
  compact?: boolean
}

/** 快速录入（FR-01）。行内语法（!高 / #标签 / @日期 / ~30m）留到后续里程碑。 */
export function QuickAdd({
  toToday,
  placeholder,
  ariaLabel,
  compact = false,
}: QuickAddProps): JSX.Element {
  const [value, setValue] = useState('')
  const [shake, setShake] = useState(false)

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const title = value.trim()
    if (!title) {
      setShake(true)
      window.setTimeout(() => setShake(false), 240)
      return
    }
    actions.addTask({ title, toToday })
    setValue('')
  }

  return (
    <form
      className={`quick-add${compact ? ' quick-add--compact' : ''}${shake ? ' is-shaking' : ''}`}
      onSubmit={submit}
    >
      <span className="quick-add__plus" aria-hidden="true">
        +
      </span>
      <input
        className="quick-add__input"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder ?? '添加任务，回车确认'}
        onChange={(e) => setValue(e.target.value)}
      />
      {!compact && (
        <button type="submit" className="btn btn--xs btn--primary" tabIndex={-1}>
          添加
        </button>
      )}
    </form>
  )
}
