import Icon from './ui/Icon'
import { useStore } from '../store'
import type { CanvasControls } from '../canvasControls'
import type { MutableRefObject } from 'react'

/** 画布底部居中缩放条：缩放比例 + 适应视图 */
export default function ZoomBar({ controlsRef }: { controlsRef: MutableRefObject<CanvasControls | null> }) {
  const zoom = useStore((s) => s.zoom)

  return (
    <div className="zoombar">
      <button className="zbtn" title="缩小（Ctrl -）" onClick={() => controlsRef.current?.zoomBy(1 / 1.2)}>
        <Icon name="minus" size={13} />
      </button>
      <button
        className="zval"
        title="回到 100%"
        onClick={() => controlsRef.current?.actualSize()}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className="zbtn" title="放大（Ctrl +）" onClick={() => controlsRef.current?.zoomBy(1.2)}>
        <Icon name="plus" size={13} />
      </button>
      <span className="zsep" />
      <button className="zbtn wide" title="适应视图（Ctrl 0）" onClick={() => controlsRef.current?.fit()}>
        适应
      </button>
    </div>
  )
}
