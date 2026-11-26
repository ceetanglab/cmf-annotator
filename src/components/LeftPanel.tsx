import { useRef, useState, type MutableRefObject } from 'react'
import { useStore, infoName, layerOrder, type LayerRef } from '../store'
import type { LayerGroup } from '../types'
import type { CanvasControls } from '../canvasControls'
import { presetShortName } from '../lib/presets'
import { SHAPE_LABEL, shapeCaption } from '../lib/shapes'
import { cssColor } from '../lib/pantone'
import Section from './ui/Section'
import Icon from './ui/Icon'
import ExportPanel from './ExportPanel'
import ShortcutsPanel from './ShortcutsPanel'
import AboutPanel from './AboutPanel'
import ProjectPanel from './ProjectPanel'

// 图层列表里的一行：可能是未分组对象，也可能是分组（组内成员缩进排在下面）
type Row =
  | { kind: 'item'; z: number; ref: LayerRef }
  | { kind: 'group'; z: number; group: LayerGroup; items: LayerRef[] }

export default function LeftPanel({
  onPickImage,
  docId,
  onFlush,
  controlsRef
}: {
  onPickImage: () => void
  /** 本窗口的工程槽位（项目区用来标记「当前」并做切换） */
  docId: string
  /** 切换工程前先把内存内容写进库 */
  onFlush: () => Promise<void>
  controlsRef: MutableRefObject<CanvasControls | null>
}) {
  const images = useStore((s) => s.images)
  const annotations = useStore((s) => s.annotations)
  const shapes = useStore((s) => s.shapes)
  const groups = useStore((s) => s.groups)
  const selectedIds = useStore((s) => s.selectedIds)
  const select = useStore((s) => s.select)
  const removeImage = useStore((s) => s.removeImage)
  const removeAnnotation = useStore((s) => s.removeAnnotation)
  const updateAnnotation = useStore((s) => s.updateAnnotation)
  const removeShapes = useStore((s) => s.removeShapes)
  const setShapeVisible = useStore((s) => s.setShapeVisible)
  const setAnnotationVisible = useStore((s) => s.setAnnotationVisible)
  const setImageVisible = useStore((s) => s.setImageVisible)
  const reorderLayers = useStore((s) => s.reorderLayers)
  const groupSelectedLayers = useStore((s) => s.groupSelectedLayers)
  const ungroupLayer = useStore((s) => s.ungroupLayer)
  const renameLayerGroup = useStore((s) => s.renameLayerGroup)
  const setGroupVisible = useStore((s) => s.setGroupVisible)
  const toggleGroupCollapsed = useStore((s) => s.toggleGroupCollapsed)
  const clearCanvas = useStore((s) => s.clearCanvas)
  const info = useStore((s) => s.info)
  // ---- 画板 ----
  const artboards = useStore((s) => s.artboards)
  const selectedBoardIds = useStore((s) => s.selectedBoardIds)
  const selectBoard = useStore((s) => s.selectBoard)
  const addBoardFromContent = useStore((s) => s.addBoardFromContent)
  const removeBoards = useStore((s) => s.removeBoards)
  const renameBoard = useStore((s) => s.renameBoard)
  const fitBoardsToContent = useStore((s) => s.fitBoardsToContent)

  // 拖动排序 / 分组改名用的临时状态
  const [dragId, setDragId] = useState<string | null>(null)
  // 真正的拖动判断读 ref：HTML5 拖动事件可能在同一帧里连发，
  // 只靠 state 会读到上一帧的 null，导致 drop 被当成「没在拖」忽略掉
  const dragIdRef = useRef<string | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; place: 'before' | 'after' } | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  // 画板行改名单独一套状态：和分组共用 editName 会互相干扰
  const [editingBoard, setEditingBoard] = useState<string | null>(null)

  const order = layerOrder({ images, annotations, shapes })
  const refOf = (id: string) => order.find((r) => r.id === id)

  // 分组按「组内最下面那一层的 z」定位，未分组对象各自占位；列表自上而下 = 层级由高到低
  const groupRows = groups
    .map((g) => ({ group: g, items: order.filter((r) => r.groupId === g.id) }))
    .filter((x) => x.items.length > 0)
    .map((x) => ({ ...x, z: Math.min(...x.items.map((i) => i.z)) }))
  const loose = order.filter((r) => !r.groupId || !groupRows.some((g) => g.group.id === r.groupId))

  const rows: Row[] = [
    ...loose.map((r) => ({ kind: 'item' as const, z: r.z, ref: r })),
    ...groupRows.map((g) => ({ kind: 'group' as const, z: g.z, group: g.group, items: g.items }))
  ].sort((a, b) => b.z - a.z)

  const groupOf = (id: string) => groups.find((g) => g.id === refOf(id)?.groupId) ?? null
  const isHidden = (r: LayerRef) => !!r.hidden || !!groupOf(r.id)?.hidden

  const annIndexOf = (id: string) => annotations.findIndex((a) => a.id === id)

  const itemName = (r: LayerRef): { title: string; sub: string } => {
    if (r.kind === 'image') {
      const im = images.find((i) => i.id === r.id)
      if (!im) return { title: '渲染图', sub: '' }
      return { title: im.name || '渲染图', sub: `${Math.round(im.w)} × ${Math.round(im.h)}` }
    }
    if (r.kind === 'shape') {
      const sh = shapes.find((x) => x.id === r.id)
      if (!sh) return { title: '形状', sub: '' }
      return { title: `${SHAPE_LABEL[sh.kind]} · ${shapeCaption(sh)}`, sub: `透明度 ${Math.round((sh.opacity ?? 1) * 100)}%` }
    }
    const a = annotations.find((x) => x.id === r.id)
    if (!a) return { title: '标注', sub: '' }
    const n = String(annIndexOf(a.id) + 1).padStart(2, '0')
    return { title: `${n} · ${a.cmf.name || '未命名部件'}`, sub: a.cmf.material || a.cmf.finish || '未填写材质' }
  }

  // 标注行双击改名：改的是 cmf.name，和右侧「标注设置 → 部件」是同一份数据，
  // 两边谁改都立刻同步（画布上的标注框标题也跟着变）
  const commitAnnName = (id: string) => {
    const a = annotations.find((x) => x.id === id)
    const v = editName.trim()
    setEditing(null)
    if (a && v && v !== a.cmf.name) updateAnnotation(id, { cmf: { ...a.cmf, name: v } })
  }

  const layerText = (r: LayerRef, title: string, sub: string) => {
    const a = r.kind === 'annotation' ? annotations.find((x) => x.id === r.id) : undefined
    if (a && editing === r.id) {
      return (
        <span className="layer-txt">
          <input
            className="layer-rename"
            autoFocus
            placeholder="部件名"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={() => commitAnnName(a.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAnnName(a.id)
              if (e.key === 'Escape') setEditing(null)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </span>
      )
    }
    return (
      <span className="layer-txt">
        <strong>
          {r.kind === 'image' && <span className="layer-kind">图</span>}
          {r.kind === 'shape' && <span className="layer-kind">形</span>}
          {a ? (
            <span
              className="layer-name"
              title="双击改部件名（右侧「标注设置」里也能改）"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setEditing(a.id)
                setEditName(a.cmf.name)
              }}
            >
              {title}
            </span>
          ) : (
            title
          )}
        </strong>
        <em>{sub}</em>
      </span>
    )
  }

  // 拖到某行的上半部 = 插到它上面（层级更高），下半部 = 插到它下面
  const dropPlace = (e: React.DragEvent<HTMLElement>): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientY < r.top + r.height / 2 ? 'after' : 'before'
  }

  const dragProps = (id: string) => ({
    draggable: editing !== id,
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      dragIdRef.current = id
      setDragId(id)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', id)
    },
    onDragEnd: () => {
      dragIdRef.current = null
      setDragId(null)
      setDropAt(null)
    },
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!dragIdRef.current || dragIdRef.current === id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropAt({ id, place: dropPlace(e) })
    },
    onDragLeave: () => setDropAt((v) => (v && v.id === id ? null : v)),
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      const from = dragIdRef.current
      if (!from || from === id) return
      e.preventDefault()
      reorderLayers(from, id, dropPlace(e))
      dragIdRef.current = null
      setDragId(null)
      setDropAt(null)
    }
  })

  const dropClass = (id: string) => {
    if (!dragId || dropAt?.id !== id) return ''
    return dropAt.place === 'after' ? ' drop-above' : ' drop-below'
  }

  const commitRename = (gid: string) => {
    renameLayerGroup(gid, editName)
    setEditing(null)
  }

  return (
    <aside className="left">
      <div className="brand">
        <span className="brand-mark">C</span>
        <div className="brand-txt">
          {/* 整页唯一的一级标题：真实可见，不藏起来。视觉上和原来的 <strong> 一致 */}
          <h1>CMF 标注工具</h1>
          <span>{infoName(info)}</span>
        </div>
      </div>

      {/* 项目管理放在最上面：它决定了「这一整个窗口是谁」，
          素材 / 图层 / 画板都只是这份工程里的内容 */}
      <ProjectPanel docId={docId} onFlush={onFlush} />

      <Section title="素材">
        {images.length === 0 ? (
          <button className="drop" onClick={onPickImage}>
            <Icon name="upload" size={18} />
            <span>上传 / 拖入渲染图</span>
            <em>可多选，按顺序并排拼接</em>
          </button>
        ) : (
          <div className="asset-grid">
            {images.map((im, i) => (
              <button
                key={im.id}
                className={`asset${selectedIds.includes(im.id) ? ' is-on' : ''}${im.hidden ? ' is-off' : ''}`}
                title={`${im.name}${im.hidden ? '（已隐藏）' : ''} · Shift 点击可多选`}
                onClick={(e) => select(im.id, e.shiftKey)}
              >
                <img src={im.dataUrl} alt={im.name} />
                <span className="asset-idx">{i + 1}</span>
                <span
                  className="asset-del"
                  title="删除这张图"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`删除「${im.name}」？该图的标注不会自动删除。`)) removeImage(im.id)
                  }}
                >
                  <Icon name="trash" size={11} />
                </span>
              </button>
            ))}
            <button className="asset asset-add" onClick={onPickImage} title="继续添加（也支持 Ctrl+V 粘贴图片）">
              <Icon name="plus" size={16} />
            </button>
          </div>
        )}
      </Section>

      <Section
        title="图层"
        grow
        flush
        right={<span className="count">{annotations.length + images.length + shapes.length}</span>}
      >
        {order.length === 0 ? (
          <div className="empty pad">
            暂无图层
            <br />
            <span className="hint">导入渲染图，或用「标注」工具双击画布</span>
          </div>
        ) : (
          <>
            <div className="layer-tools">
              <button
                className="btn ghost"
                disabled={selectedIds.filter((id) => refOf(id)).length < 2}
                title="把选中的图层归到一个分组（Ctrl+G）"
                onClick={groupSelectedLayers}
              >
                <Icon name="layers" size={12} />
                分组
              </button>
              <span className="hint">
                {selectedIds.filter((id) => refOf(id)).length > 1
                  ? `已选 ${selectedIds.filter((id) => refOf(id)).length} 个`
                  : '拖动可改层级'}
              </span>
            </div>

            <ul className="layer-list">
              {rows.map((row) => {
                if (row.kind === 'group') {
                  const g = row.group
                  const on = row.items.every((r) => selectedIds.includes(r.id))
                  return (
                    <li key={`g-${g.id}`} className="layer-row-wrap">
                      <div
                        className={`layer-group${on ? ' is-on' : ''}${g.hidden ? ' is-hidden' : ''}${
                          g.collapsed ? '' : ' is-open'
                        }${dragId === g.id ? ' dragging' : ''}${dropClass(g.id)}`}
                        {...dragProps(g.id)}
                        onClick={(e) => {
                          // 点分组 = 选中整组，便于一起对齐 / 一起删
                          const ids = row.items.map((r) => r.id)
                          if (e.shiftKey) ids.forEach((id) => select(id, true))
                          else useStore.setState({ selectedIds: ids })
                        }}
                        title="点选整组；双击改名；拖动可整组改层级"
                      >
                        <span
                          className="layer-caret"
                          title={g.collapsed ? '展开分组' : '折叠分组'}
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleGroupCollapsed(g.id)
                          }}
                        >
                          <Icon name="chevron" size={12} />
                        </span>

                        {editing === g.id ? (
                          <input
                            className="layer-rename"
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={() => commitRename(g.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(g.id)
                              if (e.key === 'Escape') setEditing(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span
                            className="layer-txt"
                            onDoubleClick={(e) => {
                              e.stopPropagation()
                              setEditing(g.id)
                              setEditName(g.name)
                            }}
                          >
                            <strong>
                              {g.name} <em className="layer-count">· {row.items.length}</em>
                            </strong>
                          </span>
                        )}

                        <span
                          className="layer-ungroup"
                          title="解散分组（图层保留在画布上）"
                          onClick={(e) => {
                            e.stopPropagation()
                            ungroupLayer(g.id)
                          }}
                        >
                          解散
                        </span>
                        <span
                          className={`layer-eye${g.hidden ? '' : ' on'}`}
                          title={g.hidden ? '显示整组' : '隐藏整组'}
                          onClick={(e) => {
                            e.stopPropagation()
                            setGroupVisible(g.id, !!g.hidden)
                          }}
                        >
                          <Icon name={g.hidden ? 'eye-off' : 'eye'} size={13} />
                        </span>
                      </div>

                      {!g.collapsed &&
                        [...row.items].reverse().map((r) => {
                          const { title, sub } = itemName(r)
                          const a = r.kind === 'annotation' ? annotations.find((x) => x.id === r.id) : undefined
                          return (
                            <div
                              key={r.id}
                              className={`layer-child${selectedIds.includes(r.id) ? ' is-on' : ''}${
                                isHidden(r) ? ' is-hidden' : ''
                              }${dragId === r.id ? ' dragging' : ''}${dropClass(r.id)}`}
                              {...dragProps(r.id)}
                              onClick={(e) => select(r.id, e.shiftKey)}
                            >
                              <span
                                className={`layer-eye${isHidden(r) ? '' : ' on'}`}
                                title={isHidden(r) ? '显示该图层' : '隐藏该图层'}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (r.kind === 'image') setImageVisible(r.id, !!r.hidden)
                                  else if (r.kind === 'shape') setShapeVisible(r.id, !!r.hidden)
                                  else setAnnotationVisible(r.id, !!r.hidden)
                                }}
                              >
                                <Icon name={isHidden(r) ? 'eye-off' : 'eye'} size={13} />
                              </span>
                              {layerText(r, title, sub)}
                              <span
                                className="layer-del"
                                title={r.kind === 'image' ? '删除这张图' : r.kind === 'shape' ? '删除这个形状' : '删除标注'}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (r.kind === 'image') {
                                    if (confirm(`删除「${title}」？该图的标注不会自动删除。`)) removeImage(r.id)
                                  } else if (r.kind === 'shape') removeShapes([r.id])
                                  else removeAnnotation(r.id)
                                }}
                              >
                                <Icon name="trash" size={11} />
                              </span>
                              {a ? (
                                <span className="dot" style={{ background: cssColor(a.cmf.color) }} title={a.cmf.color} />
                              ) : null}
                            </div>
                          )
                        })}
                    </li>
                  )
                }

                const r = row.ref
                const { title, sub } = itemName(r)
                const a = r.kind === 'annotation' ? annotations.find((x) => x.id === r.id) : undefined
                return (
                  <li
                    key={r.id}
                    className={`layer-item${selectedIds.includes(r.id) ? ' is-on' : ''}${
                      isHidden(r) ? ' is-hidden' : ''
                    }${dragId === r.id ? ' dragging' : ''}${dropClass(r.id)}`}
                    {...dragProps(r.id)}
                    onClick={(e) => select(r.id, e.shiftKey)}
                  >
                    <span
                      className={`layer-eye${isHidden(r) ? '' : ' on'}`}
                      title={isHidden(r) ? '显示该图层' : '隐藏该图层'}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (r.kind === 'image') setImageVisible(r.id, !!r.hidden)
                        else if (r.kind === 'shape') setShapeVisible(r.id, !!r.hidden)
                        else setAnnotationVisible(r.id, !!r.hidden)
                      }}
                    >
                      <Icon name={isHidden(r) ? 'eye-off' : 'eye'} size={13} />
                    </span>
                    {layerText(r, title, sub)}
                    <span
                      className="layer-del"
                      title={r.kind === 'image' ? '删除这张图' : r.kind === 'shape' ? '删除这个形状' : '删除标注'}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (r.kind === 'image') {
                          if (confirm(`删除「${title}」？该图的标注不会自动删除。`)) removeImage(r.id)
                        } else if (r.kind === 'shape') removeShapes([r.id])
                        else removeAnnotation(r.id)
                      }}
                    >
                      <Icon name="trash" size={11} />
                    </span>
                    {a ? <span className="dot" style={{ background: cssColor(a.cmf.color) }} title={a.cmf.color} /> : null}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </Section>

      {/* 画板：每块画板就是一张要交出去的图。放在图层下面 —— 图层管「画什么」，
          画板管「取哪一块交出去」，顺序正好是自上而下的工作流 */}
      <Section
        title="画板"
        desc="每块画板是独立的取景框：各有自己的比例、底色与导出设置"
      >
        <div className="board-tools">
          <button
            className="btn ghost"
            title="按当前内容新建一块画板"
            onClick={() => {
              const b = addBoardFromContent()
              if (b) requestAnimationFrame(() => controlsRef.current?.showBoard(b.id))
            }}
          >
            <Icon name="plus" size={12} />
            新建画板
          </button>
          <button
            className="btn ghost"
            disabled={!images.length}
            title="按当前内容重新贴合选中的画板"
            onClick={fitBoardsToContent}
          >
            贴合内容
          </button>
        </div>

        <ul className="board-list">
          {artboards.map((b, i) => {
            const on = selectedBoardIds.includes(b.id)
            const tag = presetShortName(b.preset)
            return (
              <li
                key={b.id}
                className={`board-row${on ? ' is-on' : ''}`}
                onClick={(e) => selectBoard(b.id, e.shiftKey)}
                onDoubleClick={() => {
                  setEditingBoard(b.id)
                  setEditName(b.name)
                }}
                title="点选画板；Shift 多选可批量改比例与底色；双击改名"
              >
                <span className="board-idx">{String(i + 1).padStart(2, '0')}</span>
                {editingBoard === b.id ? (
                  <input
                    className="layer-rename"
                    autoFocus
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => {
                      renameBoard(b.id, editName)
                      setEditingBoard(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameBoard(b.id, editName)
                        setEditingBoard(null)
                      }
                      if (e.key === 'Escape') setEditingBoard(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="board-txt">
                    <strong>{b.name}</strong>
                    <em>
                      {tag} · {Math.round(b.w)}×{Math.round(b.h)}
                      {b.bg ? '' : ' · 透明'}
                    </em>
                  </span>
                )}
                <span
                  className="board-go"
                  title="把视图对到这块画板"
                  onClick={(e) => {
                    e.stopPropagation()
                    controlsRef.current?.showBoard(b.id)
                  }}
                >
                  <Icon name="frame" size={12} />
                </span>
                <span
                  className="board-del"
                  title={artboards.length <= 1 ? '至少保留一块画板' : '删除这块画板（画面内容不受影响）'}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (artboards.length <= 1) return
                    removeBoards([b.id])
                  }}
                >
                  <Icon name="trash" size={11} />
                </span>
              </li>
            )
          })}
        </ul>
      </Section>

      {/* 一键清空放在「导出设置」上方：内容管理（素材/图层）的收尾动作，
          只清画面，不动项目信息栏 / 引线样式 / 水印 / 模板 */}
      <div className="clear-row">
        <button
          type="button"
          className="btn clear-btn"
          disabled={images.length === 0 && annotations.length === 0}
          title="移除全部渲染图与标注（可 Ctrl+Z 撤销；项目信息栏、引线样式、水印、模板会保留）"
          onClick={() => {
            const ok = confirm(
              `清空画面？\n\n将移除 ${images.length} 张渲染图、${annotations.length} 条标注和 ${shapes.length} 个形状。\n` +
                '项目信息栏、引线样式、水印、模板会保留，可用 Ctrl+Z 撤销。'
            )
            if (ok) clearCanvas()
          }}
        >
          <Icon name="trash" size={13} />
          清空画面
        </button>
      </div>

      {/* 左栏只留「素材 / 图层」这类内容管理 + 导出入口；
          项目信息栏与模板属于全局设置，已移到右侧「全局」页 */}
      <ExportPanel controlsRef={controlsRef} />
      <ShortcutsPanel />
      {/* 关于 = 左栏最后一张折叠卡：版本 / 说明 / 版权 / 协议 / 反馈全收在这里 */}
      <AboutPanel />
    </aside>
  )
}
