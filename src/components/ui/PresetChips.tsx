import { useState } from 'react'
import { splitPresetValue, togglePresetValue } from '../../lib/cmfPresets'

/**
 * 材质 / 工艺的快捷标签：折叠时只占一行小按钮，展开后平铺点选。
 * 一项一项点、再点一次取消——值始终是同一行文字，画布上的标注框不用改渲染逻辑。
 */
export default function PresetChips({
  value,
  presets,
  label,
  onChange
}: {
  value: string
  presets: readonly string[]
  label: string // 「材质」/「工艺」，用在提示语里
  onChange: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const items = splitPresetValue(value)
  // 只数清单里的项：手打的自由描述（如「PC+ABS 阻燃」）不该算进「已选」
  const picked = items.filter((x) => presets.includes(x))

  return (
    <div className="preset-chips">
      <button
        type="button"
        className={`preset-toggle${open ? ' is-open' : ''}`}
        title={
          open
            ? `收起${label}标签`
            : `展开常用${label}，点一下填进去、再点一次去掉；可多选`
        }
        onClick={() => setOpen((v) => !v)}
      >
        <span className="preset-caret" aria-hidden />
        {open ? '收起' : `常用${label}`}
        {picked.length ? <b className="preset-count">{picked.length}</b> : null}
      </button>

      {open ? (
        <div className="preset-pad">
          {presets.map((p) => {
            const on = items.includes(p)
            return (
              <button
                key={p}
                type="button"
                className={`preset-chip${on ? ' on' : ''}`}
                title={on ? `去掉「${p}」` : `加上「${p}」`}
                onClick={() => onChange(togglePresetValue(value, p))}
              >
                {p}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
