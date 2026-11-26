import { useState, type ReactNode, type Ref } from 'react'
import Icon from './Icon'

interface Props {
  title: string
  desc?: string
  /** 右侧操作区（不会触发折叠） */
  right?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  /** 撑满剩余高度（左栏「图层」用） */
  grow?: boolean
  /** 无内边距（列表类内容自己控制） */
  flush?: boolean
  /** 拿到根节点，便于外部滚动定位 */
  domRef?: Ref<HTMLElement>
}

/** 分组卡片：标题可点击折叠，风格对齐设计工具右侧属性面板 */
export default function Section({
  title,
  desc,
  right,
  children,
  defaultOpen = true,
  grow,
  flush,
  domRef
}: Props) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section ref={domRef} className={`sect${open ? ' is-open' : ''}${grow ? ' is-grow' : ''}`}>
      <div className="sect-head" onClick={() => setOpen((o) => !o)}>
        <span className="sect-caret">
          <Icon name="chevron" size={12} />
        </span>
        <span className="sect-title">{title}</span>
        {right && (
          <span className="sect-right" onClick={(e) => e.stopPropagation()}>
            {right}
          </span>
        )}
      </div>
      {open && (
        <div className={`sect-body${flush ? ' is-flush' : ''}`}>
          {desc && <p className="sect-desc">{desc}</p>}
          {children}
        </div>
      )}
    </section>
  )
}
