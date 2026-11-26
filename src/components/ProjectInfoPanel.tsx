import { useEffect, useRef, useState } from 'react'
import { isAutoDateLabel, isAutoVersionLabel, useStore } from '../store'
import Section from './ui/Section'
import Icon from './ui/Icon'
import LabelCombo from './ui/LabelCombo'
import PresetChips from './ui/PresetChips'
import { FINISH_PRESETS, MATERIAL_PRESETS } from '../lib/cmfPresets'
import { readImageFile, loadImageElement } from '../lib/io'

// 栏目名撞上这几个词就给一排快捷标签（材质 / 工艺常是整份工程的共性信息）
const PRESET_BY_LABEL: Record<string, { label: string; items: readonly string[] }> = {
  材质: { label: '材质', items: MATERIAL_PRESETS },
  材料: { label: '材质', items: MATERIAL_PRESETS },
  工艺: { label: '工艺', items: FINISH_PRESETS },
  表面处理: { label: '工艺', items: FINISH_PRESETS }
}

export default function ProjectInfoPanel() {
  const info = useStore((s) => s.info)
  const addInfoField = useStore((s) => s.addInfoField)
  const updateInfoField = useStore((s) => s.updateInfoField)
  const removeInfoField = useStore((s) => s.removeInfoField)
  const infoVisible = useStore((s) => s.infoVisible)
  const setInfoVisible = useStore((s) => s.setInfoVisible)
  const infoRule = useStore((s) => s.infoRule)
  const setInfoRule = useStore((s) => s.setInfoRule)
  const moveInfoField = useStore((s) => s.moveInfoField)
  const logo = useStore((s) => s.logo)
  const setLogo = useStore((s) => s.setLogo)

  const logoInput = useRef<HTMLInputElement | null>(null)

  // 导入 / 更换品牌标识：读成 dataURL 随工程保存，宽高用于按比例排版
  const onLogoPicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const { dataUrl } = await readImageFile(file)
    const el = await loadImageElement(dataUrl)
    // SVG 之类没有固有尺寸的图给个兜底比例，避免 0 宽高算出无限高
    const w = el.width || 320
    const h = el.height || 120
    setLogo({ dataUrl, w, h, ratio: logo?.ratio ?? 0.6 })
  }

  const [openId, setOpenId] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  // 点面板外任意处收起下拉
  useEffect(() => {
    if (!openId) return
    const onDown = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) setOpenId(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openId])

  return (
    <Section
      title="项目信息栏"
      desc="首行就是标题（画布上的大字），下面依次是栏目名与内容；拖动栏目左侧手柄可调整顺序，栏目名可从下拉选回默认项"
      defaultOpen={false}
      right={
        <button
          type="button"
          className={`eye-btn${infoVisible ? ' on' : ''}`}
          title={infoVisible ? '隐藏信息栏' : '显示信息栏'}
          onClick={() => setInfoVisible(!infoVisible)}
        >
          <Icon name={infoVisible ? 'eye' : 'eye-off'} size={14} />
        </button>
      }
    >
      <div className="cmf-list" ref={listRef}>
        {info.fields.map((f, i) => {
          const open = openId === f.id
          // 第一行 = 标题：不讲类目名、不参与排序，用一个色块标识它是「标题」
          const isTitle = i === 0
          // 「时间」「版本号」由程序维护：标出来，免得用户以为是手填字段
          const auto = isTitle
            ? null
            : isAutoDateLabel(f.label)
              ? '打开工程时自动更新为当天日期'
              : isAutoVersionLabel(f.label)
                ? '每次导出后自动 +0.1（V1.0 → V1.1 … V1.9 → V2.0）'
                : null
          // 分隔横线跟着公司标识走：标识置顶（或还没导入标识、横线画在标题下方）时才给开关
          const showRuleOpt = isTitle && (logo?.place === 'top' || !logo)
          // 材质 / 工艺这两类栏目额外给一排快捷标签
          const preset = isTitle ? undefined : PRESET_BY_LABEL[f.label.trim()]
          return (
            <div
              className={`cmf-row${isTitle ? ' is-title' : ''}${dragFrom === i ? ' dragging' : ''}${dropAt === i && dragFrom !== null && dragFrom !== i ? ' drop-target' : ''}${f.hidden ? ' is-off' : ''}`}
              key={f.id}
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
                moveInfoField(dragFrom, i)
                setDragFrom(null)
                setDropAt(null)
              }}
            >
              <div className="cmf-head">
                {isTitle ? (
                  <span className="cmf-key is-title" title="信息栏顶部的大字标题">
                    标题
                  </span>
                ) : (
                  <>
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
                      value={f.label}
                      onChange={(v) => updateInfoField(f.id, { label: v })}
                      open={open}
                      setOpen={(v) => setOpenId(v ? f.id : null)}
                    />
                  </>
                )}
                <span className="cmf-spacer" />
                {auto && (
                  <span className="auto-tag" title={auto}>
                    自动
                  </span>
                )}
                <button
                  type="button"
                  className={`eye-btn${f.hidden ? '' : ' on'}`}
                  title={f.hidden ? '在信息栏里显示该行' : '在信息栏里隐藏该行'}
                  onClick={() => updateInfoField(f.id, { hidden: !f.hidden })}
                >
                  <Icon name={f.hidden ? 'eye-off' : 'eye'} size={13} />
                </button>
                {/* 标题只能隐藏、不能删（删了信息栏就没有大字标题了） */}
                {!isTitle && (
                  <button
                    className="icon-del"
                    title="删除该栏目"
                    disabled={info.fields.length <= 1}
                    onClick={() => removeInfoField(f.id)}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                )}
              </div>

              <div className="cmf-body">
                <input
                  type="text"
                  value={f.value}
                  title={auto ?? undefined}
                  placeholder={isTitle ? '标题内容（公司 / 项目名）' : '内容'}
                  onChange={(e) => updateInfoField(f.id, { value: e.target.value })}
                />
                {preset ? (
                  <PresetChips
                    value={f.value}
                    presets={preset.items}
                    label={preset.label}
                    onChange={(v) => updateInfoField(f.id, { value: v })}
                  />
                ) : null}
              </div>

              {/* 分隔横线的开关就挂在标题文本框下方 */}
              {showRuleOpt && (
                <div className="info-opt-row cmf-title-opt">
                  <span>{logo?.place === 'top' ? '标识下横线' : '标题下横线'}</span>
                  <span className="val">{infoRule ? '显示' : '隐藏'}</span>
                  <button
                    type="button"
                    className={`eye-btn${infoRule ? ' on' : ''}`}
                    title={infoRule ? '隐藏这条分隔横线' : '显示这条分隔横线'}
                    onClick={() => setInfoRule(!infoRule)}
                  >
                    <Icon name={infoRule ? 'eye' : 'eye-off'} size={13} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button className="btn ghost-block" onClick={addInfoField}>
        <Icon name="plus" size={13} />
        添加栏目
      </button>

      {/* 品牌标识：放在信息栏卡片顶部（标题上方），可换图 / 调大小 / 移除 */}
      <div className="logo-box">
        <div className="logo-head">
          <span>品牌标识</span>
          <span className="val">{logo ? (logo.place === 'bottom' ? '显示在信息栏底部' : '显示在信息栏顶部') : '未导入'}</span>
        </div>
        {logo ? (
          <>
            <div className="logo-preview">
              <img src={logo.dataUrl} alt="品牌标识" />
              <div className="logo-acts">
                <button type="button" className="btn" onClick={() => logoInput.current?.click()}>
                  更换
                </button>
                <button type="button" className="icon-del" title="移除品牌标识" onClick={() => setLogo(null)}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
            <div className="field" style={{ marginTop: 8, marginBottom: 8 }}>
              <div className="field-head">
                <label>标识位置</label>
                <span className="val">{logo.place === 'bottom' ? '信息栏底部' : '信息栏顶部'}</span>
              </div>
              <div className="row seg">
                <button
                  type="button"
                  className={`btn ${logo.place === 'bottom' ? '' : 'active'}`}
                  style={{ flex: 1 }}
                  onClick={() => setLogo({ ...logo, place: 'top' })}
                >
                  置顶
                </button>
                <button
                  type="button"
                  className={`btn ${logo.place === 'bottom' ? 'active' : ''}`}
                  style={{ flex: 1 }}
                  onClick={() => setLogo({ ...logo, place: 'bottom' })}
                >
                  置底
                </button>
              </div>
            </div>
            <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
              <div className="field-head">
                <label>标识大小</label>
                <span className="val">{Math.round(logo.ratio * 100)}%</span>
              </div>
              <input
                type="range"
                className="slider"
                min={20}
                max={100}
                step={1}
                value={Math.round(logo.ratio * 100)}
                onChange={(e) => setLogo({ ...logo, ratio: Number(e.target.value) / 100 })}
              />
            </div>
          </>
        ) : (
          <button type="button" className="logo-add" onClick={() => logoInput.current?.click()}>
            <Icon name="plus" size={13} />
            导入品牌标识（logo）
          </button>
        )}
        <input ref={logoInput} type="file" accept="image/*" className="hidden-input" onChange={onLogoPicked} />
      </div>
    </Section>
  )
}
