// 标注形状（文本框 / 直线 / 折线 / 矩形 / 圆形）的默认值与几何换算。
// 约定：每个形状都有一个「包围盒」(x, y, w, h)，折线用归一化点（0~1）挂在盒子里，
// 这样改包围盒就等于整体等比变形，不需要逐点重算。
import type { ShapeItem, ShapeKind } from '../types'
import { textHeight } from './textMeasure'
import { uid } from './id'

export const SHAPE_LABEL: Record<ShapeKind, string> = {
  text: '文本框',
  line: '直线',
  polyline: '多段线',
  rect: '矩形',
  circle: '圆形'
}

export const SHAPE_COLORS = ['#1f2329', '#e60012', '#00a0ff', '#21a366', '#ff8f1f', '#8c75ff']

export const SHAPE_DEFAULT_COLOR = '#1f2329'
export const SHAPE_DEFAULT_STROKE = 2
export const SHAPE_DEFAULT_FONT = 28
export const TEXT_LINE_HEIGHT = 1.4
/** 文本框最小宽度：再窄就只剩一两个字，改宽度没意义 */
export const TEXT_MIN_W = 60
const MIN_SIZE = 2

/** 双击新建时给的初始尺寸：小到能一眼看出是什么，又大到能直接上手调 */
export const SHAPE_DEFAULT_BOX: Record<ShapeKind, { w: number; h: number }> = {
  text: { w: 220, h: 40 },
  line: { w: 220, h: 140 },
  polyline: { w: 240, h: 140 },
  rect: { w: 220, h: 150 },
  circle: { w: 170, h: 170 }
}

/** 文本框的高度由内容算：宽度变了文字会重排，高度必须跟着变 */
export function textShapeHeight(text: string, w: number, fontSize: number): number {
  const h = textHeight(text || ' ', Math.max(10, w), fontSize, false, TEXT_LINE_HEIGHT)
  return Math.max(Math.round(fontSize * TEXT_LINE_HEIGHT), Math.round(h))
}

/**
 * 造一个形状。
 * - 直线：从左下到右上的对角线？不——用「起点到终点」的方向来定折点，由调用方传 stop
 * - 矩形 / 圆形：直接用包围盒
 * - 文本框：高度按内容算
 */
export function makeShape(
  kind: ShapeKind,
  box: { x: number; y: number; w: number; h: number },
  opts: { color?: string; strokeWidth?: number; diagonal?: 'tlbr' | 'trbl' } = {}
): ShapeItem {
  const w = Math.max(MIN_SIZE, Math.round(box.w))
  const h = Math.max(MIN_SIZE, Math.round(box.h))
  const base: ShapeItem = {
    id: uid(),
    kind,
    x: Math.round(box.x),
    y: Math.round(box.y),
    w,
    h,
    color: opts.color ?? SHAPE_DEFAULT_COLOR,
    strokeWidth: opts.strokeWidth ?? SHAPE_DEFAULT_STROKE,
    opacity: 1
  }
  if (kind === 'line') {
    base.points =
      opts.diagonal === 'trbl'
        ? [{ x: 1, y: 0 }, { x: 0, y: 1 }]
        : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
  }
  if (kind === 'polyline') {
    base.points = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }]
  }
  if (kind === 'text') {
    base.text = '文字'
    base.fontSize = SHAPE_DEFAULT_FONT
    base.w = Math.max(TEXT_MIN_W, w)
    base.h = textShapeHeight(base.text, base.w, base.fontSize)
    base.strokeWidth = 0
    base.color = opts.color ?? '#1f2329'
  }
  return base
}

/** 折点的绝对坐标（渲染 / 命中 / 导出都用它，保证三处一致） */
export function shapePointsAbs(s: ShapeItem): { x: number; y: number }[] {
  if (!s.points || !s.points.length) {
    return [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }]
  }
  return s.points.map((p) => ({ x: s.x + p.x * s.w, y: s.y + p.y * s.h }))
}

/** 由一串绝对折点反算包围盒 + 归一化点（新建折线时用） */
export function polylineFromPoints(
  abs: { x: number; y: number }[],
  opts: { color?: string; strokeWidth?: number } = {}
): ShapeItem {
  const xs = abs.map((p) => p.x)
  const ys = abs.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const w = Math.max(MIN_SIZE, Math.max(...xs) - x)
  const h = Math.max(MIN_SIZE, Math.max(...ys) - y)
  return {
    id: uid(),
    kind: 'polyline',
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
    color: opts.color ?? SHAPE_DEFAULT_COLOR,
    strokeWidth: opts.strokeWidth ?? SHAPE_DEFAULT_STROKE,
    opacity: 1,
    points: abs.map((p) => ({ x: (p.x - x) / w, y: (p.y - y) / h }))
  }
}

/**
 * 「两点定一个形状」：起点 from、终点 to 都是世界坐标，终点到起点的对角线决定大小。
 * - 直线：两点直接连线；按住 Shift 锁水平 / 垂直（按拖得更长的那个轴）
 * - 矩形 / 圆形：对角线就是包围盒；按住 Shift 变正方形 / 正圆，向拖动的那个方向撑开
 * 太小（两点几乎重合）返回 null，当作误触，不要落一个看不见的形状。
 */
export function shapeFromDrag(
  kind: ShapeKind,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { shift?: boolean; color?: string; strokeWidth?: number } = {}
): ShapeItem | null {
  const x = Math.round(from.x)
  const y = Math.round(from.y)
  let ex = Math.round(to.x)
  let ey = Math.round(to.y)
  if (opts.shift && kind === 'line') {
    if (Math.abs(ex - x) >= Math.abs(ey - y)) ey = y
    else ex = x
  }
  if (opts.shift && (kind === 'rect' || kind === 'circle')) {
    const side = Math.max(Math.abs(ex - x), Math.abs(ey - y))
    ex = x + (ex >= x ? side : -side)
    ey = y + (ey >= y ? side : -side)
  }
  const bw = Math.abs(ex - x)
  const bh = Math.abs(ey - y)
  if (bw < 2 && bh < 2) return null
  const s = makeShape(
    kind,
    { x: Math.min(x, ex), y: Math.min(y, ey), w: bw, h: bh },
    { color: opts.color, strokeWidth: opts.strokeWidth }
  )
  if (kind === 'line') {
    // 端点按（四舍五入后的）包围盒归一化：水平 / 垂直时不会被最小尺寸带出一点斜度
    s.points = [
      { x: (x - s.x) / s.w, y: (y - s.y) / s.h },
      { x: (ex - s.x) / s.w, y: (ey - s.y) / s.h }
    ]
  }
  return s
}

/** 把形状限制在合理范围内：尺寸不为负、文本框高度跟内容走 */
export function normalizeShape(s: ShapeItem): ShapeItem {
  const w = Math.max(MIN_SIZE, Math.round(s.w))
  const h = Math.max(MIN_SIZE, Math.round(s.h))
  const next: ShapeItem = { ...s, w, h }
  if (next.kind === 'text') {
    const fz = next.fontSize ?? SHAPE_DEFAULT_FONT
    next.w = Math.max(TEXT_MIN_W, w)
    next.h = textShapeHeight(next.text ?? '', next.w, fz)
    next.strokeWidth = 0
  }
  return next
}

/** 图层面板里的一行显示什么 */
export function shapeCaption(s: ShapeItem): string {
  if (s.kind === 'text') {
    const t = (s.text ?? '').replace(/\s+/g, ' ').trim()
    return t ? (t.length > 12 ? t.slice(0, 12) + '…' : t) : '（空文本）'
  }
  // 只给「尺寸」这一项：类型名由调用方自己加，否则图层里会出现「折线 · 折线 · 87×100」
  return `${Math.round(s.w)}×${Math.round(s.h)}`
}
