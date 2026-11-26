import { useEffect, useState } from 'react'
import { useStore, activeBoard } from '../store'
import { MAX_CANVAS_SIDE, PAGE_PRESETS, presetShortName } from '../lib/presets'
import { BOARD_BG_SWATCHES } from '../lib/artboard'
import Section from './ui/Section'
import Icon from './ui/Icon'

// 比例示意图标：按真实宽高比画一个矩形，横向=宽扁、纵向=竖长、正方形=方；自由=虚线
function PageGlyph({ mmW, mmH }: { mmW: number; mmH: number }) {
  const S = 16
  const free = mmW <= 0 || mmH <= 0
  let w = S
  let h = S
  if (!free) {
    const a = mmW / mmH
    if (a >= 1) {
      w = S
      h = S / a
    } else {
      h = S
      w = S * a
    }
  }
  const x = (20 - w) / 2
  const y = (20 - h) / 2
  return (
    <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden="true" className="preset-glyph">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={1.5}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeDasharray={free ? '2 1.6' : undefined}
      />
    </svg>
  )
}

/** 底色一格：透明用斜线格表示，其余就是纯色块 */
function BgSwatch({ color, on, title, onClick }: { color: string | null; on: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`bg-swatch${on ? ' is-on' : ''}${color ? '' : ' is-none'}`}
      style={color ? { background: color } : undefined}
      title={title}
      aria-label={title}
      onClick={onClick}
    />
  )
}

/** 画板边长下限：和 makeBoard 的 20 保持一致，再小就没法在里面放东西了 */
const MIN_BOARD_PX = 20

/**
 * 右侧「画板」页：选中一块时是这块画板的设置，选中多块时是批量设置。
 * 导出参数（分辨率 / 格式）故意不放这里 —— 那是「这块要出成什么文件」，
 * 统一在左栏「导出设置」里管，免得同一个开关出现在两个地方。
 */
export default function BoardPanel() {
  const artboards = useStore((s) => s.artboards)
  const selectedBoardIds = useStore((s) => s.selectedBoardIds)
  const setBoardPreset = useStore((s) => s.setBoardPreset)
  const setBoardBg = useStore((s) => s.setBoardBg)
  const renameBoard = useStore((s) => s.renameBoard)
  const updateBoard = useStore((s) => s.updateBoard)
  const duplicateBoard = useStore((s) => s.duplicateBoard)
  const removeBoards = useStore((s) => s.removeBoards)
  const fitBoardsToContent = useStore((s) => s.fitBoardsToContent)
  const selectAllBoards = useStore((s) => s.selectAllBoards)

  const picked = artboards.filter((b) => selectedBoardIds.includes(b.id))
  const one = picked.length === 1 ? picked[0] : null
  const board = one ?? activeBoard({ artboards, selectedBoardIds })
  const [customBg, setCustomBg] = useState('#ffffff')
  // 「自由」时下方宽高框的草稿：输入过程中不归一化，否则打「1」就被四舍五入顶掉
  const [pxDraft, setPxDraft] = useState<{ w: string; h: string } | null>(null)

  // 换画板、换比例都丢掉草稿，免得把上一块的数值带到这一块
  useEffect(() => setPxDraft(null), [board?.id, board?.preset])

  if (!board) return null
  const multi = picked.length > 1
  // 多选时值可能不一致：一致的照旧高亮，不一致就不高亮任何一格
  const presetSame = !multi || picked.every((b) => b.preset === board.preset)
  const bgSame = !multi || picked.every((b) => (b.bg ?? null) === (board.bg ?? null))
  const allAuto = !multi ? !!board.auto : picked.every((b) => b.auto)
  // 只有「自由」没有页面比例可锁，才需要把长宽交给人手输
  const freePx = presetSame && board.preset === 'free'
  const wNow = Math.max(1, Math.round(board.w))
  const hNow = Math.max(1, Math.round(board.h))
  // 面板可能显示的是一块没被选中的画板（左栏列表里点开的那种），这时按它自己算
  const targets = picked.length ? picked : [board]

  /** 改画板尺寸：中心不动（和换比例时的「向外扩」同一套手感） */
  const resizeBoard = (b: { id: string; x: number; y: number; w: number; h: number }, w: number, h: number) => {
    updateBoard(b.id, { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h })
  }

  // 改宽 / 改高：多选时每块画板按自己的另一条边算，中心各自不动
  const setPx = (axis: 'w' | 'h', raw: string) => {
    setPxDraft({ w: axis === 'w' ? raw : String(wNow), h: axis === 'h' ? raw : String(hNow) })
    const n = Number(raw)
    if (!raw.trim() || !Number.isFinite(n) || n < MIN_BOARD_PX) return
    const v = Math.min(MAX_CANVAS_SIDE, Math.round(n))
    for (const b of targets) resizeBoard(b, axis === 'w' ? v : b.w, axis === 'h' ? v : b.h)
  }

  const swapPx = () => {
    for (const b of targets) resizeBoard(b, b.h, b.w)
    setPxDraft(null)
  }

  return (
    <>
      <Section
        title={multi ? '画板设置' : '画板设置'}
        desc={
          multi
            ? `已选 ${picked.length} 块画板：比例与底色会统一应用到它们，导出参数跟随第一块`
            : `${presetShortName(board.preset)} · ${Math.round(board.w)} × ${Math.round(board.h)} px（画布像素）`
        }
        right={
          <button
            className="mini-btn"
            title="选中全部画板（批量改比例 / 底色）"
            onClick={selectAllBoards}
          >
            全选
          </button>
        }
      >
        {!multi && (
          <div className="field">
            <div className="field-head">
              <label>名称</label>
              <span className="val">{board.auto ? '跟随内容' : '手动尺寸'}</span>
            </div>
            <input
              className="name-input"
              value={board.name}
              maxLength={30}
              spellCheck={false}
              aria-label="画板名称"
              onChange={(e) => renameBoard(board.id, e.target.value)}
              onBlur={(e) => {
                if (!e.target.value.trim()) renameBoard(board.id, `画板 ${artboards.indexOf(board) + 1}`)
              }}
            />
          </div>
        )}

        <div className="field">
          <div className="field-head">
            <label>画板比例</label>
            <span className="val">
              {presetSame ? presetShortName(board.preset) : '多个比例'}
            </span>
          </div>
          <div className="preset-grid">
            {PAGE_PRESETS.map((p) => (
              <button
                key={p.key}
                className={`btn preset-btn ${presetSame && board.preset === p.key ? 'active' : ''}`}
                title={multi ? `把选中的 ${picked.length} 块画板都改成 ${p.label}` : p.label}
                aria-label={p.label}
                onClick={() => setBoardPreset(p.key)}
              >
                <PageGlyph mmW={p.mmW} mmH={p.mmH} />
                <span className="preset-name">{p.name}</span>
              </button>
            ))}
          </div>
          {freePx && (
            <>
              <div className="row size-row" style={{ marginTop: 8 }}>
                <label className="size-cell" title={`画板宽度（画布像素）${multi ? '：会应用到选中的每块画板' : ''}`}>
                  <span>宽</span>
                  <input
                    type="number"
                    min={MIN_BOARD_PX}
                    max={MAX_CANVAS_SIDE}
                    step={1}
                    value={pxDraft?.w ?? String(wNow)}
                    aria-label="画板宽度（px）"
                    onChange={(e) => setPx('w', e.target.value)}
                    onBlur={() => setPxDraft(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </label>
                <span className="size-x">×</span>
                <label className="size-cell" title={`画板高度（画布像素）${multi ? '：会应用到选中的每块画板' : ''}`}>
                  <span>高</span>
                  <input
                    type="number"
                    min={MIN_BOARD_PX}
                    max={MAX_CANVAS_SIDE}
                    step={1}
                    value={pxDraft?.h ?? String(hNow)}
                    aria-label="画板高度（px）"
                    onChange={(e) => setPx('h', e.target.value)}
                    onBlur={() => setPxDraft(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur()
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="size-btn"
                  title="互换长宽（宽 ↔ 高，中心不动）"
                  aria-label="互换长宽"
                  onClick={swapPx}
                >
                  <Icon name="swap" size={13} />
                </button>
              </div>
              {!multi && (
                <div className="meta" style={{ marginTop: 6 }}>
                  自由比例没有固定长短边，这里填的就是画布像素（96 DPI 导出 1:1）；拖角也能改。
                </div>
              )}
            </>
          )}
        </div>

        <div className="field">
          <div className="field-head">
            <label>底色</label>
            <span className="val">{bgSame ? (board.bg ? board.bg.toUpperCase() : '透明') : '多个底色'}</span>
          </div>
          <div className="bg-row">
            <BgSwatch
              color={null}
              on={bgSame && !board.bg}
              title="透明（PNG / SVG 出图不带底）"
              onClick={() => setBoardBg(undefined)}
            />
            {BOARD_BG_SWATCHES.map((c) => (
              <BgSwatch
                key={c}
                color={c}
                on={bgSame && board.bg === c}
                title={c}
                onClick={() => setBoardBg(c)}
              />
            ))}
            <label className="bg-pick" title="自定义底色">
              <input
                type="color"
                value={board.bg ?? customBg}
                onChange={(e) => {
                  setCustomBg(e.target.value)
                  setBoardBg(e.target.value)
                }}
                aria-label="自定义画板底色"
              />
              <Icon name="plus" size={11} />
            </label>
          </div>
        </div>

        <div className="field">
          <div className="field-head">
            <label>自动画布</label>
            <span className="val">{allAuto ? '开' : '关'}</span>
          </div>
          <button
            className={`btn ghost-block ${allAuto ? 'active' : ''}`}
            title="打开后画板只跟着自己框住的渲染图走，图片变大自动向外扩；两块画板都开也不会互相吞内容"
            onClick={() => {
              // 一次切换全部选中画板：开着就全关；打开时顺便精确贴一次——
              // 平时是「只在内容越界时才扩」的保守规则，不会自己缩小，
              // 要是这块画板之前被全局内容撑大了，得靠这一次硬贴收回来
              if (allAuto) {
                for (const b of picked) updateBoard(b.id, { auto: false }, { keepAuto: true })
              } else {
                fitBoardsToContent()
              }
            }}
          >
            <Icon name="frame" size={13} />
            {allAuto ? '跟随内容（点此改为手动）' : '手动尺寸（点此跟随内容）'}
          </button>
          <div className="row" style={{ marginTop: 8 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              title="按当前内容重新贴合一次（会缩小，不只是扩大）"
              onClick={fitBoardsToContent}
            >
              贴合内容
            </button>
          </div>
          {!multi && (
            <div className="meta" style={{ marginTop: 6 }}>
              多块画板时只跟着落在这块板里的渲染图走：标注、形状、信息栏伸到板外也不算，两块板同开「跟随内容」也不会越贴越大、叠在一起。板里一张图都没有时才退回按全部内容算。拖动或缩放画板后会变成手动尺寸；想重新贴合，点上面「贴合内容」。
            </div>
          )}
        </div>

        {!multi && (
          <div className="row" style={{ marginBottom: 8 }}>
            <button className="btn" style={{ flex: 1 }} onClick={() => duplicateBoard(board.id)} title="复制一块同尺寸的画板">
              复制画板
            </button>
            <button
              className="btn"
              style={{ flex: 1 }}
              disabled={artboards.length <= 1}
              title={artboards.length <= 1 ? '至少保留一块画板' : '删除这块画板（内容不受影响）'}
              onClick={() => removeBoards([board.id])}
            >
              删除
            </button>
          </div>
        )}
        {multi && (
          <div className="row" style={{ marginBottom: 8 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              title="删除选中的画板（内容不受影响）"
              onClick={() => removeBoards(picked.map((b) => b.id))}
            >
              删除选中的 {picked.length} 块
            </button>
          </div>
        )}
      </Section>
    </>
  )
}
