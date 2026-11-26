import Section from './ui/Section'

const rows: [string, string][] = [
  ['Ctrl/⌘ + Z', '撤销'],
  ['Ctrl/⌘ + Shift + Z', '重做（或 Ctrl/⌘ + Y）'],
  ['Ctrl/⌘ + A', '全选'],
  ['Ctrl/⌘ + C / V', '复制 / 粘贴图层'],
  ['Ctrl/⌘ + D', '复制副本'],
  ['Ctrl/⌘ + G', '把选中的图层合成分组'],
  ['Ctrl/⌘ + V（剪贴板是图片）', '把图片贴到画布'],
  ['Delete / Backspace', '删除选中'],
  ['方向键（Shift 加速）', '微调位置'],
  ['Ctrl/⌘ + = / -', '放大 / 缩小'],
  ['Ctrl/⌘ + 0', '适应视图'],
  ['Ctrl/⌘ + 1', '实际大小 100%'],
  ['Esc', '取消选择 / 回到选择工具'],
  ['Ctrl/⌘ + 左键', '随手回到选择工具（画到一半也生效）'],
  ['Ctrl/⌘ + S', '导出工程 JSON'],
  ['Shift + 点击', '多选'],
  ['中键拖动', '平移画布'],
  ['文本工具 · 双击空白', '落一个默认大小的文本框'],
  ['直线 / 圆形 / 矩形 · 双击起点 → 双击终点', '两点定形状，对角线就是大小'],
  ['画形状时按住 Shift', '直线锁水平 / 垂直，圆形锁正圆，矩形锁正方形']
]

export default function ShortcutsPanel() {
  return (
    <Section title="快捷键" defaultOpen={false}>
      <ul className="sc-list">
        {rows.map(([k, v]) => (
          <li key={k}>
            <span className="sc-key">{k}</span>
            <span>{v}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
