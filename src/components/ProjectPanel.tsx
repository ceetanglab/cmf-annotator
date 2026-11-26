import { useCallback, useEffect, useRef, useState } from 'react'
import { infoName, nameProjectFromFile, useStore } from '../store'
import { deleteDoc, listDocs, onDocsChanged, type DocMeta } from '../lib/docs'
import { docUrl, newDocId } from '../lib/docId'
import { readJSONFile } from '../lib/io'
import { resetHistory } from '../history'
import type { CMFProject } from '../types'
import Section from './ui/Section'
import Icon from './ui/Icon'

// 工程体积只有量级意义（图片 dataURL 的长度和），不用精确到字节
function sizeText(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return ''
}

// 列表里的时间：一周内说「几分钟前」，再久就写日期 —— 用户判断「哪份是刚才那个」靠的是这个
function timeText(t: number): string {
  const now = Date.now()
  const diff = now - t
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 6 * 3600_000) return `${Math.floor(diff / 3600_000)} 小时前`
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return d.getFullYear() === new Date().getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md}`
}

/** 工程名：优先项目信息栏里的「项目」栏，其次导出文件名，最后退回磁盘文件名 */
function nameOf(p: CMFProject | null, file: string): string {
  if (p?.info?.fields?.length) {
    const n = infoName(p.info)
    if (n && n !== '未命名项目') return n
  }
  const base = file.replace(/\.json$/i, '')
  return (p?.exportName || p?.name || base || '未命名项目').slice(0, 60)
}

/**
 * 左栏「项目」：一个窗口 = 一份工程 = 一个本地槽位（?doc=xxx）。
 *
 * 三个入口对应三种意图：
 * - 增加项目：直接开一份**空白**工程在新窗口（当前窗口一动不动）
 * - 打开工程：列表里点条目，新窗口打开（同一份工程也能被另一个窗口打开看，但别同时改）
 * - 导入项目：选一份 JSON 覆盖当前窗口（会确认，因为不可撤销）
 */
export default function ProjectPanel({
  docId,
  onFlush
}: {
  /** 当前窗口的工程槽位 */
  docId: string
  /** 切换工程前先把内存里的内容写进库，否则最后几秒的改动会丢 */
  onFlush: () => Promise<void>
}) {
  const loadProject = useStore((s) => s.loadProject)
  const updateInfoField = useStore((s) => s.updateInfoField)
  const info = useStore((s) => s.info)
  const images = useStore((s) => s.images)

  const [docs, setDocs] = useState<DocMeta[]>([])
  const [err, setErr] = useState('')
  // 工程名就地改名：双击名字，或点悬停出来的「改名」
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 名字取自信息栏的「项目」栏；没有这一栏就退回首行（infoName 也是这个规则）
  const nameField = info.fields.find((f) => f.label === '项目') ?? info.fields[0]
  const importFile = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => {
    void listDocs().then(setDocs)
  }, [])

  useEffect(() => {
    reload()
    return onDocsChanged(reload)
  }, [reload])

  const startRename = () => {
    const cur = infoName(info)
    setDraft(cur === '未命名项目' ? '' : cur)
    setEditing(true)
  }

  const commitRename = () => {
    setEditing(false)
    if (!nameField) return
    const v = draft.trim()
    if (v === nameField.value) return
    updateInfoField(nameField.id, { value: v })
    // 改完立刻落库，不等自动保存那一拍
    void onFlush()
  }

  const openNew = (id: string) => {
    setErr('')
    const w = window.open(docUrl(id), '_blank')
    if (!w) setErr('浏览器拦下了新窗口：请允许本站弹出窗口后重试')
  }

  const openHere = async (id: string) => {
    if (id === docId) return
    setErr('')
    await onFlush()
    // 整页重开而不是往 store 里塞：视图、历史栈、选中态全都跟着新工程从零开始，不会有残留
    window.location.href = docUrl(id)
  }

  const addBlank = () => {
    // 新窗口必须同步开 —— 放到 await / setTimeout 之后会被弹窗拦截。
    // 全新槽位不带任何内容；App 会在那儿起一个默认名（未命名项目-01 / -02…），
    // 用户拖进第一张图后才落库，不会在「最近项目」里留空记录
    openNew(newDocId())
  }

  const onImportPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setErr('')
    try {
      const raw = await readJSONFile<CMFProject & { kind?: string }>(f)
      if (raw?.kind === 'cmf-template') {
        setErr('这是模板文件：模板请在右栏「全局 → 模板」里导入')
        return
      }
      const p = nameProjectFromFile(raw as CMFProject, f.name)
      const ok = confirm(
        `导入「${nameOf(p, f.name)}」到当前窗口？\n\n` +
          `当前窗口的「${infoName(info)}」会被替换，替换后不能撤销。\n` +
          '想留底请先「导出设置 → 导出项目文件」；已经导出过的文件不受影响。'
      )
      if (!ok) return
      loadProject(p)
      resetHistory()
      reload()
    } catch {
      setErr('JSON 解析失败，请检查文件是否完整')
    }
  }

  const removeDoc = async (d: DocMeta) => {
    if (d.id === docId) return
    const ok = confirm(
      `从本地删除工程「${d.name}」？\n\n只删浏览器里的这份存档，导出过的 JSON 文件不受影响。`
    )
    if (!ok) return
    await deleteDoc(d.id)
    reload()
  }

  return (
    <Section
      title="项目"
      desc="一个窗口一份工程，改动自动保存；多开几个窗口就能同时开工"
      right={<span className="count">{docs.length}</span>}
    >
      <div className="proj-cur" title={`本窗口槽位：${docId || '初始化中'}　双击工程名可改名`}>
        <span className="proj-cur-txt">
          {editing ? (
            <input
              className="proj-rename"
              autoFocus
              value={draft}
              placeholder="工程名"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
            />
          ) : (
            <strong onDoubleClick={startRename}>{infoName(info)}</strong>
          )}
          <em>
            {images.length ? `${images.length} 张渲染图 · ` : ''}双击可改名
          </em>
        </span>
        <span className="proj-tag">当前</span>
      </div>

      <div className="proj-acts">
        <button
          type="button"
          className="btn ghost"
          onClick={addBlank}
          title="新建一份空白工程，在新窗口打开（当前窗口不动）"
        >
          增加项目
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => importFile.current?.click()}
          title="选一个工程 JSON，覆盖当前窗口里的工程（会先确认）"
        >
          导入项目
        </button>
      </div>

      <div className="proj-list-head">
        <span>最近工程</span>
        {docs.length ? (
          <span className="hint" title="工程只存在这台电脑的浏览器里，换电脑请先「导出项目文件」">
            点条目在新窗口打开
          </span>
        ) : null}
      </div>

      {docs.length === 0 ? (
        <div className="proj-empty">
          <span>点「增加项目」开一份空白工程，也可以直接在这儿开工</span>
        </div>
      ) : (
        <ul className="proj-list">
          {docs.map((d) => {
            const cur = d.id === docId
            const size = sizeText(d.size)
            return (
              <li
                key={d.id}
                className={`proj-row${cur ? ' is-on' : ''}`}
                onClick={cur ? undefined : () => openNew(d.id)}
                title={
                  cur
                    ? `就是当前窗口这份\n${timeText(d.updatedAt)}`
                    : `${d.name}\n${timeText(d.updatedAt)} · ${d.images} 张图${size ? ' · ' + size : ''}\n点击在新窗口打开`
                }
              >
                <span className="proj-txt">
                  <strong>{d.name}</strong>
                  <em>
                    {timeText(d.updatedAt)} · {d.images} 图{size ? ` · ${size}` : ''}
                  </em>
                </span>
                {cur ? (
                  <span className="proj-tag">当前</span>
                ) : (
                  <>
                    <span
                      className="proj-act"
                      title="在本窗口打开（当前这份会先保存）"
                      onClick={(e) => {
                        e.stopPropagation()
                        void openHere(d.id)
                      }}
                    >
                      本窗口
                    </span>
                    <span
                      className="proj-del"
                      title="从本地删除这份存档"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeDoc(d)
                      }}
                    >
                      <Icon name="trash" size={11} />
                    </span>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {err ? <div className="proj-err">{err}</div> : null}

      <input
        ref={importFile}
        type="file"
        accept="application/json,.json"
        className="hidden-input"
        onChange={onImportPicked}
      />
    </Section>
  )
}
