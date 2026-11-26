// 撤销 / 重做：以「文档快照」记录（图片、标注、信息栏、信息栏位置/缩放）。
// 采用防抖提交：连续拖动 / 滑杆变化合并为一步历史。
import { useStore } from './store'
import type { Artboard, CMFAnnotation, ImageItem, LayerGroup, LogoMeta, ProjectInfo, ShapeItem, WatermarkMeta } from './types'

interface Snapshot {
  images: ImageItem[]
  annotations: CMFAnnotation[]
  shapes: ShapeItem[]
  groups: LayerGroup[]
  artboards: Artboard[]
  info: ProjectInfo
  infoScale: number
  infoPos: { x: number; y: number } | null
  logo: LogoMeta | null
  watermark: WatermarkMeta
}

const past: Snapshot[] = []
const future: Snapshot[] = []
let baseline: Snapshot | null = null
let timer: number | null = null
let applying = false
let subscribed = false

const take = (): Snapshot => {
  const s = useStore.getState()
  return {
    images: s.images,
    annotations: s.annotations,
    shapes: s.shapes,
    groups: s.groups,
    artboards: s.artboards,
    info: s.info,
    infoScale: s.infoScale,
    infoPos: s.infoPos,
    logo: s.logo,
    watermark: s.watermark
  }
}

// 文档是否发生变化（引用比较即可，动作都会产生新引用）
const same = (a: Snapshot, b: Snapshot) =>
  a.images === b.images &&
  a.annotations === b.annotations &&
  a.shapes === b.shapes &&
  a.groups === b.groups &&
  a.artboards === b.artboards &&
  a.info === b.info &&
  a.infoScale === b.infoScale &&
  a.infoPos === b.infoPos &&
  a.logo === b.logo &&
  a.watermark === b.watermark

function commit() {
  const cur = take()
  if (!baseline) {
    baseline = cur
    return
  }
  if (same(baseline, cur)) return
  past.push(baseline)
  if (past.length > 100) past.shift()
  future.length = 0
  baseline = cur
  useStore.getState().bumpHist()
}

function flush() {
  if (timer != null) {
    clearTimeout(timer)
    timer = null
  }
  commit()
}

function applySnapshot(snap: Snapshot) {
  applying = true
  useStore.setState({
    images: snap.images,
    annotations: snap.annotations,
    shapes: snap.shapes,
    groups: snap.groups,
    artboards: snap.artboards,
    info: snap.info,
    infoScale: snap.infoScale,
    infoPos: snap.infoPos,
    logo: snap.logo,
    watermark: snap.watermark,
    selectedIds: []
  })
  baseline = snap
  applying = false
  useStore.getState().bumpHist()
}

// 初始化（首次加载项目后调用）：重置基线并订阅变化
export function initHistory() {
  baseline = take()
  past.length = 0
  future.length = 0
  if (subscribed) return
  subscribed = true
  useStore.subscribe(() => {
    if (applying) return
    if (timer != null) clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      commit()
    }, 350)
  })
}

// 载入新项目 / 导入项目后清空历史
export function resetHistory() {
  past.length = 0
  future.length = 0
  baseline = take()
  useStore.getState().bumpHist()
}

export function undo() {
  flush()
  if (!past.length) return
  const cur = take()
  const prev = past.pop() as Snapshot
  future.push(cur)
  applySnapshot(prev)
}

export function redo() {
  flush()
  if (!future.length) return
  const cur = take()
  const next = future.pop() as Snapshot
  past.push(cur)
  applySnapshot(next)
}

export function canUndo() {
  return past.length > 0
}

export function canRedo() {
  return future.length > 0
}
