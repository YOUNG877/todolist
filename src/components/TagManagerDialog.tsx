import { useEffect, useMemo, useState } from 'react'
import { selectAllTags } from '@/core/selectors'
import { actions, useStore } from '@/store/store'

export interface TagManagerDialogProps {
  onClose: () => void
}

/**
 * 标签管理：重命名 / 删除。
 * 两个操作都会作用到所有任务上——标签是全局的，不是某个任务的私有属性。
 */
export function TagManagerDialog({ onClose }: TagManagerDialogProps): JSX.Element {
  const tasks = useStore((s) => s.tasks)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** tag → 使用它的未删除任务数 */
  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasks) {
      if (t.deletedAt) continue
      for (const tag of t.tags) map.set(tag, (map.get(tag) ?? 0) + 1)
    }
    return map
  }, [tasks])

  const tags = selectAllTags(tasks)

  const startRename = (tag: string): void => {
    setEditing(tag)
    setDraft(tag)
  }

  const commitRename = (): void => {
    if (editing === null) return
    const next = draft.trim().replace(/^#/, '')
    if (!next) {
      setEditing(null)
      return
    }
    actions.renameTag(editing, next)
    setEditing(null)
  }

  const remove = (tag: string): void => {
    if (window.confirm(`删除标签「${tag}」？它会从所有任务上移除，任务本身不会被删除。`)) {
      actions.deleteTag(tag)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="管理标签"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <h2 className="modal__title">管理标签</h2>
            <p className="modal__sub">重命名或删除标签，改动会应用到所有任务</p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="modal__body">
          {tags.length === 0 ? (
            <p className="empty empty--sm">
              还没有任何标签。打开一个任务的编辑弹窗，在「标签」里输入即可创建。
            </p>
          ) : (
            <ul className="tag-list">
              {tags.map((tag) => (
                <li key={tag} className="tag-list__row">
                  {editing === tag ? (
                    <>
                      <input
                        className="input input--sm"
                        autoFocus
                        aria-label={`重命名标签 ${tag}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename()
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                      <button type="button" className="btn btn--xs btn--primary" onClick={commitRename}>
                        确定
                      </button>
                      <button type="button" className="btn btn--xs btn--ghost" onClick={() => setEditing(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="chip chip--tag">#{tag}</span>
                      <span className="panel__count">{usage.get(tag) ?? 0} 个任务</span>
                      <div className="topbar__spacer" />
                      <button
                        type="button"
                        className="btn btn--xs btn--ghost"
                        onClick={() => startRename(tag)}
                      >
                        重命名
                      </button>
                      <button
                        type="button"
                        className="btn btn--xs btn--danger"
                        onClick={() => remove(tag)}
                      >
                        删除
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal__foot">
          <span className="modal__hint">删除标签不会删除任务</span>
          <div className="topbar__spacer" />
          <button type="button" className="btn btn--sm btn--primary" onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
