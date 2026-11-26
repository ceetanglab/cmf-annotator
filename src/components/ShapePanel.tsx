import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import type { ShapeItem } from '../types'
import { SHAPE_COLORS, SHAPE_DEFAULT_FONT, SHAPE_DEFAULT_STROKE, SHAPE_LABEL } from '../lib/shapes'
import Section from './ui/Section'
import Icon from './ui/Icon'

/**
 * 形状的「标注设置」。
 * 不单独占一个页签：选中形状时右栏切到「标注」页，由 PropertyPanel 在这里分流渲染。
 * 选中多个形状时，下面每一项都是批量改。
 */
export default function ShapePanel() {
  const shapes = useStore((s) => s.shapes)
  const selectedIds = useStore((s) => s.selectedIds)
  const updateShape = useStore((s) => s.updateShape)
  const removeShapes = useStore((s) => s.removeShapes)
  const duplicateSelected = useStore((s) => s.duplicateSelected)
  const textRef = useRef<HTMLTextAreaElement>(null)
  // 尺寸输入框的「正在输入」草稿：打一半（比如只敲了个 3）不要立刻写成 3×…
  const [sizeDraft, setSizeDraft] = useState<{ w: string; h: string } | null>(null)

  const picked = shapes.filter((sh) => selectedIds.includes(sh.id))
  const one = picked[0]
  const multi = picked.length > 1
  const isText = !!one && one.kind === 'text'
  const canFill = !!one && (one.kind === 'rect' || one.kind === 'circle')

  // 画布上双击形状 → 选中并把输入焦点送到文字框（文本框才有）
  useEffect(() => {
    const onEdit = () => {
      if (!textRef.current) return
      textRef.current.focus()
      textRef.current.select()
    }
    window.addEventListener('cmf:edit-shape', onEdit)
    return () => window.removeEventListener('cmf:edit-shape', onEdit)
  }, [])

  const apply = (patch: Partial<ShapeItem>) => {
    for (const sh of picked) updateShape(sh.id, patch)
  }

  // 换选中对象就丢掉草稿，否则会把上一条的数值显示到新形状上
  useEffect(() => setSizeDraft(null), [one?.id])

  const lock = !!one?.lockRatio
  const wNow = Math.max(1, Math.round(one?.w ?? 1))
  const hNow = Math.max(1, Math.round(one?.h ?? 1))

  // 改宽 / 改高：锁了比例就按另一个方向一起缩；多选时每个形状按自己的比例走
  const setSize = (axis: 'w' | 'h', raw: string) => {
    setSizeDraft({ w: axis === 'w' ? raw : String(wNow), h: axis === 'h' ? raw : String(hNow) })
    const n = Number(raw)
    if (!raw.trim() || !Number.isFinite(n) || n < 1) return
    const v = Math.min(20000, Math.round(n))
    for (const sh of picked) {
      const patch: Partial<ShapeItem> = axis === 'w' ? { w: v } : { h: v }
      if (lock) {
        const old = axis === 'w' ? Math.max(1, sh.w) : Math.max(1, sh.h)
        const other = axis === 'w' ? sh.h : sh.w
        const next = Math.max(2, Math.round((v * other) / old))
        if (axis === 'w') patch.h = next
        else patch.w = next
      }
      updateShape(sh.id, patch)
    }
  }

  const swapSize = () => {
    for (const sh of picked) updateShape(sh.id, { w: sh.h, h: sh.w })
    setSizeDraft(null)
  }

  if (!one) {
    return (
      <Section title="标注设置" desc="点画布上的形状自动跳到这里">
        <div className="empty pad">
          还没有选中形状
          <br />
          <span className="hint">在工具条选「文本 / 直线 / 多段线 / 圆形 / 矩形」：文本双击空白新建，直线 / 圆形 / 矩形双击起点再双击终点</span>
        </div>
      </Section>
    )
  }

  const color = one.color.toUpperCase()
  const stroke = one.strokeWidth ?? SHAPE_DEFAULT_STROKE
  const opacity = one.opacity ?? 1
  const fontSize = one.fontSize ?? SHAPE_DEFAULT_FONT

  return (
    <>
      <Section
        title="标注设置"
        desc={
          multi
            ? `形状 · 已选中 ${picked.length} 个，下面每一项都会同时改`
            : `形状 · ${SHAPE_LABEL[one.kind]}　双击形状可快速定位到文字框`
        }
      >
        {isText ? (
          <>
            <div className="field">
              <div className="field-head">
                <label>文字内容</label>
                <span className="val">思源黑体</span>
              </div>
              <textarea
                ref={textRef}
                value={one.text ?? ''}
                rows={3}
                placeholder="输入标注文字，回车可换行"
                onChange={(e) => apply({ text: e.target.value })}
              />
            </div>
            <div className="field">
              <div className="field-head">
                <label>字号</label>
                <span className="val">{Math.round(fontSize)} px</span>
              </div>
              <input
                className="slider"
                type="range"
                min={12}
                max={120}
                step={1}
                value={fontSize}
                onChange={(e) => apply({ fontSize: Number(e.target.value) })}
              />
            </div>
          </>
        ) : null}

        <div className="field">
          <div className="field-head">
            <label>{isText ? '文字颜色' : '线条 / 描边颜色'}</label>
            <span className="val">{color}</span>
          </div>
          <div className="row line-color-row">
            <input
              className="swatch"
              type="color"
              value={one.color}
              title="自定义颜色"
              onChange={(e) => apply({ color: e.target.value })}
            />
            <div className="line-color-presets">
              {SHAPE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot${c.toLowerCase() === one.color.toLowerCase() ? ' on' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => apply({ color: c })}
                />
              ))}
            </div>
          </div>
        </div>

        {!isText ? (
          <div className="field">
            <div className="field-head">
              <label>尺寸</label>
              <span className="val">
                {lock ? '锁定比例' : '可自由拉长宽'}
              </span>
            </div>
            <div className="row size-row">
              <label className="size-cell" title="宽度（px）">
                <span>宽</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={sizeDraft?.w ?? String(wNow)}
                  onChange={(e) => setSize('w', e.target.value)}
                  onBlur={() => setSizeDraft(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                />
              </label>
              <span className="size-x">×</span>
              <label className="size-cell" title="高度（px）">
                <span>高</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={sizeDraft?.h ?? String(hNow)}
                  onChange={(e) => setSize('h', e.target.value)}
                  onBlur={() => setSizeDraft(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                  }}
                />
              </label>
              <button
                type="button"
                className={`size-btn${lock ? ' on' : ''}`}
                title={lock ? '已锁定长宽比例（点一下解锁）' : '锁定长宽比例：拖角时等比缩放'}
                onClick={() => apply({ lockRatio: !lock })}
              >
                <Icon name={lock ? 'lock' : 'unlock'} size={13} />
              </button>
              <button type="button" className="size-btn" title="互换长宽" onClick={swapSize}>
                <Icon name="swap" size={13} />
              </button>
            </div>
          </div>
        ) : null}

        {!isText ? (
          <div className="field">
            <div className="field-head">
              <label>线条粗细</label>
              <span className="val">{stroke} px</span>
            </div>
            <input
              className="slider"
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={stroke}
              onChange={(e) => apply({ strokeWidth: Number(e.target.value) })}
            />
          </div>
        ) : null}

        {canFill ? (
          <div className="field">
            <div className="field-head">
              <label>填充</label>
              <span className="val">{one.fill ? one.fill.toUpperCase() : '无'}</span>
            </div>
            <div className="row line-color-row">
              <input
                className="swatch"
                type="color"
                value={one.fill ?? '#ffffff'}
                title="选一个填充色"
                onChange={(e) => apply({ fill: e.target.value })}
              />
              <button className="btn ghost" onClick={() => apply({ fill: null })}>
                无填充
              </button>
            </div>
          </div>
        ) : null}

        <div className="field">
          <div className="field-head">
            <label>透明度</label>
            <span className="val">{Math.round(opacity * 100)}%</span>
          </div>
          <input
            className="slider"
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => apply({ opacity: Number(e.target.value) })}
          />
        </div>
      </Section>

      <Section title="操作">
        <div className="row seg">
          <button className="btn" style={{ flex: 1 }} onClick={duplicateSelected} title="原地复制一份（Ctrl+D）">
            <Icon name="plus" size={12} />
            复制
          </button>
          <button
            className="btn danger"
            style={{ flex: 1 }}
            onClick={() => removeShapes(picked.map((sh) => sh.id))}
            title="删除选中的形状（Delete）"
          >
            <Icon name="trash" size={12} />
            删除
          </button>
        </div>
        <p className="sect-desc" style={{ marginTop: 10, marginBottom: 0 }}>
          拖动形状可移动；拖四角或四边中手柄可自由改长宽，按锁形按钮则等比缩放。Shift 点选可多选，右栏的改动会同步到全部选中项。按 Esc 回到选择工具。
        </p>
      </Section>
    </>
  )
}
