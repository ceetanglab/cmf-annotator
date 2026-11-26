// 水印刻度：字号 1~100、密度 1~100（越大越密）
// 密度不能线性映射到间距，否则前 90 档几乎看不出差别；这里用指数插值：
// 密度 1 → 间距 12 倍字号（一张图纸上没几个字），密度 100 → 0.4 倍字号（几乎连成一片）
import type { WatermarkMeta } from '../types'

export const WM_SIZE_MIN = 1
export const WM_SIZE_MAX = 100
export const WM_DENSITY_MIN = 1
export const WM_DENSITY_MAX = 100

// 密度刻度版本：2 = 1~100；老工程没有这个标记，存的是旧的 1~10
export const WM_DENSITY_VERSION = 2

const GAP_SPARSE = 12 // 最稀疏时的间距倍数
const GAP_DENSE = 0.4 // 最密时的间距倍数

export function clampWmSize(v: number | undefined, fallback = 22): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(WM_SIZE_MAX, Math.max(WM_SIZE_MIN, Math.round(n)))
}

export function clampDensity(v: number | undefined, fallback = 50): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(WM_DENSITY_MAX, Math.max(WM_DENSITY_MIN, Math.round(n)))
}

/** 平铺时的行列基础间距（content 像素） */
export function watermarkGap(size: number, density: number): number {
  const d = clampDensity(density)
  const t = (d - WM_DENSITY_MIN) / (WM_DENSITY_MAX - WM_DENSITY_MIN)
  return size * GAP_SPARSE * Math.pow(GAP_DENSE / GAP_SPARSE, t)
}

/** 旧的 1~10 刻度 → 新的 1~100：反解同一间距曲线，让老工程看起来密度不变 */
export function densityFromLegacy(old: number): number {
  const o = Math.min(10, Math.max(1, Number(old) || 5))
  const gapFactor = 2.8 - (o - 1) * 0.22 // 旧公式的间距系数
  const t = Math.log(gapFactor / GAP_SPARSE) / Math.log(GAP_DENSE / GAP_SPARSE)
  return clampDensity(Math.round(WM_DENSITY_MIN + t * (WM_DENSITY_MAX - WM_DENSITY_MIN)))
}

/** 把任意来源（老工程 / 老模板 / 脏数据）的水印收口到当前刻度 */
export function upgradeWatermark<T extends WatermarkMeta>(w: T): T {
  const density =
    w.densityV === WM_DENSITY_VERSION ? clampDensity(w.density) : densityFromLegacy(w.density)
  return { ...w, size: clampWmSize(w.size), density, densityV: WM_DENSITY_VERSION }
}
