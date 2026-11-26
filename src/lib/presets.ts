// 导出页面规格（默认比例 A4）。mm 为物理尺寸，free 表示按内容尺寸。
import type { ExportRect } from '../types'

export interface PagePreset {
  key: string
  name: string   // 按钮显示的简短名称（A4 / A3 / Letter / 1:1 / 16:9 / 自由）
  label: string  // 完整说明（用于 title 提示）
  mmW: number
  mmH: number
}

export const PAGE_PRESETS: PagePreset[] = [
  { key: 'a4l', name: 'A4', label: 'A4 横向（297×210）', mmW: 297, mmH: 210 },
  { key: 'a4p', name: 'A4', label: 'A4 纵向（210×297）', mmW: 210, mmH: 297 },
  { key: 'a3l', name: 'A3', label: 'A3 横向（420×297）', mmW: 420, mmH: 297 },
  { key: 'a3p', name: 'A3', label: 'A3 纵向（297×420）', mmW: 297, mmH: 420 },
  { key: 'a5l', name: 'A5', label: 'A5 横向（210×148）', mmW: 210, mmH: 148 },
  { key: 'a5p', name: 'A5', label: 'A5 纵向（148×210）', mmW: 148, mmH: 210 },
  { key: 'letter', name: 'Letter', label: 'Letter 纵向（216×279）', mmW: 215.9, mmH: 279.4 },
  { key: 'square', name: '1:1', label: '正方形 1:1（210×210）', mmW: 210, mmH: 210 },
  { key: 'wide', name: '16:9', label: '宽屏 16:9（338×190）', mmW: 338, mmH: 190 },
  { key: 'free', name: '自由', label: '自由（按内容尺寸）', mmW: 0, mmH: 0 }
]

export const DPI_OPTIONS = [96, 150, 300]

// 自定义 DPI 的可用区间：低于 36 印不出细节，高于 600 浏览器画布基本撑不住
export const MIN_DPI = 36
export const MAX_DPI = 600

// 浏览器 canvas 的硬限制（Chrome / Edge 单边 16384，总面积约 2.68 亿像素）。
// 这里再收紧一档，留出 toDataURL 编码时的额外内存，避免导出一张全白图。
export const MAX_CANVAS_SIDE = 16384
export const MAX_CANVAS_AREA = 1.6e8

/** 把任意输入收敛到合法 DPI（整数、落在区间内） */
export function clampDpi(d: number): number {
  if (!Number.isFinite(d)) return 150
  return Math.min(MAX_DPI, Math.max(MIN_DPI, Math.round(d)))
}

/** 输出像素是否超出 canvas 能力；超出时返回一句人话，正常返回 null */
export function overCanvasLimit(w: number, h: number): string | null {
  const side = Math.max(w, h)
  if (side > MAX_CANVAS_SIDE) {
    return `长边 ${side}px 超过浏览器画布上限 ${MAX_CANVAS_SIDE}px`
  }
  if (w * h > MAX_CANVAS_AREA) {
    return `${w} × ${h} = ${(w * h / 1e6).toFixed(0)} 百万像素，超出安全范围`
  }
  return null
}

/** 画布内存估算（RGBA 4 字节/像素），用于提示「这张图很大」 */
export function outputMemoryMB(w: number, h: number): number {
  return Math.round((w * h * 4) / 1e6)
}

/** 大图提醒阈值：约 4000 万像素（≈160MB）往上，导出会有明显等待 */
export const HEAVY_PIXELS = 4e7

export function isHeavyOutput(w: number, h: number): boolean {
  return w * h > HEAVY_PIXELS
}

// 预设页面在指定 DPI 下的像素尺寸；free 返回 null（尺寸另算）
export function pagePx(presetKey: string, dpi: number): { w: number; h: number } | null {
  const p = PAGE_PRESETS.find((x) => x.key === presetKey)
  if (!p || p.mmW <= 0 || p.mmH <= 0) return null
  const f = dpi / 25.4
  return { w: Math.round(p.mmW * f), h: Math.round(p.mmH * f) }
}

/**
 * 「导出框选区域原分辨率」下的等效 DPI：区域宽度像素 ÷ 页面宽度英寸数。
 * 区域是跟着页面比例走的（A4/A3…），所以直接把这张原像素图放到纸上，按页宽算出的就是它的真实 DPI。
 * 没有物理页面的规格（自由）按 96 —— 画布本身就是 1 CSS px = 1/96 英寸。
 */
export function nativeDpiFor(regionW: number | null | undefined, presetKey: string): number | null {
  if (!regionW || regionW <= 0) return null
  const p = PAGE_PRESETS.find((x) => x.key === presetKey)
  if (!p || p.mmW <= 0) return 96
  return Math.max(1, Math.round(regionW / (p.mmW / 25.4)))
}

// 预设页面的宽高比；free 返回 null
export function pageAspect(presetKey: string): number | null {
  const p = PAGE_PRESETS.find((x) => x.key === presetKey)
  if (!p || p.mmW <= 0 || p.mmH <= 0) return null
  return p.mmW / p.mmH
}

// 把矩形按目标宽高比「向外扩」（保持中心，只增不减，保证内容不被裁掉）
export function fitRectToAspect(r: ExportRect, aspect: number): ExportRect {
  const w0 = Math.max(1, r.w)
  const h0 = Math.max(1, r.h)
  let w = w0
  let h = h0
  if (w0 / h0 < aspect) w = h0 * aspect
  else h = w0 / aspect
  const cx = r.x + w0 / 2
  const cy = r.y + h0 / 2
  return { x: cx - w / 2, y: cy - h / 2, w, h }
}

// inner 是否完全落在 outer 内（容差 0.5px，避免浮点误差导致每帧都判成「越界」）
export function rectContains(outer: ExportRect, inner: ExportRect, tol = 0.5): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  )
}

// 简短名称：A4 横向 / 1:1 / 自由
export function presetShortName(presetKey: string): string {
  const p = PAGE_PRESETS.find((x) => x.key === presetKey)
  if (!p) return ''
  if (p.mmW <= 0 || p.mmH <= 0) return '自由'
  if (p.name.includes(':')) return p.name
  const o = p.mmW > p.mmH ? '横向' : p.mmH > p.mmW ? '纵向' : ''
  return o ? `${p.name} ${o}` : p.name
}
