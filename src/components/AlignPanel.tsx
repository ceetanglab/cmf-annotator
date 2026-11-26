import { useStore, type AlignDir } from '../store'
import Section from './ui/Section'

type GlyphKind = AlignDir | 'distH' | 'distV'

// 用简洁 SVG 模拟 Illustrator 对齐图标：冷灰线为基准，暖灰块为对象
function Glyph({ kind }: { kind: GlyphKind }) {
  const L = '#4a5568'
  const B = '#a8a294'
  const common = { width: 18, height: 18, viewBox: '0 0 18 18' }
  switch (kind) {
    case 'left':
      return (
        <svg {...common}>
          <line x1="3" y1="2.5" x2="3" y2="15.5" stroke={L} strokeWidth="1.5" />
          <rect x="5" y="4.5" width="10" height="3.2" rx="0.6" fill={B} />
          <rect x="5" y="10.3" width="6" height="3.2" rx="0.6" fill={B} />
        </svg>
      )
    case 'hcenter':
      return (
        <svg {...common}>
          <line x1="9" y1="2.5" x2="9" y2="15.5" stroke={L} strokeWidth="1.5" />
          <rect x="4" y="4.5" width="10" height="3.2" rx="0.6" fill={B} />
          <rect x="6" y="10.3" width="6" height="3.2" rx="0.6" fill={B} />
        </svg>
      )
    case 'right':
      return (
        <svg {...common}>
          <line x1="15" y1="2.5" x2="15" y2="15.5" stroke={L} strokeWidth="1.5" />
          <rect x="3" y="4.5" width="10" height="3.2" rx="0.6" fill={B} />
          <rect x="7" y="10.3" width="6" height="3.2" rx="0.6" fill={B} />
        </svg>
      )
    case 'top':
      return (
        <svg {...common}>
          <line x1="2.5" y1="3" x2="15.5" y2="3" stroke={L} strokeWidth="1.5" />
          <rect x="4.5" y="5" width="3.2" height="10" rx="0.6" fill={B} />
          <rect x="10.3" y="5" width="3.2" height="6" rx="0.6" fill={B} />
        </svg>
      )
    case 'vcenter':
      return (
        <svg {...common}>
          <line x1="2.5" y1="9" x2="15.5" y2="9" stroke={L} strokeWidth="1.5" />
          <rect x="4.5" y="4" width="3.2" height="10" rx="0.6" fill={B} />
          <rect x="10.3" y="6" width="3.2" height="6" rx="0.6" fill={B} />
        </svg>
      )
    case 'bottom':
      return (
        <svg {...common}>
          <line x1="2.5" y1="15" x2="15.5" y2="15" stroke={L} strokeWidth="1.5" />
          <rect x="4.5" y="3" width="3.2" height="10" rx="0.6" fill={B} />
          <rect x="10.3" y="7" width="3.2" height="6" rx="0.6" fill={B} />
        </svg>
      )
    case 'distH':
      return (
        <svg {...common}>
          <rect x="2" y="4" width="3.2" height="10" rx="0.6" fill={B} />
          <rect x="7.4" y="4" width="3.2" height="10" rx="0.6" fill={B} />
          <rect x="12.8" y="4" width="3.2" height="10" rx="0.6" fill={B} />
        </svg>
      )
    case 'distV':
      return (
        <svg {...common}>
          <rect x="4" y="2" width="10" height="3.2" rx="0.6" fill={B} />
          <rect x="4" y="7.4" width="10" height="3.2" rx="0.6" fill={B} />
          <rect x="4" y="12.8" width="10" height="3.2" rx="0.6" fill={B} />
        </svg>
      )
  }
}

const aligns: { dir: AlignDir; title: string }[] = [
  { dir: 'left', title: '左对齐' },
  { dir: 'hcenter', title: '水平居中' },
  { dir: 'right', title: '右对齐' },
  { dir: 'top', title: '顶对齐' },
  { dir: 'vcenter', title: '垂直居中' },
  { dir: 'bottom', title: '底对齐' }
]

export default function AlignPanel() {
  const selectedIds = useStore((s) => s.selectedIds)
  const images = useStore((s) => s.images)
  const annotations = useStore((s) => s.annotations)
  const align = useStore((s) => s.align)
  const distribute = useStore((s) => s.distribute)

  const count = selectedIds.filter(
    (id) => images.some((i) => i.id === id) || annotations.some((a) => a.id === id)
  ).length
  const canAlign = count >= 2
  const canDist = count >= 3

  return (
    <Section
      title="对齐"
      desc={count >= 2 ? `已选 ${count} 个对象` : '按住 Shift 点选多个图片 / 标注后即可对齐'}
    >
      <div className="align-grid">
        {aligns.map((a) => (
          <button
            key={a.dir}
            className="btn icon-btn"
            title={a.title}
            disabled={!canAlign}
            onClick={() => align(a.dir)}
          >
            <Glyph kind={a.dir} />
          </button>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn" style={{ flex: 1 }} disabled={!canDist} onClick={() => distribute('h')}>
          水平等距
        </button>
        <button className="btn" style={{ flex: 1 }} disabled={!canDist} onClick={() => distribute('v')}>
          垂直等距
        </button>
      </div>
    </Section>
  )
}
