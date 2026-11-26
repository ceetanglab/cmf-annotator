// 用 Konva.Text 本身来量文本高度：换行算法与实际渲染完全一致，避免估算误差
import Konva from 'konva'
import { FONT_STACK } from '../fonts'

let probe: Konva.Text | null = null
const cache = new Map<string, number>()
const cacheW = new Map<string, number>()
const CACHE_MAX = 400

function family(fontFamily?: string): string {
  return fontFamily || FONT_STACK
}

/**
 * 量出文本在给定宽度下（含自动换行 / 手动换行）的高度
 * @param width 文本可用宽度
 * @param lineHeight 行高倍数（渲染时保持一致）
 * @param fontFamily 字族：必须与渲染时一致，否则换行点会算错
 */
export function textHeight(
  text: string,
  width: number,
  fontSize: number,
  bold = false,
  lineHeight = 1,
  fontFamily?: string
): number {
  if (!text) return 0
  const fam = family(fontFamily)
  const w = Math.max(1, Math.round(width))
  const key = `${fam}|${fontSize}|${bold ? 1 : 0}|${lineHeight}|${w}|${text}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let h: number
  if (typeof document === 'undefined') {
    // 无 DOM 环境（如 Node 侧工具）退化为按字符估算
    const perLine = Math.max(1, Math.floor(w / fontSize))
    const lines = text.split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0)
    h = lines * fontSize * lineHeight
  } else {
    if (!probe) probe = new Konva.Text({ padding: 0, wrap: 'word' })
    probe.fontFamily(fam)
    probe.fontSize(fontSize)
    probe.fontStyle(bold ? 'bold' : 'normal')
    probe.lineHeight(lineHeight)
    probe.width(w)
    probe.text(text)
    h = probe.height()
  }

  if (cache.size > CACHE_MAX) cache.clear()
  cache.set(key, h)
  return h
}

/**
 * 取出文本在给定宽度下的**实际每一行**（含换行点、含省略号），
 * 供 SVG 导出复用同一套排版结果——不能自己写换行算法，否则行数与画布对不上，文字会溢出文本框。
 * @param wrap 'word' 自动换行 / 'none' 单行
 * @param ellipsis wrap='none' 时是否按宽度截断加省略号（与画布 Text 的 ellipsis 一致）
 */
export function textLines(
  text: string,
  width: number,
  fontSize: number,
  bold = false,
  lineHeight = 1,
  fontFamily?: string,
  wrap: 'word' | 'none' = 'word',
  ellipsis = false
): string[] {
  if (!text) return []
  const fam = family(fontFamily)
  if (typeof document === 'undefined') return text.split('\n')

  if (!probe) probe = new Konva.Text({ padding: 0, wrap: 'word' })
  probe.fontFamily(fam)
  probe.fontSize(fontSize)
  probe.fontStyle(bold ? 'bold' : 'normal')
  probe.lineHeight(lineHeight)
  probe.wrap(wrap)
  probe.ellipsis(ellipsis)
  probe.width(Math.max(1, Math.round(width)))
  probe.text(text)
  // Konva 把排版结果放在 textArr 里（每项一行）；这是画布真正画出来的行，最可靠
  const arr = (probe as unknown as { textArr?: { text: string }[] }).textArr
  return arr && arr.length ? arr.map((l) => l.text) : [text]
}

const cacheM = new Map<string, { asc: number; desc: number }>()

/**
 * 字体度量：用于把「以行框中线对齐」的画布文字换算成 SVG 的字母基线。
 * canvas 的 textBaseline='middle' 是 (ascent-descent)/2 高于基线的位置，
 * Konva 也是这么画的，所以同一套度量能保证 SVG 里每行落在同一像素上。
 */
export function fontMetrics(
  fontSize: number,
  bold = false,
  fontFamily?: string
): { asc: number; desc: number } {
  const fam = family(fontFamily)
  const key = `${fam}|${fontSize}|${bold ? 1 : 0}`
  const hit = cacheM.get(key)
  if (hit) return hit
  let asc = fontSize * 0.88
  let desc = fontSize * 0.12
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d')
    if (ctx) {
      ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${fam}`
      const m = ctx.measureText('M')
      if (Number.isFinite(m.fontBoundingBoxAscent)) asc = m.fontBoundingBoxAscent
      if (Number.isFinite(m.fontBoundingBoxDescent)) desc = m.fontBoundingBoxDescent
    }
  }
  if (cacheM.size > CACHE_MAX) cacheM.clear()
  cacheM.set(key, { asc, desc })
  return { asc, desc }
}

/**
 * 量出文本单行不换行时的宽度（用于「类目名 + 内容」同行排版：缩进量 = 类目名的实际宽度）
 * 走 2D context 的 measureText，与浏览器实际排版同一套字宽数据
 */
export function textWidth(text: string, fontSize: number, bold = false, fontFamily?: string): number {
  if (!text) return 0
  const fam = family(fontFamily)
  const key = `${fam}|${fontSize}|${bold ? 1 : 0}|${text}`
  const hit = cacheW.get(key)
  if (hit !== undefined) return hit
  if (typeof document === 'undefined') return text.length * fontSize

  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return text.length * fontSize
  ctx.font = `${bold ? 'bold ' : ''}${fontSize}px ${fam}`
  const w = ctx.measureText(text).width

  if (cacheW.size > CACHE_MAX) cacheW.clear()
  cacheW.set(key, w)
  return w
}
