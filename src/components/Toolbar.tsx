import { useStore } from '../store'
import { undo, redo, canUndo, canRedo } from '../history'
import Icon from './ui/Icon'
import type { IconName } from './ui/Icon'

interface Props {
  onFit: () => void
  onActualSize: () => void
}

const mainTools = [
  { key: 'select', label: '选择', icon: 'cursor', tip: '点选 / 拖动 / 拖角缩放；空白处左键拖动平移，中键随时可平移' },
  { key: 'callout', label: '标注', icon: 'tag', tip: 'CMF 引线标注：双击画布生成一条带材料 / 工艺栏目的标注' }
] as const

// 形状标注工具：选中后「双击画布空白处」就落一个默认尺寸的形状，
// 随后可以在右栏「标注设置」里改颜色 / 线宽 / 透明度 / 文字。
const shapeTools = [
  { key: 'text', label: '文本', icon: 'text', tip: '文本框：双击空白处新建，文字在右栏「标注设置」里改（思源黑体）' },
  { key: 'line', label: '直线', icon: 'line', tip: '直线：双击定起点，移动后再双击定终点；按住 Shift 锁水平 / 垂直' },
  { key: 'polyline', label: '多段线', icon: 'polyline', tip: '多段线：单击落一个点，双击收尾；收尾后再单击就是新的一条（Esc 取消半截）' },
  { key: 'circle', label: '圆形', icon: 'circle', tip: '圆形 / 椭圆：双击定起点，移动后再双击定终点（对角线就是大小）；按住 Shift 锁正圆' },
  { key: 'rect', label: '矩形', icon: 'rect', tip: '矩形：双击定起点，移动后再双击定终点（对角线就是大小）；按住 Shift 锁正方形' }
] as const

export default function Toolbar({ onFit, onActualSize }: Props) {
  const tool = useStore((s) => s.tool)
  const setTool = useStore((s) => s.setTool)
  // 订阅历史栈版本号，撤销/重做按钮可用态才能实时刷新
  useStore((s) => s.histTick)

  return (
    <div className="toolbar">
      <div className="seg-group">
        <button className="tbtn" disabled={!canUndo()} title="撤销（Ctrl Z）" onClick={() => undo()}>
          <Icon name="undo" />
          <span className="tlabel">撤销</span>
        </button>
        <button className="tbtn" disabled={!canRedo()} title="重做（Ctrl Shift Z）" onClick={() => redo()}>
          <Icon name="redo" />
          <span className="tlabel">重做</span>
        </button>
      </div>

      <div className="seg-group">
        {mainTools.map((t) => (
          <button
            key={t.key}
            className={`tbtn${tool === t.key ? ' is-on' : ''}`}
            title={t.tip}
            onClick={() => setTool(t.key)}
          >
            <Icon name={t.icon as IconName} />
            <span className="tlabel">{t.label}</span>
          </button>
        ))}
      </div>

      <span className="tb-sep" />

      {/* 形状工具：在画布上双击起笔；Esc 回到选择。导入 / 导出全部收进左栏，工具条只留「画什么」 */}
      <div className="seg-group" title="选中工具后在画布上双击起笔：文本落一个默认框，直线 / 圆形 / 矩形双击起点再双击终点；Esc 回到选择">
        {shapeTools.map((t) => (
          <button
            key={t.key}
            className={`tbtn${tool === t.key ? ' is-on' : ''}`}
            title={t.tip}
            onClick={() => setTool(t.key)}
          >
            <Icon name={t.icon as IconName} />
            <span className="tlabel">{t.label}</span>
          </button>
        ))}
      </div>

      <span className="tb-sep" />

      <div className="seg-group">
        <button className="tbtn" title="适应视图（Ctrl 0）" onClick={onFit}>
          <Icon name="fit" />
          <span className="tlabel">适应</span>
        </button>
        <button
          className="tbtn"
          title="100%（Ctrl 1）：图比窗口小就按原像素 1:1 显示；比窗口大（渲染图常见三四千像素）缩到刚好铺满一屏，抠细节请用滚轮放大"
          onClick={onActualSize}
        >
          100%
        </button>
      </div>
    </div>
  )
}
