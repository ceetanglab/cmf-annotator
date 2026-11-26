import { useStore } from '../store'
import Section from './ui/Section'
import { LINE_COLORS } from '../layout'

const END_STYLES = [
  { key: 'dot', label: '圆点' },
  { key: 'arrow', label: '箭头' }
] as const

export default function GlobalStylePanel() {
  const globalLineWidth = useStore((s) => s.globalLineWidth)
  const globalAnchorSize = useStore((s) => s.globalAnchorSize)
  const globalEndStyle = useStore((s) => s.globalEndStyle)
  const globalLineColor = useStore((s) => s.globalLineColor)
  const applyGlobalStyle = useStore((s) => s.applyGlobalStyle)

  return (
    <Section title="全局引线样式" desc="改动同步到全部标注，新增标注也沿用此默认值">
      <div className="field">
        <div className="field-head">
          <label>引线粗细</label>
          <span className="val">{globalLineWidth}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={1}
          max={16}
          step={0.5}
          value={globalLineWidth}
          onChange={(e) => applyGlobalStyle({ lineWidth: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <div className="field-head">
          <label>引线颜色</label>
          <span className="val">{globalLineColor.toUpperCase()}</span>
        </div>
        <div className="row line-color-row">
          <input
            className="swatch"
            type="color"
            value={globalLineColor}
            title="自定义引线颜色"
            onChange={(e) => applyGlobalStyle({ lineColor: e.target.value })}
          />
          <div className="line-color-presets">
            {LINE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`color-dot${c.toLowerCase() === globalLineColor.toLowerCase() ? ' on' : ''}`}
                style={{ background: c }}
                title={c}
                onClick={() => applyGlobalStyle({ lineColor: c })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <label>引线端点</label>
          <span className="val">{globalEndStyle === 'arrow' ? '箭头' : '圆点'}</span>
        </div>
        <div className="row seg">
          {END_STYLES.map((s) => (
            <button
              key={s.key}
              className={`btn ${globalEndStyle === s.key ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => applyGlobalStyle({ endStyle: s.key })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="field-head">
          <label>{globalEndStyle === 'arrow' ? '箭头大小' : '锚点大小'}</label>
          <span className="val">{globalAnchorSize}</span>
        </div>
        <input
          type="range"
          className="slider"
          min={4}
          max={48}
          step={1}
          value={globalAnchorSize}
          onChange={(e) => applyGlobalStyle({ anchorSize: Number(e.target.value) })}
        />
      </div>
    </Section>
  )
}
