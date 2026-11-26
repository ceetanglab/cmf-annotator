import { useRef, useState } from 'react'
import { useStore } from '../store'
import { downloadAnyJSON, readJSONFile } from '../lib/io'
import { templateSummary } from '../lib/templates'
import Section from './ui/Section'
import Icon from './ui/Icon'

// 模板：把调好的一套「全局 + 标注」设置存下来，下次（或同事的机器上）一键套用
export default function TemplatePanel() {
  const templates = useStore((s) => s.templates)
  const saveTemplate = useStore((s) => s.saveTemplate)
  const applyTemplate = useStore((s) => s.applyTemplate)
  const deleteTemplate = useStore((s) => s.deleteTemplate)
  const renameTemplate = useStore((s) => s.renameTemplate)
  const importTemplate = useStore((s) => s.importTemplate)

  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const startSave = () => {
    setName(`模板 ${templates.length + 1}`)
    setSaving(true)
    // 等输入框挂载后再聚焦并全选，改名可以直接覆盖
    setTimeout(() => {
      nameRef.current?.focus()
      nameRef.current?.select()
    }, 0)
  }

  const commitSave = () => {
    saveTemplate(name)
    setSaving(false)
    setName('')
  }

  const startRename = (id: string, cur: string) => {
    setEditing(id)
    setEditText(cur)
  }

  const commitRename = () => {
    if (editing) renameTemplate(editing, editText)
    setEditing(null)
    setEditText('')
  }

  const exportTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id)
    if (t) downloadAnyJSON(t, `${t.name}.template.json`)
  }

  const pickFile = () => fileRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const raw = await readJSONFile<unknown>(f)
      const t = importTemplate(raw)
      if (!t) alert('这不是模板文件。要打开整个工程，请用顶部工具栏的「导入项目」。')
    } catch {
      alert('JSON 解析失败，请检查文件格式')
    }
  }

  return (
    <Section
      title="模板"
      desc="把引线样式、标注栏目、信息栏结构、水印、导出设置存成一套，换项目时一键套用"
      defaultOpen={false}
      right={
        <button className="mini-btn" onClick={startSave} title="把当前设置存为模板">
          <Icon name="plus" size={12} />
          存为模板
        </button>
      }
    >
      {saving && (
        <div className="tpl-save">
          <input
            ref={nameRef}
            type="text"
            className="tpl-name-input"
            value={name}
            placeholder="模板名，如：A4 评审稿"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitSave()
              if (e.key === 'Escape') {
                setSaving(false)
                setName('')
              }
            }}
          />
          <button className="btn primary" style={{ flex: 'none' }} onClick={commitSave}>
            保存
          </button>
          <button
            className="btn"
            style={{ flex: 'none' }}
            onClick={() => {
              setSaving(false)
              setName('')
            }}
          >
            取消
          </button>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="empty">
          还没有模板。
          <br />
          <span className="hint">调好引线粗细 / 栏目 / 水印后点右上角「存为模板」</span>
        </p>
      ) : (
        <ul className="tpl-list">
          {templates.map((t) => (
            <li key={t.id} className="tpl-item">
              <div className="tpl-head">
                {editing === t.id ? (
                  <input
                    type="text"
                    className="tpl-name-input"
                    value={editText}
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <strong className="tpl-title" title={t.name}>
                    {t.name}
                  </strong>
                )}
                <button
                  className="tpl-apply"
                  title="套用这套设置（已有标注的引线会一起更新）"
                  onClick={() => applyTemplate(t)}
                >
                  应用
                </button>
              </div>
              <div className="tpl-foot">
                <em className="tpl-sum">{templateSummary(t)}</em>
                <span className="tpl-acts">
                  <button className="tpl-act" title="重命名" onClick={() => startRename(t.id, t.name)}>
                    改名
                  </button>
                  <button className="tpl-act" title="导出为 .json，可发给同事" onClick={() => exportTemplate(t.id)}>
                    导出
                  </button>
                  <button
                    className="tpl-act icon-del"
                    title="删除模板"
                    onClick={() => {
                      if (confirm(`删除模板「${t.name}」？`)) deleteTemplate(t.id)
                    }}
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button className="btn ghost-block" style={{ marginTop: templates.length ? 8 : 0 }} onClick={pickFile}>
        导入模板文件（.json）
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden-input"
        onChange={onFile}
      />
    </Section>
  )
}
