// 分层 SVG 导出：把「渲染图 / 每条标注 / 项目信息栏 / 水印」分别装进带 id 的 <g>，
// 拖进 Illustrator 后能逐个选中、单独拖动，而且文字是真的 text（不是位图）。
//
// 坐标系：全部用画布的 content 坐标输出，页面通过 viewBox 指定要取哪一块，
// width/height 用 pt 表达成品物理尺寸 —— 于是「A4@150DPI」和「原分辨率」两种模式
// 走的是同一套代码，只是 viewBox 与 pt 尺寸不同。
import type {
  CMFAnnotation,
  ExportRect,
  ImageItem,
  LogoMeta,
  ProjectInfo,
  ShapeItem,
  WatermarkMeta
} from '../types'
import {
  ANCHOR_R,
  INFO_FONT,
  INFO_GAP,
  INFO_LABEL_FONT,
  INFO_PAD_X,
  INFO_RULE_H,
  INFO_TITLE_FONT,
  INFO_VALUE_DY,
  INFO_VALUE_INDENT,
  INFO_W,
  LABEL_LABEL_FONT,
  LABEL_PAD,
  LABEL_TITLE_FONT,
  LABEL_VALUE_FONT,
  LABEL_W,
  LINE_W,
  RED,
  arrowHead,
  bounds,
  infoLayout,
  labelLayout,
  leaderPoints,
  logoSize
} from '../layout'
import { FONT_STACK, WEIGHT_BOLD } from '../fonts'
import { fontMetrics, textLines, textWidth } from './textMeasure'
import { SHAPE_DEFAULT_FONT, SHAPE_DEFAULT_STROKE, TEXT_LINE_HEIGHT, shapePointsAbs } from './shapes'
import { clampWmSize, watermarkGap } from './watermark'

export interface SvgExportOpts {
  rect: ExportRect // 导出区域（content 坐标）
  title: string // 成品名（导出文件名去掉扩展名），写进 <title>，AI 里显示为文档名
  pageW: number // 成品像素宽（决定 pt 尺寸）
  pageH: number
  fit: number // 内容 → 成品像素 的缩放
  offX: number // 内容在成品页里的居中偏移（像素）
  offY: number
  ptW: number // 成品物理宽（pt）
  ptH: number
  /** 画板底色：缺省 #ffffff；传 null = 透明画板（不画纸面填充） */
  pageBg?: string | null
  images: ImageItem[]
  annotations: CMFAnnotation[]
  /** 老工程 / 老调用点没有形状：不传就当作没有 */
  shapes?: ShapeItem[]
  info: ProjectInfo
  infoPos: { x: number; y: number } | null
  infoScale: number
  infoVisible: boolean
  infoRule: boolean
  logo: LogoMeta | null
  watermark: WatermarkMeta
}

// 字体栈里的双引号换成单引号：SVG 属性用双引号包裹，避免转义满天飞
const FAMILY = FONT_STACK.replace(/"/g, "'")

const n = (v: number) => (Math.round(v * 100) / 100).toString()

/**
 * 顶层分组 → 真正的「图层」：
 * - Inkscape 认 inkscape:groupmode="layer" + label；
 * - Illustrator 认 id / <title>（不同版本略有差异，所以两头都写）。
 * 这样拖进 AI / Inkscape 都是 4 个可独立选中拖动的图层，而不是一坨 group。
 */
function layer(id: string, name: string): string {
  return (
    `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${esc(name)}"` +
    ` data-name="${esc(name)}"><title>${esc(name)}</title>`
  )
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 一段文字（可能多行）→ 一个 <text>，每行一个 <tspan>；基线按画布的「行框中线」换算 */
function textBlock(o: {
  x: number
  y: number
  text: string
  size: number
  bold?: boolean
  width: number
  wrap?: 'word' | 'none'
  ellipsis?: boolean
  fill: string
  family?: string
  lh?: number
  opacity?: number
}): string {
  const lh = o.lh ?? 1
  const lines = textLines(o.text, o.width, o.size, o.bold, lh, o.family, o.wrap ?? 'word', o.ellipsis ?? false)
  if (!lines.length) return ''
  const { asc, desc } = fontMetrics(o.size, o.bold, o.family)
  const lhPx = o.size * lh
  const spans = lines
    .map((ln, i) => {
      const baseY = o.y + lhPx / 2 + i * lhPx + (asc - desc) / 2
      return `<tspan x="${n(o.x)}" y="${n(baseY)}">${esc(ln)}</tspan>`
    })
    .join('')
  // 字族写在根 <svg> 上统一继承，这里只在要换字体（水印 Arial）时才写一次
  return (
    `<text${o.family ? ` font-family="${o.family}"` : ''} font-size="${n(o.size)}"` +
    `${o.bold ? ' font-weight="700"' : ''} fill="${o.fill}"` +
    `${o.opacity !== undefined ? ` opacity="${o.opacity}"` : ''} xml:space="preserve">${spans}</text>`
  )
}

function imageEl(
  href: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra = ''
): string {
  return (
    `<image x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"` +
    ` preserveAspectRatio="none" xlink:href="${href}"${extra}/>`
  )
}

/** 标注引线：折线 + 箭头三角（几何与画布上的 Konva Arrow 完全一致） */
function leaderEl(a: CMFAnnotation, color: string): string {
  const pts = leaderPoints(a)
  const lw = a.lineWidth ?? LINE_W
  const asz = a.anchorSize ?? ANCHOR_R

  // 引线本身（Konva 是画到端点全长，箭头三角压在上面）
  const line = `<polyline points="${pts
    .reduce<string[]>((acc, v, i) => {
      if (i % 2 === 0) acc.push(`${n(v)},${n(pts[i + 1])}`)
      return acc
    }, [])
    .join(' ')}" fill="none" stroke="${color}" stroke-width="${n(lw)}" stroke-linejoin="round" stroke-linecap="round"/>`

  if (a.endStyle !== 'arrow') return line

  // 三角：以最后一段的方向旋转 (-L, ±W/2)
  const m = pts.length
  const dx = pts[m - 2] - pts[m - 4]
  const dy = pts[m - 1] - pts[m - 3]
  const rad = Math.atan2(dy, dx)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const head = arrowHead(lw, asz)
  const L = head.pointerLength
  const W = head.pointerWidth
  const tipX = pts[m - 2]
  const tipY = pts[m - 1]
  const rot = (px: number, py: number) =>
    `${n(tipX + px * cos - py * sin)},${n(tipY + px * sin + py * cos)}`
  const tri = `${n(tipX)},${n(tipY)} ${rot(-L, W / 2)} ${rot(-L, -W / 2)}`
  return (
    line +
    `<polygon points="${tri}" fill="${color}" stroke="${color}" stroke-width="${n(lw * 0.6)}" stroke-linejoin="round"/>`
  )
}

/** 一个标注：引线 + 文本框（外框 / 标题 / 每行类目与内容） + 锚点 */
/** 形状标注：与画布同一套包围盒 / 归一化折点，SVG 里保持可编辑的矢量元素 */
function shapeEl(sh: ShapeItem): string {
  const sw = Math.max(0.5, sh.strokeWidth ?? SHAPE_DEFAULT_STROKE)
  const op = sh.opacity ?? 1
  const alpha = ` opacity="${n(op)}"`
  if (sh.kind === 'text') {
    return (
      `<g${alpha}>` +
      textBlock({
        x: sh.x,
        y: sh.y,
        text: sh.text ?? '',
        size: sh.fontSize ?? SHAPE_DEFAULT_FONT,
        width: sh.w,
        fill: sh.color,
        lh: TEXT_LINE_HEIGHT
      }) +
      `</g>`
    )
  }
  if (sh.kind === 'line' || sh.kind === 'polyline') {
    const pts = shapePointsAbs(sh)
      .map((p) => `${n(p.x)},${n(p.y)}`)
      .join(' ')
    return (
      `<polyline points="${pts}" fill="none" stroke="${sh.color}" stroke-width="${n(sw)}"` +
      ` stroke-linecap="round" stroke-linejoin="round"${alpha}/>`
    )
  }
  const fill = sh.fill ?? 'none'
  if (sh.kind === 'circle') {
    return (
      `<ellipse cx="${n(sh.x + sh.w / 2)}" cy="${n(sh.y + sh.h / 2)}"` +
      ` rx="${n(sh.w / 2)}" ry="${n(sh.h / 2)}" fill="${fill}"` +
      ` stroke="${sh.color}" stroke-width="${n(sw)}"${alpha}/>`
    )
  }
  return (
    `<rect x="${n(sh.x)}" y="${n(sh.y)}" width="${n(sh.w)}" height="${n(sh.h)}"` +
    ` fill="${fill}" stroke="${sh.color}" stroke-width="${n(sw)}"${alpha}/>`
  )
}

function annotationEl(a: CMFAnnotation): string {
  const lay = labelLayout(a)
  const sc = a.scale ?? 1
  const lw = a.lineWidth ?? LINE_W
  const asz = a.anchorSize ?? ANCHOR_R
  const color = a.lineColor ?? RED

  const name = (a.cmf.name || '').trim() || '未命名部件'
  const parts: string[] = [leaderEl(a, color)]

  // 文本框：整体缩放在组变换上，内部一律用未缩放坐标（与画布一致）
  const inner: string[] = []
  inner.push(
    `<rect x="0" y="0" width="${n(LABEL_W)}" height="${n(lay.height)}" rx="10" ry="10"` +
      ` fill="none" stroke="#1f2329" stroke-width="2"/>`
  )
  if (lay.showTitle) {
    inner.push(
      textBlock({
        x: LABEL_PAD,
        y: LABEL_PAD,
        text: lay.title,
        size: LABEL_TITLE_FONT,
        width: LABEL_W - LABEL_PAD * 2,
        fill: '#1f2329'
      })
    )
  }
  for (const r of lay.rows) {
    inner.push(
      textBlock({
        x: LABEL_PAD,
        y: r.nameY,
        text: r.label,
        size: LABEL_LABEL_FONT,
        bold: true,
        width: LABEL_W - LABEL_PAD * 2,
        wrap: r.stacked ? 'word' : 'none',
        fill: '#1f2329'
      })
    )
    if (r.value) {
      inner.push(
        textBlock({
          x: r.valueX,
          y: r.valueY,
          text: r.value,
          size: LABEL_VALUE_FONT,
          bold: true,
          width: r.valueW,
          fill: r.isPlaceholder ? '#aab2bf' : r.accent ? RED : '#5b6270'
        })
      )
    }
  }
  parts.push(
    `<g transform="translate(${n(a.label.x)} ${n(a.label.y)}) scale(${n(sc)})">${inner.join('')}</g>`
  )

  if (a.endStyle === 'arrow') {
    // 箭头端点在画布上是「不可见的拖拽热区」，成品里什么都不画（三角已由引线那一步画出）
    return (
      `<g id="ann-${esc(a.id)}" data-name="${esc(name)}"><title>${esc(name)}</title>` +
      parts.join('') +
      `</g>`
    )
  }

  parts.push(
    `<circle cx="${n(a.anchor.x)}" cy="${n(a.anchor.y)}" r="${n(asz)}" fill="${color}"/>`
  )

  return (
    `<g id="ann-${esc(a.id)}" data-name="${esc(name)}"><title>${esc(name)}</title>` +
    parts.join('') +
    `</g>`
  )
}

/** 项目信息栏：标题 / 横线 / 品牌标识 / 各栏目（透明底，与画布一致） */
function infoEl(o: SvgExportOpts): string {
  if (!o.images.length || !o.infoVisible) return ''
  const fields = o.info.fields
  const title = fields[0]?.value || ''
  const logoSz = logoSize(o.logo)
  const lay = infoLayout(fields, logoSz, o.logo?.place ?? 'top')

  const inner: string[] = []
  if (lay.logoBox && o.logo?.dataUrl) {
    inner.push(
      imageEl(o.logo.dataUrl, lay.logoBox.x, lay.logoBox.y, lay.logoBox.w, lay.logoBox.h)
    )
  }
  if (lay.showTitle && title) {
    inner.push(
      textBlock({
        x: INFO_PAD_X,
        y: lay.titleY,
        text: title,
        size: INFO_TITLE_FONT,
        bold: true,
        width: INFO_W - INFO_PAD_X * 2,
        wrap: 'none',
        ellipsis: true,
        fill: '#1f2329'
      })
    )
  }
  if (o.infoRule && (lay.ruleAnchor === 'logo' || lay.showTitle)) {
    inner.push(
      `<line x1="${n(INFO_PAD_X)}" y1="${n(lay.ruleY)}" x2="${n(INFO_W - INFO_PAD_X)}" y2="${n(lay.ruleY)}"` +
        ` stroke="#1f2329" stroke-width="${n(INFO_RULE_H)}"/>`
    )
  }
  for (const { field: fl, y } of lay.rows) {
    inner.push(
      textBlock({
        x: INFO_PAD_X,
        y,
        text: fl.label,
        size: INFO_LABEL_FONT,
        bold: true,
        width: INFO_W - INFO_PAD_X * 2,
        wrap: 'none',
        ellipsis: true,
        fill: '#1f2329'
      })
    )
    if (fl.value) {
      inner.push(
        textBlock({
          x: INFO_PAD_X + INFO_VALUE_INDENT,
          y: y + INFO_VALUE_DY,
          text: fl.value,
          size: INFO_FONT,
          width: INFO_W - INFO_PAD_X * 2 - INFO_VALUE_INDENT,
          wrap: 'none',
          ellipsis: true,
          fill: fl.label.includes('特别说明') ? RED : '#343b47'
        })
      )
    }
  }

  // 没手动拖过信息栏时，默认贴在渲染图右侧（与画布同一个公式）
  const { maxR } = bounds(o.images)
  const x = o.infoPos?.x ?? maxR + INFO_GAP
  const y = o.infoPos?.y ?? 0
  return (
    layer('info-bar', '项目信息栏') +
    `<g transform="translate(${n(x)} ${n(y)}) scale(${n(o.infoScale)})">${inner.join('')}</g>` +
    `</g>`
  )
}

/** 水印：单个 = 一段文字；平铺 = 一个 pattern + 一块矩形（节点数恒定，和画布一样） */
function watermarkEl(o: SvgExportOpts): { defs: string; body: string } {
  const wm = o.watermark
  const txt = (wm.text || '').trim()
  if (!wm.on || !txt) return { defs: '', body: '' }
  const size = clampWmSize(wm.size)
  const op = wm.opacity

  if (wm.mode === 'single') {
    const tw = textWidth(txt, size, false, 'Arial')
    const x = wm.x ?? o.rect.x + (o.rect.w - tw) / 2
    const y = wm.y ?? o.rect.y + (o.rect.h - size) / 2
    const body =
      layer('watermark', '水印') +
      textBlock({
        x,
        y,
        text: txt,
        size,
        width: tw + 2,
        wrap: 'none',
        fill: '#1f2329',
        family: "'Arial', sans-serif",
        opacity: op
      }) +
      `</g>`
    return { defs: '', body }
  }

  // 平铺：单元尺寸与画布上的离屏 canvas 保持一致（cellH / cellW 同一公式）
  const gap = watermarkGap(size, wm.density)
  const cellH = Math.ceil(size * 1.35 + gap * 0.6)
  const cellW = Math.ceil(textWidth(txt, size, false, 'Arial') + gap)
  const { asc, desc } = fontMetrics(size, false, 'Arial')
  const baseY = cellH / 2 + (asc - desc) / 2
  const defs =
    `<pattern id="wm-tile" patternUnits="userSpaceOnUse" x="${n(o.rect.x)}" y="${n(o.rect.y)}"` +
    ` width="${n(cellW)}" height="${n(cellH)}">` +
    `<text x="${n(gap / 2)}" y="${n(baseY)}" font-family="'Arial', sans-serif" font-size="${n(size)}" fill="#1f2329">${esc(txt)}</text>` +
    `</pattern>`
  const body =
    layer('watermark', '水印') +
    `<rect x="${n(o.rect.x)}" y="${n(o.rect.y)}" width="${n(o.rect.w)}" height="${n(o.rect.h)}" fill="url(#wm-tile)" opacity="${op}"/>` +
    `</g>`
  return { defs, body }
}

export function buildLayeredSvg(o: SvgExportOpts): string {
  // 页面在 content 坐标里的可见范围：内容按 fit 缩放并居中，反推回去就是 viewBox
  const vx = o.rect.x - o.offX / o.fit
  const vy = o.rect.y - o.offY / o.fit
  const vw = o.pageW / o.fit
  const vh = o.pageH / o.fit

  // 内容按图层顺序（z 由小到大）输出：图片与标注共用一套序号，
  // 连续的同类合进同一层。默认情况（图在下、标注在上）仍旧是「渲染图 / 标注」两层；
  // 只有用户真的把某张图压到标注之上时，才会多分几层来保证前后关系。
  const items = [
    ...o.images
      .filter((im) => !im.hidden)
      .map((im) => ({ kind: 'image' as const, z: im.z ?? 0, html: imageEl(im.dataUrl, im.x, im.y, im.w, im.h) })),
    ...o.annotations
      .filter((a) => !a.hidden)
      .map((a) => ({ kind: 'ann' as const, z: a.z ?? 0, html: annotationEl(a) })),
    ...(o.shapes ?? [])
      .filter((sh) => !sh.hidden)
      .map((sh) => ({ kind: 'shape' as const, z: sh.z ?? 0, html: shapeEl(sh) }))
  ].sort((x, y) => x.z - y.z)

  const runs: { kind: 'image' | 'ann' | 'shape'; html: string }[] = []
  for (const it of items) {
    const last = runs[runs.length - 1]
    if (last && last.kind === it.kind) last.html += it.html
    else runs.push({ kind: it.kind, html: it.html })
  }
  const kindCount = { image: 0, ann: 0, shape: 0 }
  const totalKind = {
    image: runs.filter((r) => r.kind === 'image').length,
    ann: runs.filter((r) => r.kind === 'ann').length,
    shape: runs.filter((r) => r.kind === 'shape').length
  }
  const content = runs
    .map((r) => {
      kindCount[r.kind] += 1
      const base = r.kind === 'image' ? '渲染图' : r.kind === 'shape' ? '形状标注' : '标注'
      const name = totalKind[r.kind] > 1 ? `${base} ${kindCount[r.kind]}` : base
      // 保持老 id：只有一层的类型沿用 render / annotations，下游引用不断
      const singleId = r.kind === 'image' ? 'render' : r.kind === 'shape' ? 'shapes' : 'annotations'
      const id = totalKind[r.kind] > 1 ? `${r.kind}-layer-${kindCount[r.kind]}` : singleId
      return layer(id, name) + r.html + `</g>\n`
    })
    .join('')

  const wm = watermarkEl(o)

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1"` +
    ` width="${n(o.ptW)}pt" height="${n(o.ptH)}pt" viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}"` +
    ` font-family="${FAMILY}">\n` +
    `<title>${esc(o.title)}</title>\n` +
    `<desc>分层可编辑：渲染图、CMF 标注与形状标注按图层顺序成组，项目信息栏 / 水印各自独立，可在 Illustrator 中单独选中拖动</desc>\n` +
    (wm.defs ? `<defs>${wm.defs}</defs>\n` : '') +
    // 纸面：画板底色。传 null = 透明画板，这一层留空（图层仍在，AI 里能单独加底）；
    // 不传时按老行为给白底
    (o.pageBg === null
      ? layer('paper', '纸面') + '</g>\n'
      : layer('paper', '纸面') +
        `<rect x="${n(vx)}" y="${n(vy)}" width="${n(vw)}" height="${n(vh)}" fill="${o.pageBg ?? '#ffffff'}"/></g>\n`) +
    content +
    infoEl(o) +
    `\n` +
    wm.body +
    `\n</svg>\n`
  )
}
