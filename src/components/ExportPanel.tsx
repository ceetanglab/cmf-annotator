import type { MutableRefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useStore, activeBoard, infoName } from '../store'
import type { CanvasControls } from '../canvasControls'
import type { ExportFormat } from '../types'
import {
  DPI_OPTIONS,
  MIN_DPI,
  MAX_DPI,
  clampDpi,
  overCanvasLimit,
  outputMemoryMB,
  isHeavyOutput,
  pagePx,
  presetShortName,
  nativeDpiFor
} from '../lib/presets'
import { DEFAULT_BOARD_DPI, DEFAULT_BOARD_FORMAT } from '../lib/artboard'
import Section from './ui/Section'
import Icon from './ui/Icon'
import { downloadJSON } from '../lib/io'

interface Props {
  controlsRef: MutableRefObject<CanvasControls | null>
}

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'pdf', 'svg']

const FORMAT_HINT: Partial<Record<ExportFormat, string>> = {
  jpeg: '没有透明通道：透明的画板会按白底出图',
  pdf: '单页位图 · 要分层可编辑请用 SVG',
  svg: '分层矢量：渲染图 / 标注 / 信息栏可单独选中，文字可编辑'
}

/**
 * 导出设置：只针对「当前选中的画板」。
 * 选中不同画板会有不同设置（分辨率 / 格式存在画板上），所以这个面板永远是「这块（或这批）要出成什么」。
 */
export default function ExportPanel({ controlsRef }: Props) {
  // 「有没有东西可导出」只该管住导出动作，不该管住设置项：
  // 分辨率 / 格式 / 原分辨率是参数，没有图的时候先调好也很正常
  const hasContent = useStore((s) => s.images.length > 0)
  // 导出项目文件的门槛更低：只有标注没有图，也是个值得存下来的工程
  const hasAny = useStore((s) => s.images.length > 0 || s.annotations.length > 0)
  const exportProject = useStore((s) => s.exportProject)
  const artboards = useStore((s) => s.artboards)
  const selectedBoardIds = useStore((s) => s.selectedBoardIds)
  const setBoardExport = useStore((s) => s.setBoardExport)
  const sectRef = useRef<HTMLElement | null>(null)

  const exportName = useStore((s) => s.exportName)
  const setExportName = useStore((s) => s.setExportName)
  const info = useStore((s) => s.info)

  const picked = artboards.filter((b) => selectedBoardIds.includes(b.id))
  const board = picked[0] ?? activeBoard({ artboards, selectedBoardIds })
  const multi = picked.length > 1
  const dpi = board?.dpi ?? DEFAULT_BOARD_DPI
  const format = board?.format ?? DEFAULT_BOARD_FORMAT
  const native = !!board?.native
  const dpiCustom = !!board?.dpiCustom
  // 多选时各项可能不一致：不一致就不高亮任何一格，并写明「多个」
  const mixedDpi = picked.some((b) => (b.dpi ?? DEFAULT_BOARD_DPI) !== dpi)
  const mixedFormat = picked.some((b) => (b.format ?? DEFAULT_BOARD_FORMAT) !== format)
  const mixedNative = picked.some((b) => !!b.native !== native)

  // 输入框用草稿值：允许中途出现空串 / 非法字符，失焦或回车才落库
  const [dpiText, setDpiText] = useState(String(dpi))
  const dpiRef = useRef<HTMLInputElement | null>(null)
  const wantFocusRef = useRef(false)
  // 「导出所有画板」时是否统一用当前画板的分辨率与格式（默认统一：一套交付物通常要一致）
  // 批量导出默认「各用各的设置」：只有想要一套统一规格时才勾上
  const [unify, setUnify] = useState(false)

  // 点预设、切换画板等外部改值时同步回来（含 clamp 后的真实值）
  useEffect(() => {
    setDpiText(String(dpi))
  }, [dpi])

  // 只有「点了自定义」才抢焦点，切换画板时不该打断用户
  useEffect(() => {
    if (dpiCustom && wantFocusRef.current) {
      wantFocusRef.current = false
      dpiRef.current?.focus()
      dpiRef.current?.select()
    }
  }, [dpiCustom])

  const commitDpi = (raw: string) => {
    const n = Number(raw.trim())
    if (!raw.trim() || !Number.isFinite(n)) {
      setDpiText(String(dpi))
      return
    }
    const v = clampDpi(n)
    setBoardExport({ dpi: v, dpiCustom: true })
    setDpiText(String(v))
  }

  const pickPresetDpi = (d: number) => setBoardExport({ dpi: d, dpiCustom: false })
  const pickCustomDpi = () => {
    // 已在自定义模式：只是把焦点放回输入框；但若当前是「原分辨率」，点它意味着切回手动 DPI
    if (dpiCustom && !native) {
      dpiRef.current?.focus()
      dpiRef.current?.select()
      return
    }
    wantFocusRef.current = true
    setBoardExport({ dpi, dpiCustom: true })
  }

  if (!board) return null

  const presetName = presetShortName(board.preset)
  const nativePx = { w: Math.round(board.w), h: Math.round(board.h) }
  // 「原分辨率」时，DPI 不再由用户选，而是按 画板像素 ÷ 页面宽度 自动换算
  const autoDpi = nativeDpiFor(board.w, board.preset)
  const presetPx = pagePx(board.preset, dpi)
  // 「自由」= 按画板的世界坐标像素 × (DPI/96)；96 DPI 时正好 1:1
  const freeFit = dpi / 96
  const sizeTxt = native
    ? `原分辨率 · 输出 ${nativePx.w} × ${nativePx.h} px`
    : presetPx
      ? `${presetName} · ${dpi} DPI · 输出 ${presetPx.w} × ${presetPx.h} px`
      : freeFit === 1
        ? '自由尺寸 · 画板原尺寸 1:1（无缩放）'
        : `自由尺寸 · 画板 × ${freeFit.toFixed(2)}（${freeFit > 1 ? '放大' : '缩小'}）`
  // 真正会输出的像素：原分辨率与预设页面都能算死，提前把「太大导不出来」这件事说清楚
  const outPx = native ? nativePx : presetPx
  const limitMsg = outPx ? overCanvasLimit(outPx.w, outPx.h) : null
  const heavyMB = outPx && isHeavyOutput(outPx.w, outPx.h) ? outputMemoryMB(outPx.w, outPx.h) : 0
  const dpiTxt = native
    ? autoDpi
      ? `${autoDpi} DPI · 自动`
      : '自动'
    : mixedDpi
      ? '多个分辨率'
      : `${dpi} DPI`
  const targetTxt = multi
    ? `已选 ${picked.length} 块：${picked.map((b) => b.name).join('、')}`
    : `${board.name}${board.auto ? '（跟随内容）' : ''}`

  return (
    <Section
      title="导出设置"
      domRef={sectRef}
      desc={sizeTxt}
      // 左栏里图层列表更需要高度，导出设置默认收起：点标题展开，
      // 出图统一走分组底部那颗主按钮，标题行不再挂冗余小图标
      defaultOpen={false}
    >
      <div className="field">
        <div className="field-head">
          <label>当前画板</label>
          <span className="val">{multi ? `${picked.length} 块` : presetShortName(board.preset)}</span>
        </div>
        <div className="meta" style={{ marginTop: 0 }}>{targetTxt}</div>
      </div>

      <div className="field">
        <div className="field-head">
          <label>文件名</label>
          <span className="val">.{format}</span>
        </div>
        <input
          className="name-input"
          value={exportName}
          maxLength={80}
          spellCheck={false}
          placeholder={infoName(info)}
          aria-label="导出文件名"
          title={
            multi
              ? '导出多块画板时，文件名后面会自动缀上画板名'
              : '导出文件的名字（不用写扩展名，按格式自动补）'
          }
          onChange={(e) => setExportName(e.target.value.replace(/[\\/:*?"<>|]/g, ''))}
          // 清空就回落到项目名（导出时也是这个规则），不另存一份固定名
          onBlur={() => {
            if (!exportName.trim()) setExportName('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      </div>

      <div className="field">
        <div className="field-head">
          <label>分辨率</label>
          <span className="val">{dpiTxt}</span>
        </div>
        <div className="row seg dpi-row-seg">
          {DPI_OPTIONS.map((d) => (
            <button
              key={d}
              className={`btn dpi-btn ${!native && !dpiCustom && !mixedDpi && dpi === d ? 'active' : ''}`}
              style={{ flex: 1 }}
              onClick={() => pickPresetDpi(d)}
            >
              {d}
            </button>
          ))}
          <button
            className={`btn dpi-btn ${!native && dpiCustom && !mixedDpi ? 'active' : ''}`}
            style={{ flex: 1 }}
            title="自定义输出 DPI"
            onClick={pickCustomDpi}
          >
            自定义
          </button>
        </div>
        {dpiCustom && !native && (
          <div className="dpi-row">
            <input
              ref={dpiRef}
              type="text"
              inputMode="numeric"
              className="dpi-input"
              value={dpiText}
              placeholder={String(MIN_DPI)}
              aria-label="自定义 DPI"
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '')
                setDpiText(raw)
                // 输入过程中只要合法就即时生效，输出尺寸跟着变
                const n = Number(raw)
                if (raw && n >= MIN_DPI && n <= MAX_DPI) setBoardExport({ dpi: n, dpiCustom: true })
              }}
              onBlur={(e) => commitDpi(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitDpi((e.target as HTMLInputElement).value)
                  ;(e.target as HTMLInputElement).blur()
                } else if (e.key === 'Escape') {
                  setDpiText(String(dpi))
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
            <span className="dpi-unit">DPI</span>
            <span className="dpi-range">{MIN_DPI}–{MAX_DPI}</span>
          </div>
        )}
        {/* 原分辨率是「分辨率」这一组的第五个选项，只是名字长所以单独一行：
            选中它就不按 DPI 缩放，DPI 反过来由画板像素 ÷ 页宽自动算出来 */}
        <button
          className={`btn ghost-block native-btn ${native && !mixedNative ? 'active' : ''}`}
          title="导出画板的原始像素（1:1，不缩放）；DPI 由画板像素自动换算"
          onClick={() => setBoardExport({ native: !native })}
        >
          <Icon name="frame" size={13} />
          导出画板原分辨率
        </button>
        {native ? (
          <div className="meta" style={{ marginTop: 6 }}>
            画板 {nativePx.w} × {nativePx.h} px
            <br />
            {presetName === '自由' ? '无物理页面，按 96 DPI 计' : `等效 ${presetName} ${autoDpi} DPI`}
          </div>
        ) : null}
        {limitMsg ? (
          <div className="dpi-warn">输出过大：{limitMsg}，导出会失败，请降低分辨率或换更小的画板比例</div>
        ) : heavyMB > 0 ? (
          <div className="dpi-note">输出较大，约 {heavyMB} MB 显存，导出需要等几秒</div>
        ) : null}
      </div>

      <div className="field">
        <div className="field-head">
          <label>格式</label>
          <span className="val">{mixedFormat ? '多个格式' : format.toUpperCase()}</span>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {FORMATS.map((f) => (
            <button
              key={f}
              className={`btn ${!mixedFormat && format === f ? 'active' : ''}`}
              onClick={() => setBoardExport({ format: f })}
            >
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        {FORMAT_HINT[format] && !mixedFormat && (
          <div className="meta" style={{ marginTop: 6 }}>{FORMAT_HINT[format]}</div>
        )}
      </div>

      {multi || native ? (
        <div className="meta" style={{ marginBottom: 8 }}>
          {multi ? `导出设置作用于这 ${picked.length} 块画板；顶部导出按钮出的是它们全部。` : ''}
          {native ? `当前为原分辨率 ${nativePx.w} × ${nativePx.h} px。` : ''}
        </div>
      ) : null}
      {/* 灰按钮不给理由等于坏了：没有渲染图时明说一句，省得以为是 bug */}
      {!hasContent && (
        <div className="dpi-note" style={{ marginTop: 0, marginBottom: 8 }}>
          画布上还没有渲染图，所以导出按钮暂时是灰的。上面的分辨率、格式可以先调好，导入图片后直接生效。
        </div>
      )}
      <button
        className="btn ghost-block"
        style={{ marginBottom: 4 }}
        disabled={!hasAny}
        title={
          hasAny
            ? '导出工程文件（.json）：渲染图、标注、画板、分组全在里面，换台电脑也能导入继续编辑'
            : '画布上还没有内容，没有可导出的工程文件'
        }
        onClick={() => downloadJSON(exportProject())}
      >
        导出项目文件
      </button>
      <div className="dpi-note" style={{ marginTop: 0, marginBottom: 7 }}>
        导出的是工程文件（JSON），不是渲染图；用左栏「项目 → 导入项目」导回来接着改。
      </div>
      <button
        className="btn primary block"
        disabled={!hasContent}
        title={
          hasContent
            ? multi
              ? `依次导出选中的 ${picked.length} 块画板`
              : native
                ? `按画板原像素出图（${nativePx.w} × ${nativePx.h} px）`
                : '按画板比例与分辨率导出'
            : '先导入渲染图才能导出'
        }
        onClick={() => void controlsRef.current?.exportBoards('selected')}
      >
        {multi ? `导出选中画板（${picked.length}）` : '导出选中画板'}
      </button>

      <div className="field" style={{ marginTop: 10 }}>
        <div className="field-head">
          <label>批量导出</label>
          <span className="val">{artboards.length} 块画板</span>
        </div>
        {/* 勾选是「渲染时覆盖」，不改画板自身设置。左栏只有 236px，
            长句必然折行且会在「分辨率」中间断开，所以拆两行：
            第一行说规则，第二行点明参考哪一块、出成什么 */}
        <label
          className="check-row"
          title={`勾上后 ${artboards.length} 块画板都按「${board.name}」的 ${board.native ? '原分辨率' : `${dpi} DPI`} / ${format.toUpperCase()} 出图；各画板自身的设置不变`}
        >
          <input type="checkbox" checked={unify} onChange={(e) => setUnify(e.target.checked)} />
          <span>所有画板用当前选中的画板设置</span>
        </label>
        <div className="check-sub">
          参考「{board.name}」：{board.native ? '原分辨率' : `${dpi} DPI`} · {format.toUpperCase()}
        </div>
        <button
          className="btn ghost-block"
          style={{ marginTop: 7 }}
          disabled={!hasContent || artboards.length === 0}
          title={
            unify
              ? `按本画板的 ${dpi} DPI / ${format.toUpperCase()} 依次导出全部 ${artboards.length} 块画板`
              : `每块画板按自己的分辨率与格式导出（共 ${artboards.length} 块，可能混合多种格式）`
          }
          onClick={() => void controlsRef.current?.exportBoards('all', unify)}
        >
          <Icon name="layers" size={13} />
          导出所有画板
        </button>
        <div className="meta" style={{ marginTop: 6 }}>
          {unify
            ? '仅本次生效，不改画板设置'
            : '各画板按自己的设置出图；浏览器可能询问是否允许下载多个文件。'}
        </div>
      </div>
    </Section>
  )
}
