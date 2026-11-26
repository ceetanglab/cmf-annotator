// 画板（Artboard）工具：新建 / 迁移 / 比例换算 / 底色
//
// 一个工程可以有多块画板，每块就是一张要交出去的图纸：自己的比例、底色、分辨率与格式。
// 「画板」这个概念替代了 v0.2 里唯一的「导出区域」——老工程的 exportRect 会被迁移成第一块画板。
import type { Artboard, ExportFormat, ExportRect } from '../types'
import { PAGE_PRESETS, fitRectToAspect, pageAspect, pagePx } from './presets'
import { uid } from './id'

/** Konva 节点的 id 前缀：画板框靠它被 Transformer 找到 */
export const BOARD_NODE_PREFIX = 'board-'
export const boardNodeId = (id: string) => BOARD_NODE_PREFIX + id

/** 画板底色预设：先给「透明 + 常用纸色」，再给一个深色（深色图纸评审稿常用） */
export const BOARD_BG_SWATCHES = ['#ffffff', '#f6f5f2', '#eef0f4', '#1f2329']

export const DEFAULT_BOARD_PRESET = 'a4l'
export const DEFAULT_BOARD_DPI = 150
export const DEFAULT_BOARD_FORMAT: ExportFormat = 'png'

/** 一块画板在 96 DPI 下的默认像素尺寸（新建但还没贴合内容时用它撑个框） */
export function boardSizeFor(preset: string): { w: number; h: number } {
  const px = pagePx(preset, 96)
  return px ?? { w: 1123, h: 794 }
}

/** 新建画板：rect 省略时按比例给一个默认尺寸 */
export function makeBoard(
  name: string,
  preset = DEFAULT_BOARD_PRESET,
  rect?: ExportRect,
  auto = false
): Artboard {
  const size = rect ?? { x: 0, y: 0, ...boardSizeFor(preset) }
  return {
    id: uid(),
    name,
    preset,
    x: size.x,
    y: size.y,
    w: Math.max(20, size.w),
    h: Math.max(20, size.h),
    auto,
    format: DEFAULT_BOARD_FORMAT,
    dpi: DEFAULT_BOARD_DPI
  }
}

/** 新画板和已有画板之间留的空隙（内容坐标，约等于一个缩略图宽） */
export const BOARD_GAP = 80

/** 按内容包围盒造一块画板：没有内容时退回默认尺寸 */
export function boardFromContent(name: string, preset: string, content: ExportRect | null): Artboard {
  const aspect = pageAspect(preset)
  const base: ExportRect = content && content.w > 1 && content.h > 1 ? content : { x: 0, y: 0, ...boardSizeFor(preset) }
  const rect = aspect ? fitRectToAspect(base, aspect) : base
  return makeBoard(name, preset, rect, true)
}

/** 换比例时把画板原地「向外扩」到新比例：中心不动，只扩不裁，内容不会被切掉 */
export function refitBoard(b: Artboard, preset: string): Artboard {
  const aspect = pageAspect(preset)
  if (!aspect) return { ...b, preset }
  const r = fitRectToAspect(b, aspect)
  return { ...b, preset, x: r.x, y: r.y, w: r.w, h: r.h }
}

/** 画板当前的宽高比是否已经等于它的比例（自动贴合时用来判断要不要重算） */
export function aspectMatches(b: Artboard, tol = 0.002): boolean {
  const a = pageAspect(b.preset)
  if (!a) return true
  return Math.abs(b.w / Math.max(1, b.h) - a) <= tol
}

/** preset 是否还在预设表里（读老工程时兜底） */
export function safePreset(preset: string | undefined): string {
  return PAGE_PRESETS.some((p) => p.key === preset) ? (preset as string) : DEFAULT_BOARD_PRESET
}

/** 「画板 1 / 画板 2 …」里挑一个没被占用的名字 */
export function nextBoardName(list: { name: string }[]): string {
  let i = list.length + 1
  const used = new Set(list.map((b) => b.name))
  while (used.has(`画板 ${i}`)) i += 1
  return `画板 ${i}`
}

/**
 * 「跟随内容」时，把每样内容派给一块画板：一样东西被多块画板框住时，
 * 归给「框得最严实」的那块（重叠比例最高；打平时给面积更小的那块）。
 * 一件都不沾的就不归任何画板 —— 画板只跟着自己框住的内容走，
 * 两块都开「跟随内容」才不会互相把对方的内容吞进来。
 */
export function assignItemsToBoards<T extends ExportRect>(items: T[], boards: ExportRect[]): T[][] {
  const out: T[][] = boards.map(() => [])
  for (const it of items) {
    const ia = Math.max(1, it.w) * Math.max(1, it.h)
    let best = -1
    let bestRatio = 0
    let bestArea = Infinity
    boards.forEach((b, i) => {
      const ow = Math.min(it.x + it.w, b.x + b.w) - Math.max(it.x, b.x)
      const oh = Math.min(it.y + it.h, b.y + b.h) - Math.max(it.y, b.y)
      if (ow <= 0 || oh <= 0) return
      const ratio = (ow * oh) / ia
      const area = Math.max(1, b.w) * Math.max(1, b.h)
      if (ratio > bestRatio + 1e-3 || (Math.abs(ratio - bestRatio) <= 1e-3 && area < bestArea)) {
        best = i
        bestRatio = ratio
        bestArea = area
      }
    })
    if (best >= 0) out[best].push(it)
  }
  return out
}

/** 一组矩形的最小外接矩形；空数组返回 null */
export function unionRects(rects: ExportRect[]): ExportRect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.w))
  const bottom = Math.max(...rects.map((r) => r.y + r.h))
  return { x: left, y: top, w: right - left, h: bottom - top }
}

/** 同一批导出时避免重名：画板名净化后仍重复就补序号 */
export function uniqueFileBase(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let i = 2
  while (used.has(`${base} (${i})`)) i += 1
  const next = `${base} (${i})`
  used.add(next)
  return next
}
