// 画布布局常量（画布 content 坐标 / 像素）
import type { CMFAnnotation, ImageItem, InfoField, LogoMeta } from './types'
import { textHeight, textWidth } from './lib/textMeasure'
import { cmfRows } from './lib/cmfRows'
import { pantoneLabel } from './lib/pantone'

// ---- 标注框：透明底，无分隔线
//      字号按软件里的参数取比例：部件名称 6.8（regular）、类目名与内容 4.7（bold），
//      三者的相对大小与软件里一致
//      版式：类目名与内容排在同一行，内容超宽自动换行，续行缩进对齐到类目名之后（悬挂缩进）
//      LABEL_ZOOM 是整块的设计倍率：只改这一个数，宽度 / 字号 / 间距全部等比跟着走
export const LABEL_ZOOM = 1.5       // 整块尺寸倍率（用户要求放大 1.5 倍）
const L = LABEL_ZOOM

// 标注文本块宽度（600 → 420，按用户要求再收 30%：900 → 630）。
// 收窄后内宽 = 630 - 96 = 534，字号不变，内容更容易换行——正是想要的效果：
// 标注块更像一个「卡片」，不再横向霸占画面
export const LABEL_W = 420 * L          // 标注文本块宽度（900 → 630）
export const LABEL_PAD = 32 * L         // 内边距（文字到边框的距离，四边一致）
export const LABEL_TITLE_FONT = 30 * L  // 标题字号（regular）
// 标题下方原本有一条 5px 粗线（用户要求去掉）。线去掉后原来的 41px 空带比标题本身还高，
// 这里收紧成 26px：既不留一条「幽灵横线」的空档，也不再看出缺了点什么
export const LABEL_TITLE_GAP = 8 * L    // 标题底部到标题区结束
export const LABEL_BODY_GAP = 18 * L    // 标题区结束到第一个栏目
export const LABEL_LABEL_FONT = 21 * L  // 类目名字号（bold）
export const LABEL_VALUE_FONT = 21 * L  // 内容字号（bold，与类目名同大小同字重才能同行对齐）
export const LABEL_NAME_GAP = 8 * L     // 类目名与内容之间的空隙
export const LABEL_ROW_GAP = 18 * L     // 一行底部到下一个类目名
// 类目名太宽（占掉内宽这个比例）时，内容另起一行顶格排，否则内容会被挤成一条细缝
export const LABEL_NAME_MAX_RATIO = 0.42

export interface LabelRow {
  key: string
  label: string
  value: string
  accent?: boolean // 强调色（色值）
  isPlaceholder?: boolean // 值只是占位斜杠 `/`，画布上用浅灰字
}

// 标注框里展示的栏目：按行数据的顺序渲染，隐藏的行跳过；
// 空值默认画一个占位斜杠 `/`，用户在文本框里把它删掉（slash=false）就是真空白
export function labelRowsOf(cmf: CMFAnnotation['cmf']): LabelRow[] {
  return cmfRows(cmf)
    .filter((r) => !r.hidden)
    .map((r) => {
      const raw = r.value || ''
      const filled = !!raw.trim()
      // 颜色行在画布上也写成「Pantone 413 C」，跟右栏颜色框一致；
      // 存的仍是裸色号，前缀只在这一层加，画布 / 导出 SVG 共用这份文案
      const shown = filled && r.key === 'color' ? pantoneLabel(raw) : raw
      return {
        key: r.key,
        label: r.label,
        value: filled ? shown : r.slash === false ? '' : '/',
        accent: r.key === 'color' && filled,
        isPlaceholder: !filled && r.slash !== false
      }
    })
}

export interface LabelLayout {
  title: string
  showTitle: boolean // 名称行被删除/隐藏时整块标题不画
  titleH: number
  height: number
  rows: {
    key: string
    label: string
    nameY: number // 类目名 y（与内容同一行时就是行顶）
    valueY: number // 内容 y：同一行时 = nameY，内容顶格时 = 类目名下方
    value: string
    valueX: number // 内容 x：即「按类目名长度缩进」的缩进量
    valueW: number // 内容可用宽度
    stacked: boolean // 类目名过长，内容被迫另起一行
    accent?: boolean
    isPlaceholder?: boolean
  }[]
}

// 标注框版式：按内容实际换行行数算高度（渲染与包围盒共用）
export function labelLayout(a: CMFAnnotation): LabelLayout {
  const inner = LABEL_W - LABEL_PAD * 2
  const showTitle = !a.cmf.noName && !a.cmf.nameHidden
  const title = showTitle ? (a.cmf.name || '').trim() || '未命名部件' : ''
  const titleH = showTitle ? textHeight(title, inner, LABEL_TITLE_FONT, false) : 0
  const bodyTop = LABEL_PAD + titleH + LABEL_TITLE_GAP

  let y = showTitle ? bodyTop + LABEL_BODY_GAP : LABEL_PAD
  const rows: LabelLayout['rows'] = []
  for (const r of labelRowsOf(a.cmf)) {
    const nameY = y
    // 缩进量 = 类目名的实际渲染宽度（不是字符数），中英文混排也能对齐
    const nameW = textWidth(r.label, LABEL_LABEL_FONT, true)
    const stacked = nameW > inner * LABEL_NAME_MAX_RATIO
    const nameH = Math.max(
      textHeight(r.label, stacked ? inner : Math.max(nameW + 2, 1), LABEL_LABEL_FONT, true),
      LABEL_LABEL_FONT
    )
    const valueX = stacked ? LABEL_PAD : LABEL_PAD + nameW + LABEL_NAME_GAP
    const valueY = stacked ? nameY + nameH + LABEL_NAME_GAP : nameY
    const valueW = Math.max(40, LABEL_W - LABEL_PAD - valueX)
    // 内容为空（把占位斜杠也删掉）时也要占满一行的高度，否则删斜杠会让行距突然变紧
    const valueH = Math.max(textHeight(r.value, valueW, LABEL_VALUE_FONT, true), LABEL_VALUE_FONT)
    const rowH = stacked ? valueY + valueH - nameY : Math.max(nameH, valueH)
    y = nameY + rowH + LABEL_ROW_GAP
    rows.push({
      key: r.key,
      label: r.label,
      nameY,
      valueY,
      value: r.value,
      valueX,
      valueW,
      stacked,
      accent: r.accent,
      isPlaceholder: r.isPlaceholder
    })
  }

  const bottom = rows.length ? y - LABEL_ROW_GAP : showTitle ? bodyTop : LABEL_PAD
  return { title, showTitle, titleH, height: bottom + LABEL_PAD, rows }
}

export const labelBoxHeight = (a: CMFAnnotation): number => labelLayout(a).height

/**
 * 引线折线点：从标注框侧边中点折一段出来，再连到锚点。
 * 画布渲染与 SVG 导出共用这一份几何，两条路径才不会错位。
 */
export function leaderPoints(a: CMFAnnotation): number[] {
  const sc = a.scale ?? 1
  const boxW = LABEL_W * sc // 实际渲染宽度（含缩放）
  const boxH = labelBoxHeight(a) * sc
  const left = a.label.x
  const right = left + boxW
  const top = a.label.y
  const cx = left + boxW / 2
  const midY = top + boxH / 2 // 从矩形侧边「中间」引出
  const ax = a.anchor.x
  const ay = a.anchor.y

  // 锚点在框中心左侧 → 从左边缘中间引出，否则从右边缘中间引出
  const fromLeft = ax < cx
  const edgeX = fromLeft ? left : right
  const dir = fromLeft ? -1 : 1
  const elbowX = edgeX + dir * Math.min(40, Math.abs(ax - edgeX))
  return [edgeX, midY, elbowX, midY, ax, ay]
}

// 标注引线与锚点默认尺寸（框放大后同步加粗，保持整体比例）
export const LINE_W = 6
export const ANCHOR_R = 20

// 箭头端点的尺寸：以「锚点大小」为基准等比缩放（同一个滑块既能调圆点也能调箭头），
// 线宽特别粗时兜底放大，避免箭头被线身压住
export const arrowHead = (lineWidth: number, anchorSize = ANCHOR_R) => {
  const base = Math.max(anchorSize, lineWidth * 2.2)
  return {
    pointerLength: Math.max(8, base * 0.9),
    pointerWidth: Math.max(6, base * 0.72)
  }
}

// ---- 项目信息栏：竖版图纸信息栏版式（大标题 + 标题下横线，栏目名在上、数值在下）
//      透明底：只保留标题下那条横线，各栏目之间不画分隔线
export const INFO_W = 312           // 信息栏宽度
export const INFO_GAP = 56          // 渲染图与信息栏间距
export const INFO_PAD = 22          // 上下内边距（文字到边框的距离）
export const INFO_PAD_X = 33        // 左右内边距（比上下宽 50%，图纸信息栏的常规比例）
// 字号按软件里的参数取比例：公司名称 12 / 类目名称 6.2 / 信息内容 9.2
// 画布整体乘 1.42 换算（12 → 17，延续原来选定的标题大小）。
// 注意层级关系变了：公司名称 > 信息内容 > 类目名称——内容比标题小是图纸的常规层级，
// 之前「内容 = 标题两倍」是把数值当主角，和软件里的比例正好相反
export const INFO_TITLE_FONT = 17   // = 12 × 1.42（bold）
export const INFO_LABEL_FONT = 8.8  // = 6.2 × 1.42（bold）
export const INFO_FONT = 13         // = 9.2 × 1.42（regular）
export const INFO_RULE_H = 2        // 标题下横线粗细
export const INFO_TITLE_RULE_Y = INFO_PAD + 31   // 标题下横线的 y（相对卡片顶部，横线在标题下方时用）
export const INFO_LOGO_RULE_GAP = 12   // 公司标识 → 横线 的间距（横线画在标识下方时用）
export const INFO_RULE_TITLE_GAP = 16  // 横线 → 标题 的间距
export const INFO_TITLE_H = 64      // 标题区高度（标题 + 横线 + 间距）
export const INFO_ROW_H = 47        // 每个栏目的行距（类目名到内容的间隔变大后同步加高）
export const INFO_VALUE_DY = 21     // 数值相对栏目名的下移量（原 14，加多 50%）
export const INFO_VALUE_INDENT = 60 // 数值相对栏目名的右缩进

export interface InfoRow {
  field: InfoField
  y: number        // 栏目名的 y（卡片内坐标）
}

export interface LogoBox {
  x: number
  y: number
  w: number
  h: number
}

export interface InfoLayout {
  rows: InfoRow[]
  height: number
  showTitle: boolean      // 首行（标题）是否显示
  titleY: number          // 标题文字 / 粗线相对卡片顶部的基准（有 logo 时整体下移）
  ruleY: number
  ruleAnchor: 'logo' | 'title' // 横线归属：置顶的公司标识下方 / 标题下方
  logoBox: LogoBox | null // 品牌标识的显示框（null = 无 logo）
}

// 品牌标识在信息栏里的实际显示尺寸：按内宽的比例取宽，再按原图比例算高（限高避免超长 logo 撑爆卡片）
export const INFO_LOGO_GAP = 14     // logo 与标题之间
export const INFO_LOGO_BOTTOM_GAP = 18 // 置底时 logo 与最后一行之间
export const INFO_LOGO_MAX_H = 150
export const INFO_ROW_CONTENT_H = 34 // 一行内容（栏目名 + 数值）的实际高度，行距的余量不算进去
export function logoSize(logo?: LogoMeta | null): { w: number; h: number } | null {
  if (!logo?.dataUrl || !logo.w || !logo.h) return null
  const inner = INFO_W - INFO_PAD_X * 2
  const ratio = Math.min(1, Math.max(0.15, logo.ratio ?? 0.6))
  let w = inner * ratio
  let h = w * (logo.h / logo.w)
  // 超高的图（竖版 logo）限制高度，宽度等比回收，避免变形成一条缝
  if (h > INFO_LOGO_MAX_H) {
    h = INFO_LOGO_MAX_H
    w = h * (logo.w / logo.h)
  }
  return { w, h }
}

// 信息栏版式：返回每行的位置与实际高度（渲染与包围盒共用，保证一致）
// 隐藏的行不占位；标题行隐藏时整个标题块（含粗线）一起收掉
// logo 可置顶（标题上方，默认）或置底（最后一行下方）
export function infoLayout(
  fields: InfoField[],
  logo?: { w: number; h: number } | null,
  place: 'top' | 'bottom' = 'top'
): InfoLayout {
  const title = fields[0]
  const showTitle = !!title && !title.hidden
  const rows: InfoRow[] = []
  const hasLogo = !!(logo && logo.w > 0 && logo.h > 0)
  let y = INFO_PAD
  let logoBox: LogoBox | null = null
  if (hasLogo && place === 'top') {
    logoBox = { x: (INFO_W - logo!.w) / 2, y, w: logo!.w, h: logo!.h }
    y += logo!.h + INFO_LOGO_GAP
  }
  // 横线的归属：品牌标识置顶时，横线画在标识下方——它就成了「公司」这一块的下边界
  //（标识 → 横线 → 标题 → 栏目）；没有置顶标识时仍画在标题下方
  const ruleAnchor: 'logo' | 'title' = hasLogo && place === 'top' ? 'logo' : 'title'
  let titleY: number
  let ruleY: number
  if (ruleAnchor === 'logo') {
    ruleY = logoBox!.y + logoBox!.h + INFO_LOGO_RULE_GAP
    titleY = ruleY + INFO_RULE_TITLE_GAP
  } else {
    titleY = y
    ruleY = titleY + (INFO_TITLE_RULE_Y - INFO_PAD)
  }
  if (showTitle) y = titleY + INFO_TITLE_H
  else if (ruleAnchor === 'logo') y = ruleY + INFO_RULE_TITLE_GAP // 没有标题时也别让横线压住第一个栏目
  for (const f of fields.slice(1)) {
    if (f.hidden) continue
    rows.push({ field: f, y })
    y += INFO_ROW_H
  }
  if (hasLogo && place === 'bottom') {
    // 最后一行之后：行距（INFO_ROW_H）比内容高，按内容底再留一个间距放 logo
    const contentBottom = rows.length
      ? y - INFO_ROW_H + INFO_ROW_CONTENT_H
      : showTitle
        ? ruleY + 24
        : INFO_PAD
    const logoY = contentBottom + INFO_LOGO_BOTTOM_GAP
    logoBox = { x: (INFO_W - logo!.w) / 2, y: logoY, w: logo!.w, h: logo!.h }
    return { rows, height: logoY + logo!.h + INFO_PAD, showTitle, titleY, ruleY, ruleAnchor, logoBox }
  }
  return { rows, height: y + INFO_PAD, showTitle, titleY, ruleY, ruleAnchor, logoBox }
}

export const infoHeight = (
  fields: InfoField[],
  logo?: { w: number; h: number } | null,
  place: 'top' | 'bottom' = 'top'
): number => infoLayout(fields, logo, place).height

// 导入图片后信息栏的默认高度下限：至少与图片等高。
// 信息栏自身高度由栏目数决定（默认 578px），旁边摆一张 1000~3000px 的渲染图时它就是个角标，
// 所以按比例把整块放大；放大后字也跟着变大，与软件里「信息栏与渲染图同一量级」的观感一致。
export const INFO_MIN_HEIGHT_RATIO = 1
export function infoScaleForImages(
  images: { y: number; h: number }[],
  fields: InfoField[],
  logo?: LogoMeta | null,
  current = 1
): number {
  if (!images.length) return current
  const top = Math.min(...images.map((i) => i.y))
  const bottom = Math.max(...images.map((i) => i.y + i.h))
  const imgH = bottom - top
  const ih = infoHeight(fields, logoSize(logo), logo?.place ?? 'top')
  if (!(imgH > 0) || !(ih > 0)) return current
  return Math.max(current, (imgH * INFO_MIN_HEIGHT_RATIO) / ih)
}
export const IMAGE_GAP = 40         // 多张渲染图之间的间距（同画布拼接）

export const RED = '#e60012'        // CMF 主色（锚点 / 色值强调）
// 引线默认颜色：沿用 CMF 红（图纸里的标注线几乎都是红），可在「全局引线样式」里改
export const LINE_COLOR = RED
// 常用的几档引线颜色：红（默认）/ 墨黑 / 中灰 / 白（深色渲染图上用）
export const LINE_COLORS = [LINE_COLOR, '#1f2329', '#6b7280', '#ffffff']

// 编辑器的工具色（只画在画布上，不进成品）：
// 一律用冷灰——画布是白纸 + 暖色 UI，冷灰既能和纸面分开，又不会和内容里的 CMF 红打架；
// 橙色只留作 UI 点缀（按钮 / 激活态 / 滑块），不参与画布上的参考线
export const UI_SELECT = '#4a5568' // 选中：深冷灰（选中时红线变冷灰，一眼能看出来）
export const UI_REGION = '#8b93a1' // 画板虚线 / 名牌：中冷灰

// 所有渲染图的包围盒右/下边界（用于 fit 与导出总表）
export function bounds(images: ImageItem[]): { maxR: number; maxB: number } {
  let maxR = 0
  let maxB = 0
  for (const im of images) {
    maxR = Math.max(maxR, im.x + (im.w || 0))
    maxB = Math.max(maxB, im.y + (im.h || 0))
  }
  return { maxR, maxB }
}
