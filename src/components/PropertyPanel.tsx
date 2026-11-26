import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import ShapePanel from './ShapePanel'
import Section from './ui/Section'
import Icon from './ui/Icon'
import LabelCombo from './ui/LabelCombo'
import { LINE_W, ANCHOR_R, LINE_COLORS, LINE_COLOR } from '../layout'
import { cmfRows } from '../lib/cmfRows'
import { FINISH_PRESETS, MATERIAL_PRESETS } from '../lib/cmfPresets'
import { cssColor, deltaE, normalizeHex, pantoneLabel, parsePantone, toColorCode } from '../lib/pantone'
import PresetChips from './ui/PresetChips'
import type { CMFMeta, CMFRow } from '../types'

// 自动增高的多行输入：既支持自动折行，也支持回车手动换行
function AutoTextarea({
  value,
  placeholder,
  onChange,
  muted
}: {
  value: string
  placeholder?: string
  onChange: (v: string) => void
  muted?: boolean // 只显示占位符 `/` 时用浅灰字，和真实内容区分
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  const fit = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    // box-sizing 为 border-box 时 height 含边框，需把上下边框补回去，否则末行会被裁 2px
    const cs = getComputedStyle(el)
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)
    el.style.height = `${Math.min(180, el.scrollHeight + border)}px`
  }, [])

  // 内容变化后重算高度
  useLayoutEffect(fit, [value, fit])

  // 容器宽度变化（如右侧面板出现滚动条）会让折行改变，需重算，否则文字会被截断
  useLayoutEffect(() => {
    const el = ref.current
    const box = el?.parentElement
    if (!el || !box) return
    let lastW = box.clientWidth
    const ro = new ResizeObserver(() => {
      if (box.clientWidth === lastW) return
      lastW = box.clientWidth
      fit()
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [fit])

  return (
    <textarea
      ref={ref}
      rows={1}
      className={muted ? 'is-muted' : undefined}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// 颜色栏下方只留一个 ΔE：色号已经显示在输入框里，这里只说明色块与它的差距。
// 只有「手选过颜色」才有差值可言；直接写色号时色块就是该色号的近似色，这一行不出现。
function ColorDelta({ cmf }: { cmf: CMFMeta }) {
  const raw = (cmf.color ?? '').trim()
  const p = raw ? parsePantone(raw) : null
  if (!p || !cmf.colorPicked) return null
  const d = deltaE(cmf.colorPicked, p.hex)
  return (
    <div
      className="pt-hint"
      title="色块颜色与这个 Pantone 色号的色差：小于 2 基本看不出差别，2~5 很接近"
    >
      <span>
        ΔE <b>{(d ?? 0).toFixed(1)}</b>
      </span>
    </div>
  )
}

// 各内置栏目的输入提示
const ROW_PH: Record<string, string> = {
  color: 'Pantone 色号，如 186 C / Cool Gray 11 C',
  material: '如：ABS+PC、铝合金',
  finish: '如：喷漆、哑光单涂层',
  process: '如：注塑→喷涂→丝印',
  note: '特殊要求 / 备注'
}

// color 类型的 input 只认 #rrggbb，填了潘通号之类时要给个合法兜底，否则浏览器报警
const hexOf = (v: string) => (/^#[0-9a-fA-F]{6}$/.test(v.trim()) ? v.trim() : '#cccccc')

// 空值时文本框里显示一个「可删除的」占位斜杠 `/`（不是只能看的灰色 placeholder）
const shownValue = (r: CMFRow) => (r.value === '' && r.slash !== false ? '/' : r.value)

// 材质 / 工艺给一排快捷标签：只有这两栏有清单，其它栏目不显示
const PRESET_OF: Record<string, { label: string; items: readonly string[] }> = {
  material: { label: '材质', items: MATERIAL_PRESETS },
  finish: { label: '工艺', items: FINISH_PRESETS }
}

export default function PropertyPanel() {
  const selectedIds = useStore((s) => s.selectedIds)
  const annotations = useStore((s) => s.annotations)
  const shapes = useStore((s) => s.shapes)
  const updateAnnotation = useStore((s) => s.updateAnnotation)
  const removeAnnotation = useStore((s) => s.removeAnnotation)
  const patchAnnRow = useStore((s) => s.patchAnnRow)
  const moveAnnRow = useStore((s) => s.moveAnnRow)
  const addAnnRow = useStore((s) => s.addAnnRow)
  const removeAnnRow = useStore((s) => s.removeAnnRow)
  const resetAnnRows = useStore((s) => s.resetAnnRows)
  const setAnnName = useStore((s) => s.setAnnName)
  const setAnnLineColor = useStore((s) => s.setAnnLineColor)

  const [openKey, setOpenKey] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 点面板外任意处收起下拉
  useEffect(() => {
    if (!openKey) return
    const onDown = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setOpenKey(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openKey])

  const selAnns = annotations.filter((x) => selectedIds.includes(x.id))
  const a = selAnns.length === 1 ? selAnns[0] : undefined

  // 颜色框的「正在输入」草稿：显示时统一写成 Pantone 186 C，输入过程中保留用户打的原样，
  // 否则每敲一个字都会被前缀重写一遍，光标乱跳
  const [colorDraft, setColorDraft] = useState<string | null>(null)
  useEffect(() => setColorDraft(null), [a?.id])

  // 形状和标注共用这一页：选中形状就整页交给形状表单，不另开页签。
  // 混合选中（标注 + 形状）时以形状为准——两种表单字段完全不同，混着显示只会互相干扰
  const hasShape = shapes.some((sh) => selectedIds.includes(sh.id))

  if (hasShape) return <ShapePanel />

  if (!a) {
    return (
      <Section
        title="标注信息栏"
        desc={
          selectedIds.length > 1
            ? `已选中 ${selectedIds.length} 个对象，可用上方「对齐」；单个标注才能编辑属性。`
            : '在画布中点选一个标注（文本块或锚点）或形状后，可在此编辑属性。'
        }
      >
        <div className="placeholder">尚未选中对象</div>
      </Section>
    )
  }

  const setCmf = (patch: Partial<typeof a.cmf>) =>
    updateAnnotation(a.id, { cmf: { ...a.cmf, ...patch } })

  const rows = cmfRows(a.cmf)

  // 颜色栏以「潘通色号」为主：手输的色值（#C8102E / #ccc）在确认后换成最近色号；
  // 已经是色号的只把写法规范化（186c → 186 C），并把色块换成该色号的近似屏色；
  // 认不出的原样留着，不猜。
  const commitColor = (raw: string) => {
    setColorDraft(null)
    const t = raw.trim()
    if (!t || t === '/') return
    const p = parsePantone(t)
    if (p) {
      // 改色号 = 要看这个色号本来的颜色：清掉手选色，色块立刻变成它的近似屏色
      if (p.code !== a.cmf.color || a.cmf.colorPicked !== undefined)
        updateAnnotation(a.id, { cmf: { ...a.cmf, color: p.code, colorPicked: undefined } })
      return
    }
    if (!normalizeHex(t)) return
    const c = toColorCode(t)
    updateAnnotation(a.id, { cmf: { ...a.cmf, color: c.color, colorPicked: c.picked } })
  }

  // 文本框与画布上的占位斜杠 `/`：删掉它就是真空白；直接在 / 后面打字则把占位符替换掉
  const onRowText = (r: CMFRow, raw: string) => {
    let v = raw
    if (r.value === '' && r.slash !== false && v.length > 1 && v.startsWith('/')) v = v.slice(1)
    if (v === '') {
      // 原本就在显示占位符 → 说明用户把 `/` 删掉了，标记为空白；否则是清空了已填内容，回到占位符
      patchAnnRow(a.id, r.key, { value: '', slash: r.value !== '' })
    } else if (v.trim() === '/') {
      patchAnnRow(a.id, r.key, { value: '', slash: true })
    } else {
      patchAnnRow(a.id, r.key, { value: v, slash: true })
    }
  }

  return (
    <Section title="标注信息栏" desc={a.cmf.name || '未命名部件'}>
      {/* 与「项目信息栏」同一套版式：一行一个栏目，可拖动排序 / 改名 / 隐藏 / 删除 */}
      <div className="cmf-list" ref={listRef}>
        {/* 名称就是标注框的标题，固定在首行：可隐藏 / 删除，删掉后可用下拉里的「名称」恢复 */}
        {a.cmf.noName ? (
          <button
            type="button"
            className="cmf-restore"
            title="把「名称」栏重新加回标注框（置顶）"
            onClick={() => setCmf({ noName: false, nameHidden: false })}
          >
            <Icon name="plus" size={12} />
            恢复「名称」栏
          </button>
        ) : (
          <div className={`cmf-row is-fixed${a.cmf.nameHidden ? ' is-off' : ''}`}>
            <div className="cmf-head">
              <span className="cmf-key">名称</span>
              <span className="cmf-tag">标注框标题</span>
              <span className="cmf-spacer" />
              <button
                type="button"
                className={`eye-btn${a.cmf.nameHidden ? '' : ' on'}`}
                title={a.cmf.nameHidden ? '在标注框里显示标题' : '在标注框里隐藏标题'}
                onClick={() => setCmf({ nameHidden: !a.cmf.nameHidden })}
              >
                <Icon name={a.cmf.nameHidden ? 'eye-off' : 'eye'} size={13} />
              </button>
              <button
                type="button"
                className="icon-del"
                title="删除「名称」栏"
                onClick={() => setCmf({ noName: true, nameHidden: false })}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
            <div className="cmf-body">
              <AutoTextarea
                value={a.cmf.name}
                onChange={(v) => setCmf({ name: v })}
                placeholder="如：按键分色区域"
              />
            </div>
          </div>
        )}

        {rows.map((r, i) => {
          const open = openKey === r.key
          const hidden = !!r.hidden
          const isPh = r.value === '' && r.slash !== false // 当前显示的是占位符 `/`
          return (
            <div
              key={r.key}
              className={`cmf-row${dragFrom === i ? ' dragging' : ''}${
                dropAt === i && dragFrom !== null && dragFrom !== i ? ' drop-target' : ''
              }${hidden ? ' is-off' : ''}`}
              onDragOver={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDropAt(i)
              }}
              onDragLeave={() => setDropAt((v) => (v === i ? null : v))}
              onDrop={(e) => {
                if (dragFrom === null) return
                e.preventDefault()
                moveAnnRow(a.id, dragFrom, i)
                setDragFrom(null)
                setDropAt(null)
              }}
            >
              <div className="cmf-head">
                <span
                  className="grip"
                  draggable
                  title="拖动调整顺序"
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = 'move'
                    // 部分浏览器需要写入数据才会触发 drop
                    e.dataTransfer.setData('text/plain', String(i))
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDropAt(null)
                  }}
                >
                  <Icon name="grip" size={13} />
                </span>

                <LabelCombo
                  scope="cmf"
                  value={r.label}
                  onChange={(v) => patchAnnRow(a.id, r.key, { label: v })}
                  onPickName={() => setAnnName(a.id, r.key)}
                  open={open}
                  setOpen={(v) => setOpenKey(v ? r.key : null)}
                />

                <span className="cmf-spacer" />

                <button
                  type="button"
                  className={`eye-btn${hidden ? '' : ' on'}`}
                  title={hidden ? '在标注框里显示该栏目' : '在标注框里隐藏该栏目'}
                  onClick={() => patchAnnRow(a.id, r.key, { hidden: !hidden })}
                >
                  <Icon name={hidden ? 'eye-off' : 'eye'} size={13} />
                </button>
                <button
                  type="button"
                  className="icon-del"
                  title="删除该栏目"
                  onClick={() => removeAnnRow(a.id, r.key)}
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>

              <div className="cmf-body">
                {r.key === 'color' ? (
                  <>
                    <div className="row swatch-row">
                      <input
                        className="swatch"
                        type="color"
                        // 色块画「手选过的那个色」；没手选过就用色号自己的近似色
                        value={hexOf(cssColor(a.cmf.colorPicked || a.cmf.color))}
                        title="点这里取色：会自动换算成最接近的潘通色号"
                        onChange={(e) => {
                          const hex = normalizeHex(e.target.value) ?? e.target.value
                          const c = toColorCode(hex)
                          updateAnnotation(a.id, { cmf: { ...a.cmf, color: c.color, colorPicked: hex } })
                        }}
                      />
                      <input
                        type="text"
                        className={isPh ? 'is-muted' : undefined}
                        // 平时显示成「Pantone 186 C」；正在输入时用草稿，光标不跳
                        value={colorDraft ?? pantoneLabel(r.value)}
                        placeholder={ROW_PH.color}
                        onFocus={() => setColorDraft(pantoneLabel(r.value))}
                        onChange={(e) => {
                          const v = e.target.value
                          setColorDraft(v)
                          // 边打边转：一旦拼成合法色号，色块立刻换成这个色号的近似色，
                          // 旧的手选色（colorPicked）作废，下面的 ΔE 也跟着消失
                          const p = parsePantone(v)
                          updateAnnotation(a.id, {
                            cmf: {
                              ...a.cmf,
                              color: p ? p.code : v,
                              colorPicked: p ? undefined : a.cmf.colorPicked
                            }
                          })
                        }}
                        // 回车 / 失焦：归一成规范色号（473c → 473 C），并把框里写成 Pantone 前缀的写法
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          commitColor((e.target as HTMLInputElement).value)
                          ;(e.target as HTMLInputElement).blur()
                        }}
                        onBlur={(e) => commitColor(e.target.value)}
                      />
                    </div>
                    <ColorDelta cmf={a.cmf} />
                  </>
                ) : (
                  <>
                    <AutoTextarea
                      value={shownValue(r)}
                      muted={isPh}
                      placeholder={ROW_PH[r.key] ?? '填写内容'}
                      onChange={(v) => onRowText(r, v)}
                    />
                    {PRESET_OF[r.key] ? (
                      <PresetChips
                        value={r.value}
                        presets={PRESET_OF[r.key].items}
                        label={PRESET_OF[r.key].label}
                        onChange={(v) => patchAnnRow(a.id, r.key, { value: v, slash: true })}
                      />
                    ) : null}
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="cmf-actions">
        <button className="btn ghost-block" onClick={() => addAnnRow(a.id)}>
          <Icon name="plus" size={13} />
          添加栏目
        </button>
        <button
          className="btn ghost-block"
          title="恢复默认五栏（顺序、栏目名、显示状态一并还原）"
          onClick={() => resetAnnRows(a.id)}
        >
          恢复默认
        </button>
      </div>

      <div className="field">
        <div className="field-head">
          <label>引线端点</label>
          <span className="val">{(a.endStyle ?? 'dot') === 'arrow' ? '箭头' : '圆点'}</span>
        </div>
        <div className="row seg">
          <button
            className={`btn ${(a.endStyle ?? 'dot') === 'dot' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => updateAnnotation(a.id, { endStyle: 'dot' })}
          >
            圆点
          </button>
          <button
            className={`btn ${(a.endStyle ?? 'dot') === 'arrow' ? 'active' : ''}`}
            style={{ flex: 1 }}
            onClick={() => updateAnnotation(a.id, { endStyle: 'arrow' })}
          >
            箭头
          </button>
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <label>引线颜色</label>
          <span className="val">
            {a.lineColorLocked ? (a.lineColor ?? '').toUpperCase() : '跟随全局'}
          </span>
        </div>
        <div className="row line-color-row">
          <input
            className="swatch"
            type="color"
            value={hexOf(a.lineColor ?? LINE_COLOR)}
            title="单独给这条标注改色"
            onChange={(e) => setAnnLineColor(a.id, e.target.value)}
          />
          <div className="line-color-presets">
            {LINE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-dot${
                  a.lineColorLocked && (a.lineColor ?? '').toLowerCase() === c.toLowerCase() ? ' on' : ''
                }`}
                style={{ background: c }}
                title={`这条标注用 ${c}`}
                onClick={() => setAnnLineColor(a.id, c)}
              />
            ))}
          </div>
        </div>
        {a.lineColorLocked ? (
          <button
            className="btn ghost-block"
            style={{ marginTop: 6 }}
            title="取消单独配色，跟着「全局引线样式」一起变"
            onClick={() => setAnnLineColor(a.id, null)}
          >
            恢复跟随全局
          </button>
        ) : (
          <p className="hint" style={{ marginTop: 6 }}>
            跟着全局走；点上面的色块，这条就单独用一个颜色。
          </p>
        )}
      </div>

      <div className="field">
        <div className="field-head">
          <label>引线粗细</label>
          <span className="val">{a.lineWidth ?? LINE_W}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={1}
          max={16}
          step={0.5}
          value={a.lineWidth ?? LINE_W}
          onChange={(e) => updateAnnotation(a.id, { lineWidth: Number(e.target.value) || LINE_W })}
        />
      </div>
      <div className="field">
        <div className="field-head">
          <label>{(a.endStyle ?? 'dot') === 'arrow' ? '箭头大小' : '锚点大小'}</label>
          <span className="val">{a.anchorSize ?? ANCHOR_R}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={4}
          max={48}
          step={1}
          value={a.anchorSize ?? ANCHOR_R}
          onChange={(e) => updateAnnotation(a.id, { anchorSize: Number(e.target.value) || ANCHOR_R })}
        />
      </div>

      <button className="btn danger" style={{ width: '100%' }} onClick={() => removeAnnotation(a.id)}>
        删除此标注
      </button>
    </Section>
  )
}
