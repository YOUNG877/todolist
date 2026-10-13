import { useEffect, useMemo, useRef, useState } from 'react'
import { selectAllTags } from '@/core/selectors'
import { actions, useStore } from '@/store/store'
import { PRIORITY_LABEL, type Priority, type Task } from '@/store/types'

export interface TaskEditorModalProps {
  taskId: string
  onClose: () => void
  onManageTags: () => void
}

const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high']
const ESTIMATE_PRESETS = [15, 30, 45, 60, 120]

/**
 * 任务编辑弹窗（FR-09）。
 * 这是优先级与标签的唯一入口——之前数据模型里一直有这两个字段，
 * 但界面上没有任何地方能设置。
 */
export function TaskEditorModal({
  taskId,
  onClose,
  onManageTags,
}: TaskEditorModalProps): JSX.Element | null {
  const task = useStore((s) => s.tasks.find((t) => t.id === taskId) ?? null)
  const allTasks = useStore((s) => s.tasks)

  const [title, setTitle] = useState(task?.title ?? '')
  const [note, setNote] = useState(task?.note ?? '')
  const [priority, setPriority] = useState<Priority>(task?.priority ?? 'none')
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '')
  const [estimate, setEstimate] = useState<string>(
    task?.estimateMinutes != null ? String(task.estimateMinutes) : '',
  )
  const [pinned, setPinned] = useState(task?.pinned ?? false)
  const [tagDraft, setTagDraft] = useState('')
  const [error, setError] = useState('')

  const titleRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    const used = new Set(tags)
    return selectAllTags(allTasks).filter((t) => !used.has(t))
  }, [allTasks, tags])

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
  }, [])

  /* 任务被外部删除时直接关闭，避免编辑一个已经不存在的任务 */
  useEffect(() => {
    if (!task) onClose()
  }, [task, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, note, priority, tags, dueDate, estimate, pinned])

  if (!task) return null

  const addTag = (raw: string): void => {
    const value = raw.trim().replace(/^#/, '')
    if (!value) return
    if (tags.length >= 5) {
      setError('一个任务最多 5 个标签')
      return
    }
    if (tags.includes(value)) {
      setTagDraft('')
      return
    }
    setTags([...tags, value])
    setTagDraft('')
    setError('')
  }

  const save = (): void => {
    const trimmed = title.trim()
    if (!trimmed) {
      setError('标题不能为空')
      titleRef.current?.focus()
      return
    }
    const minutes = estimate.trim() === '' ? null : Number(estimate)
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 5)) {
      setError('预计耗时至少 5 分钟')
      return
    }
    const patch: Partial<Task> = {
      title: trimmed,
      note: note.trim() || undefined,
      priority,
      tags,
      dueDate: dueDate || null,
      estimateMinutes: minutes === null ? null : Math.round(minutes),
      pinned,
    }
    actions.updateTask(taskId, patch)
    onClose()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="编辑任务"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">编辑任务</h2>
            <p className="modal__sub">优先级、标签、备注等都在这里设置</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          <label className="field field--stack">
            <span className="field__label">标题</span>
            <input
              ref={titleRef}
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>

          <label className="field field--stack">
            <span className="field__label">备注</span>
            <textarea
              className="input"
              rows={3}
              placeholder="补充说明（可留空）"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <div className="field-row">
            <label className="field field--stack">
              <span className="field__label">优先级</span>
              <select
                className="select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as Priority)}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--stack">
              <span className="field__label">截止日期</span>
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>

            <label className="field field--stack">
              <span className="field__label">预计耗时（分钟）</span>
              <input
                type="number"
                min={5}
                step={5}
                className="input"
                list="estimate-presets"
                value={estimate}
                onChange={(e) => setEstimate(e.target.value)}
              />
              <datalist id="estimate-presets">
                {ESTIMATE_PRESETS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>

          <div className="field field--stack">
            <span className="field__label">标签（最多 5 个）</span>
            <div className="tag-editor">
              {tags.map((tag) => (
                <span key={tag} className="chip chip--tag">
                  #{tag}
                  <button
                    type="button"
                    className="chip__remove"
                    aria-label={`移除标签 ${tag}`}
                    onClick={() => setTags(tags.filter((t) => t !== tag))}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                className="tag-editor__input"
                aria-label="添加标签"
                placeholder="输入后回车"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag(tagDraft)
                  }
                }}
              />
            </div>
            {suggestions.length > 0 && (
              <div className="tag-suggest">
                <span className="field__hint">已有标签：</span>
                {suggestions.slice(0, 12).map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="chip chip--muted tag-suggest__item"
                    onClick={() => addTag(tag)}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="export-toggles">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
              标记为「必做」（配合「仅必做任务顺延」策略）
            </label>
          </div>

          {error && <p className="form-error">{error}</p>}

          <p className="field__hint">
            创建于 {task.createdAt.slice(0, 10)}
            {task.carryOverCount > 0 && `　·　已顺延 ${task.carryOverCount} 天`}
            {task.completedDate && `　·　完成于 ${task.completedDate}`}
          </p>
        </div>

        <div className="modal__foot">
          <button type="button" className="btn btn--sm" onClick={onManageTags}>
            管理标签…
          </button>
          <div className="topbar__spacer" />
          <button type="button" className="btn btn--sm" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn--sm btn--primary" onClick={save}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
