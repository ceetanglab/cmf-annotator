// 模板库：存 localStorage（跨工程复用），也能导出成 .json 分享给同事
import type { AnnTemplate, CMFRow, CMFTemplate, ExportFormat, WatermarkMeta } from '../types'
import { clampDpi, DPI_OPTIONS, PAGE_PRESETS, presetShortName } from './presets'
import { LINE_COLOR } from '../layout'
import { upgradeWatermark } from './watermark'

const LIST_KEY = 'cmf-templates'
const ANN_KEY = 'cmf-ann-template'
export const TEMPLATE_KIND = 'cmf-template'

const FORMATS: ExportFormat[] = ['png', 'jpeg', 'webp', 'pdf', 'svg']

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function write(key: string, val: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(val))
  } catch {
    /* 隐私模式 / 配额满：忽略，模板只在本次会话有效 */
  }
}

function cleanRows(raw: unknown): CMFRow[] {
  if (!Array.isArray(raw)) return []
  const out: CMFRow[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const key = typeof o.key === 'string' ? o.key : ''
    const label = typeof o.label === 'string' ? o.label.trim() : ''
    if (!key || !label) continue
    // 模板只保留结构：值一律清空，避免把上一个项目的内容带进新项目
    out.push({ key, label, value: '', hidden: o.hidden === true || undefined, slash: o.slash === true || undefined })
  }
  return out
}

function cleanWatermark(raw: unknown): WatermarkMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return upgradeWatermark({
    on: o.on === true,
    mode: o.mode === 'single' ? 'single' : 'tile',
    text: typeof o.text === 'string' ? o.text : 'CMF · 内部评审稿',
    size: num(o.size, 22),
    density: num(o.density, 50),
    // 老模板没有版本标记 → 走旧刻度换算
    densityV: typeof o.densityV === 'number' ? o.densityV : undefined,
    opacity: Math.min(1, Math.max(0.01, num(o.opacity, 0.12))),
    x: typeof o.x === 'number' ? o.x : undefined,
    y: typeof o.y === 'number' ? o.y : undefined
  })
}

/**
 * 把任意来源（本地库 / 同事发来的 .json）的模板数据校验成可用结构。
 * 缺字段一律补默认值，宁可用起来也别整份丢弃。
 */
export function normalizeTemplate(raw: unknown): CMFTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, any>
  if (o.kind !== TEMPLATE_KIND) return null

  const presetOk = PAGE_PRESETS.some((p) => p.key === o.exportPreset)
  const logo =
    o.logo && typeof o.logo === 'object' && typeof o.logo.dataUrl === 'string'
      ? {
          dataUrl: o.logo.dataUrl as string,
          w: Number(o.logo.w) || 320,
          h: Number(o.logo.h) || 120,
          ratio: Math.min(1, Math.max(0.2, Number(o.logo.ratio) || 0.6)),
          place: o.logo.place === 'bottom' ? ('bottom' as const) : ('top' as const)
        }
      : null

  const infoFields = Array.isArray(o.infoFields)
    ? o.infoFields
        .filter((f: any) => f && typeof f.label === 'string' && f.label.trim())
        .map((f: any) => ({ label: String(f.label).trim(), hidden: f.hidden === true || undefined }))
    : []

  const dpi = clampDpi(Number(o.exportDpi) || 150)

  return {
    kind: TEMPLATE_KIND,
    version: 1,
    id: typeof o.id === 'string' && o.id ? o.id : `tpl_${Date.now()}`,
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : '未命名模板',
    createdAt: Number(o.createdAt) || Date.now(),
    lineWidth: Math.min(24, Math.max(1, Number(o.lineWidth) || 6)),
    anchorSize: Math.min(44, Math.max(2, Number(o.anchorSize) || 20)),
    endStyle: o.endStyle === 'arrow' ? 'arrow' : 'dot',
    lineColor: typeof o.lineColor === 'string' && /^#[0-9a-f]{6}$/i.test(o.lineColor) ? o.lineColor : LINE_COLOR,
    annRows: cleanRows(o.annRows),
    annNoName: o.annNoName === true || undefined,
    infoFields,
    infoScale: Math.min(3, Math.max(0.3, Number(o.infoScale) || 1)),
    infoVisible: o.infoVisible !== false,
    infoRule: o.infoRule !== false,
    logo,
    watermark: cleanWatermark(o.watermark),
    exportPreset: presetOk ? o.exportPreset : 'a4l',
    exportDpi: dpi,
    // 没存标记时按「是否预设档位」反推，和 store 里的老工程逻辑一致
    exportDpiCustom: o.exportDpiCustom === true || (o.exportDpiCustom !== false && !DPI_OPTIONS.includes(dpi)),
    exportFormat: FORMATS.includes(o.exportFormat) ? o.exportFormat : 'png',
    labelPresets: Array.isArray(o.labelPresets) ? o.labelPresets.filter((x: any) => typeof x === 'string') : undefined,
    cmfPresets: Array.isArray(o.cmfPresets) ? o.cmfPresets.filter((x: any) => typeof x === 'string') : undefined
  }
}

export function loadTemplates(): CMFTemplate[] {
  const raw = read(LIST_KEY)
  if (!Array.isArray(raw)) return []
  return raw.map(normalizeTemplate).filter((t): t is CMFTemplate => !!t)
}

export function saveTemplates(list: CMFTemplate[]) {
  write(LIST_KEY, list)
}

export function loadAnnTemplate(): AnnTemplate | null {
  const raw = read(ANN_KEY)
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, any>
  const rows = cleanRows(o.rows)
  if (!rows.length) return null
  return { rows, noName: o.noName === true || undefined }
}

export function saveAnnTemplate(t: AnnTemplate | null) {
  if (!t) {
    write(ANN_KEY, null)
    return
  }
  write(ANN_KEY, t)
}

/** 列表里显示的一句话摘要：A4 横向 · 150 DPI · 5 栏 */
export function templateSummary(t: CMFTemplate): string {
  const parts = [presetShortName(t.exportPreset), `${t.exportDpi} DPI`]
  if (t.annRows.length) parts.push(`${t.annRows.length} 栏`)
  if (t.watermark?.on) parts.push('水印')
  return parts.join(' · ')
}
