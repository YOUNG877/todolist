import { useState, type FormEvent } from 'react'
import { formatNoteStamp } from '@/core/date'
import type { Task } from '@/store/types'

export interface TrackingNotesProps {
  task: Task
  today: string
  onAdd: (id: string, text: string) => void
  onDelete: (id: string, noteId: string) => void
}

/**
 * 追踪备注列表 + 追加输入框。
 *
 * 单独抽成组件是因为输入框需要自己的草稿状态；放进 TaskItem 里会引出
 * 条件调用 hooks 的问题（TaskItem 是按条件渲染不同区域的）。
 *
 * 每条备注都带「写入时的追踪进度」，回看时能看出进展轨迹，
 * 而不是一串没有上下文的文字。
 */
export function TrackingNotes({ task, today, onAdd, onDelete }: TrackingNotesProps): JSX.Element {
  const [draft, setDraft] = useState('')

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    onAdd(task.id, text)
    setDraft('')
  }

  const notes = task.trackingNotes

  return (
    <div className="track-notes">
      {notes.length > 0 && (
        <ul className="track-notes__list">
          {notes.map((note) => (
            <li key={note.id} className="track-notes__item">
              <span className="track-notes__stamp" title={note.createdAt}>
                {formatNoteStamp(note.createdAt, today)}
              </span>
              {note.progress > 0 && (
                <span className="track-notes__pct">{note.progress}%</span>
              )}
              <span className="track-notes__text">{note.text}</span>
              <button
                type="button"
                className="track-notes__del"
                aria-label={`删除追踪备注：${note.text}`}
                title="删除这条备注"
                onClick={() => onDelete(task.id, note.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="track-notes__form" onSubmit={submit}>
        <input
          className="track-notes__input"
          value={draft}
          aria-label={`添加追踪备注：${task.title}`}
          placeholder="记一条追踪进展，回车保存"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn--xs btn--ghost" disabled={!draft.trim()}>
          添加
        </button>
      </form>
    </div>
  )
}
