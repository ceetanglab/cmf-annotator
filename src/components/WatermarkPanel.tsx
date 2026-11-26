import { useStore } from '../store'
import Section from './ui/Section'
import Icon from './ui/Icon'
import { clampDensity, clampWmSize, WM_DENSITY_MAX, WM_DENSITY_MIN, WM_SIZE_MAX, WM_SIZE_MIN } from '../lib/watermark'

const MODES = [
  { key: 'single', label: '单个文字' },
  { key: 'tile', label: '平铺铺满' }
] as const

// 全局水印：作用于整张图（不是单个标注），随工程保存，导出时一并输出
export default function WatermarkPanel() {
  const wm = useStore((s) => s.watermark)
  const patch = useStore((s) => s.patchWatermark)

  return (
    <Section
      title="水印"
      desc="全局水印，覆盖整张成品图；单个模式可直接在画布上拖动位置"
      right={
        <button
          type="button"
          className={`eye-btn${wm.on ? ' on' : ''}`}
          title={wm.on ? '关闭水印' : '开启水印'}
          onClick={() => patch({ on: !wm.on })}
        >
          <Icon name={wm.on ? 'eye' : 'eye-off'} size={14} />
        </button>
      }
    >
      <div className={`wm-body${wm.on ? '' : ' is-off'}`}>
        <div className="row seg">
          {MODES.map((m) => (
            <button
              key={m.key}
              className={`btn ${wm.mode === m.key ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => patch({ mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <div className="field-head">
            <label>水印文字</label>
          </div>
          <input
            type="text"
            value={wm.text}
            placeholder="如：内部评审稿 / 严禁外传"
            onChange={(e) => patch({ text: e.target.value })}
          />
        </div>

        <div className="field">
          <div className="field-head">
            <label>字号</label>
            <span className="val">{wm.size}</span>
          </div>
          <input
            type="range"
            className="slider"
            min={WM_SIZE_MIN}
            max={WM_SIZE_MAX}
            step={1}
            value={wm.size}
            onChange={(e) => patch({ size: clampWmSize(Number(e.target.value)) })}
          />
        </div>

        {wm.mode === 'tile' && (
          <div className="field">
            <div className="field-head">
              <label>密度</label>
              <span className="val">{wm.density}</span>
            </div>
            <input
              type="range"
              className="slider"
              min={WM_DENSITY_MIN}
              max={WM_DENSITY_MAX}
              step={1}
              value={wm.density}
              onChange={(e) => patch({ density: clampDensity(Number(e.target.value)) })}
            />
          </div>
        )}

        <div className="field" style={{ marginBottom: 8 }}>
          <div className="field-head">
            <label>透明度</label>
            <span className="val">{Math.round(wm.opacity * 100)}%</span>
          </div>
          <input
            type="range"
            className="slider"
            min={1}
            max={100}
            step={1}
            value={Math.round(wm.opacity * 100)}
            onChange={(e) => patch({ opacity: Math.max(0.01, Number(e.target.value) / 100) })}
          />
        </div>

        {wm.mode === 'single' && (
          <button
            type="button"
            className="btn ghost-block"
            title="把水印放回内容中心"
            onClick={() => patch({ x: undefined, y: undefined })}
          >
            回到中心
          </button>
        )}

        {!wm.on && (
          <p className="wm-hint">点右上角眼睛开启；文字里含「内部评审稿」这类标记时，能避免截图被误用</p>
        )}
      </div>
    </Section>
  )
}
