import { useEffect, useMemo, useRef, useState } from 'react'
import { startOfMonth } from '@/core/date'
import {
  buildExportData,
  exportFileName,
  recentRange,
  toCsv,
  toMarkdown,
} from '@/core/exporter'
import { useStore } from '@/store/store'

type RangePreset = 'year' | 'month' | '30d' | 'custom'
type Format = 'md' | 'csv'

export interface ExportDialogProps {
  today: string
  onClose: () => void
}

/** 预览区最多渲染这么多字符，避免长文档拖慢界面 */
const PREVIEW_LIMIT = 4000

export function ExportDialog({ today, onClose }: ExportDialogProps): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const snapshots = useStore((s) => s.snapshots)

  const [preset, setPreset] = useState<RangePreset>('year')
  const [from, setFrom] = useState(() => `${today.slice(0, 4)}-01-01`)
  const [to, setTo] = useState(today)
  const [format, setFormat] = useState<Format>('md')
  const [includeOpen, setIncludeOpen] = useState(false)
  const [includeNotes, setIncludeNotes] = useState(true)
  const [copied, setCopied] = useState(false)

  const firstFieldRef = useRef<HTMLSelectElement>(null)

  /* 打开时聚焦第一个控件，Esc 关闭 */
  useEffect(() => {
    firstFieldRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const applyPreset = (next: RangePreset): void => {
    setPreset(next)
    if (next === 'year') {
      setFrom(`${today.slice(0, 4)}-01-01`)
      setTo(today)
    } else if (next === 'month') {
      setFrom(startOfMonth(today))
      setTo(today)
    } else if (next === '30d') {
      const r = recentRange(today, 30)
      setFrom(r.from)
      setTo(r.to)
    }
  }

  const options = { from, to, includeOpen, includeNotes }
  const invalidRange = from > to

  const data = useMemo(
    () => (invalidRange ? null : buildExportData(tasks, snapshots, options)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, snapshots, from, to, includeOpen, includeNotes, invalidRange],
  )

  const content = useMemo(() => {
    if (!data) return ''
    return format === 'md' ? toMarkdown(data) : toCsv(data)
  }, [data, format])

  const download = (): void => {
    if (!content || !data) return
    const ext = format === 'md' ? 'md' : 'csv'
    const mime =
      format === 'md' ? 'text/markdown;charset=utf-8' : 'text/csv;charset=utf-8'
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName(data, ext)
    a.click()
    URL.revokeObjectURL(url)
  }

  const copy = async (): Promise<void> => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const preview = content.length > PREVIEW_LIMIT ? `${content.slice(0, PREVIEW_LIMIT)}\n…（预览已截断，下载得到完整内容）` : content

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-modal="true"
        aria-label="导出数据"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">导出数据</h2>
            <p className="modal__sub">
              按日期导出每天完成的事情，可直接用于年终述职
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <div className="export-controls">
            <label className="field field--stack">
              <span className="field__label">时间范围</span>
              <select
                ref={firstFieldRef}
                className="select"
                value={preset}
                onChange={(e) => applyPreset(e.target.value as RangePreset)}
              >
                <option value="year">本年（1 月 1 日至今）</option>
                <option value="month">本月</option>
                <option value="30d">最近 30 天</option>
                <option value="custom">自定义</option>
              </select>
            </label>

            <label className="field field--stack">
              <span className="field__label">起</span>
              <input
                type="date"
                className="input"
                value={from}
                max={to}
                onChange={(e) => {
                  setFrom(e.target.value)
                  setPreset('custom')
                }}
              />
            </label>

            <label className="field field--stack">
              <span className="field__label">止</span>
              <input
                type="date"
                className="input"
                value={to}
                min={from}
                onChange={(e) => {
                  setTo(e.target.value)
                  setPreset('custom')
                }}
              />
            </label>

            <label className="field field--stack">
              <span className="field__label">格式</span>
              <select
                className="select"
                value={format}
                onChange={(e) => setFormat(e.target.value as Format)}
              >
                <option value="md">Markdown（.md）</option>
                <option value="csv">CSV（.csv，给 Excel）</option>
              </select>
            </label>
          </div>

          <div className="export-toggles">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={includeOpen}
                onChange={(e) => setIncludeOpen(e.target.checked)}
              />
              附上未完成 / 进行中的任务
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={includeNotes}
                onChange={(e) => setIncludeNotes(e.target.checked)}
              />
              包含备注
            </label>
          </div>

          {invalidRange ? (
            <p className="empty empty--sm">起始日期不能晚于结束日期。</p>
          ) : data && data.totalCompleted === 0 ? (
            <p className="empty empty--sm">
              这个时间段还没有完成记录。换个范围，或先去打几个勾试试。
            </p>
          ) : (
            <>
              <div className="export-stats">
                <span>
                  共 <strong>{data?.totalCompleted ?? 0}</strong> 件
                </span>
                <span>
                  覆盖 <strong>{data?.activeDays ?? 0}</strong> 天
                </span>
                <span>
                  活跃 <strong>{data?.activeMonths ?? 0}</strong> 个月
                </span>
                <span>
                  最长连续 <strong>{data?.longestStreak ?? 0}</strong> 天
                </span>
              </div>

              <pre className="export-preview" aria-label="导出内容预览">
                {preview}
              </pre>
            </>
          )}
        </div>

        <div className="modal__foot">
          <span className="modal__hint">
            已彻底删除的任务不会出现在导出结果中
          </span>
          <div className="topbar__spacer" />
          <button type="button" className="btn btn--sm" onClick={() => void copy()} disabled={!content}>
            {copied ? '已复制 ✓' : '复制全文'}
          </button>
          <button
            type="button"
            className="btn btn--sm btn--primary"
            onClick={download}
            disabled={!content}
          >
            下载 {format === 'md' ? '.md' : '.csv'}
          </button>
        </div>
      </div>
    </div>
  )
}
