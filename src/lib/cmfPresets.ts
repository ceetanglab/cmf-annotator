// 工艺 / 材质的常用项：点标签直接拼进标注框，省得每次手打。
//
// 值里统一用「 + 」连接（如「磨砂 + 拉丝」），解析时也只认这一种分隔，
// 这样材质名里自带的加号（PC+ABS / PC+GF）不会被拆成两项。

export const PRESET_SEP = ' + '

// 表面处理 / 工艺：截图顺序打底，中间补了几个常用项（阳极氧化 / 喷油 / 真空镀）
export const FINISH_PRESETS: readonly string[] = [
  '哑面',
  '亮面',
  '磨砂',
  '皮革漆',
  '烤漆',
  '喷涂',
  '喷砂',
  '拉丝',
  '电镀',
  'PVD镀膜',
  '抛光',
  '喷细砂',
  '阳极氧化',
  '喷油',
  '真空镀',
  'IMD',
  'IML',
  '水转印',
  '热转印',
  '丝印',
  '镭雕',
  '本色',
  '其他'
]

// 材质：按塑料 / 金属 / 软质与复合 / 其它分组排列。
// 补了玻纤、PC+GF、聚氨酯、云母、石墨烯；亚克力不再重复列 PMMA（同一材料）
export const MATERIAL_PRESETS: readonly string[] = [
  'ABS',
  'PC',
  'PC+ABS',
  'PP',
  'PA',
  'POM',
  'HIPS',
  'PBT',
  'PET',
  '玻纤',
  'PC+GF',
  '钛金属',
  '铝合金',
  '不锈钢',
  '锌合金',
  '镁合金',
  '碳纤维',
  '硅胶',
  'TPU',
  '橡胶',
  '氟橡胶',
  '聚氨酯',
  '云母',
  '石墨烯',
  '玻璃',
  '陶瓷',
  '亚克力',
  '蓝宝石玻璃',
  '木材',
  '其他'
]

/**
 * 把已填的文字拆成「项」。
 * 先按组件自己写入的「 + 」拆，再把人手习惯用的顿号 / 逗号 / 斜杠当分隔，
 * 这样用户手打「磨砂、拉丝」再点标签，也能正确高亮已有项。
 */
export function splitPresetValue(v: string): string[] {
  return v
    .split(PRESET_SEP)
    .flatMap((s) => s.split(/[、,，/;；]/))
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 切换某一项：有就删掉，没有就追加到末尾（返回拼好的新文本） */
export function togglePresetValue(value: string, item: string): string {
  const items = splitPresetValue(value)
  const next = items.includes(item) ? items.filter((x) => x !== item) : [...items, item]
  return next.join(PRESET_SEP)
}
