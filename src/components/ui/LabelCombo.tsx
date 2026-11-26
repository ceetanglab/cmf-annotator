import { useRef } from 'react'
import { DEFAULT_CMF_PRESETS, DEFAULT_LABEL_PRESETS, useStore } from '../../store'
import Icon from './Icon'

// 栏目名下拉：可从默认项里选回（即使栏目被删掉也能选回来），
// 也可以把当前输入存成新的默认项。
// scope 决定用哪一套默认项：项目信息栏（info）与选中对象（cmf）各自独立
export default function LabelCombo({
  value,
  onChange,
  open,
  setOpen,
  scope = 'info',
  onPickName
}: {
  value: string
  onChange: (v: string) => void
  open: boolean
  setOpen: (v: boolean) => void
  scope?: 'info' | 'cmf'
  // 标注信息栏专用：选「名称」表示把这一行升级成标注框标题（置顶），不是简单改名
  onPickName?: () => void
}) {
  const labelPresets = useStore((s) => s.labelPresets)
  const cmfPresets = useStore((s) => s.cmfPresets)
  const addLabelPreset = useStore((s) => s.addLabelPreset)
  const removeLabelPreset = useStore((s) => s.removeLabelPreset)
  const addCmfPreset = useStore((s) => s.addCmfPreset)
  const removeCmfPreset = useStore((s) => s.removeCmfPreset)

  const isCmf = scope === 'cmf'
  const presets = isCmf ? cmfPresets : labelPresets
  const builtins = isCmf ? DEFAULT_CMF_PRESETS : DEFAULT_LABEL_PRESETS
  const addPreset = isCmf ? addCmfPreset : addLabelPreset
  const removePreset = isCmf ? removeCmfPreset : removeLabelPreset

  const cur = value.trim()
  const saved = !!cur && presets.includes(cur)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="combo">
      <input
        ref={inputRef}
        type="text"
        className="info-label"
        value={value}
        placeholder="栏目名"
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className={`combo-btn${open ? ' open' : ''}`}
        title="选择默认栏目名"
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevron" size={10} />
      </button>

      {open && (
        <div className="combo-menu">
          <div className="combo-head">默认栏目名</div>
          {presets.map((p) => {
            const isName = isCmf && p === '名称' && !!onPickName
            return (
              <div
                key={p}
                className={`combo-item${p === cur ? ' active' : ''}`}
                title={isName ? '把这一行升级为标注框标题（置顶显示）' : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (isName) onPickName?.()
                  else onChange(p)
                  setOpen(false)
                }}
              >
                <span className="combo-text">{p}</span>
                {isName ? <span className="combo-hint">置顶</span> : null}
                {builtins.includes(p) ? null : (
                  <button
                    type="button"
                    className="combo-del"
                    title="从默认列表移除"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      removePreset(p)
                    }}
                  >
                    <Icon name="trash" size={10} />
                  </button>
                )}
              </div>
            )
          })}
          {/* 自定义文字：不选默认项，直接在当前输入框里改 */}
          <div
            className="combo-item combo-custom"
            title="直接用自己写的栏目名"
            onMouseDown={(e) => {
              e.preventDefault()
              setOpen(false)
              inputRef.current?.focus()
              inputRef.current?.select()
            }}
          >
            <Icon name="tag" size={11} />
            <span className="combo-text">自定义文字…</span>
          </div>

          <button
            type="button"
            className="combo-add"
            disabled={!cur || saved}
            onMouseDown={(e) => {
              e.preventDefault()
              if (!cur || saved) return
              addPreset(cur)
              setOpen(false)
            }}
          >
            <Icon name="plus" size={11} />
            {saved ? '已在默认列表中' : `把「${cur || '空'}」存为默认`}
          </button>
        </div>
      )}
    </div>
  )
}
