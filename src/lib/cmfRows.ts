// 标注栏目行：把「固定六字段」升级成可排序 / 可增删 / 可隐藏的行数组
// 设计原则：内置字段的「值」始终以 cmf 上的同名字段为唯一数据源，
//          行数据只负责顺序、栏目名、隐藏状态与自定义行，避免两处数值不同步。
import type { CMFMeta, CMFRow } from '../types'
import { uid } from './id'

export const BUILTIN_CMF_KEYS = ['color', 'material', 'finish', 'process', 'note'] as const
export type BuiltinCmfKey = (typeof BUILTIN_CMF_KEYS)[number]

export const DEFAULT_CMF_LABELS: Record<BuiltinCmfKey, string> = {
  color: '颜色',
  material: '材质',
  finish: '工艺',
  process: '制作工序',
  note: '特别说明'
}

export function isBuiltinCmfKey(k: string): k is BuiltinCmfKey {
  return (BUILTIN_CMF_KEYS as readonly string[]).includes(k)
}

// 默认模板：新建标注时标注框里展示的五栏
export function defaultCmfRows(cmf: CMFMeta): CMFRow[] {
  return BUILTIN_CMF_KEYS.map((k) => ({ key: k, label: DEFAULT_CMF_LABELS[k], value: cmf[k] }))
}

// 取实际生效的行：rows 存在（哪怕是空数组，表示「全部删掉」）就用它，
// 否则退回默认五行；内置行的值实时覆盖为 cmf 字段值
export function cmfRows(cmf: CMFMeta): CMFRow[] {
  const base = Array.isArray(cmf.rows) ? cmf.rows : defaultCmfRows(cmf)
  return base.map((r) => (isBuiltinCmfKey(r.key) ? { ...r, value: cmf[r.key] } : { ...r }))
}

export function newCmfRow(label = '新栏目'): CMFRow {
  return { key: `c_${uid().slice(0, 8)}`, label, value: '' }
}

// 行数据 → 写回 cmf：内置字段值同步回 cmf，保证左侧图层色块 / 副标题一致
export function applyCmfRows(cmf: CMFMeta, rows: CMFRow[]): CMFMeta {
  const next: CMFMeta = { ...cmf, rows: rows.map((r) => ({ ...r })) }
  for (const r of rows) {
    if (isBuiltinCmfKey(r.key)) next[r.key] = r.value
  }
  return next
}
