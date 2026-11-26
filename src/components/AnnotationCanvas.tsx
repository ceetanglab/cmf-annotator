import { useEffect, useMemo, useRef, useState, useCallback, type MutableRefObject } from 'react'
import Konva from 'konva'
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Line,
  Circle,
  Text,
  Rect,
  Group,
  Label,
  Tag,
  Arrow,
  Ellipse,
  Transformer
} from 'react-konva'
import { useStore, cmfFromTemplate, INFO_GROUP_ID, EXPORT_RECT_GROUP_ID, BOARDS_BACK_GROUP_ID, infoName, activeBoard } from '../store'
import type { DragBase } from '../store'
import { undo, redo } from '../history'
import { downloadJSON, safeFileName, readImageFile, loadImageElement } from '../lib/io'
import { pagePx, pageAspect, fitRectToAspect, presetShortName, overCanvasLimit, rectContains, nativeDpiFor } from '../lib/presets'
import {
  boardNodeId,
  aspectMatches,
  assignItemsToBoards,
  unionRects,
  DEFAULT_BOARD_DPI,
  DEFAULT_BOARD_FORMAT,
  uniqueFileBase
} from '../lib/artboard'
import { buildPdfFromJpeg } from '../lib/pdf'
import { buildLayeredSvg } from '../lib/svgExport'
import { downloadUrl, downloadBlob } from '../lib/download'
import type { CanvasControls } from '../canvasControls'
import type { Artboard, CMFAnnotation, ExportFormat, ExportRect, ImageItem, ShapeItem, ShapeKind } from '../types'
import { uid } from '../lib/id'
import {
  SHAPE_DEFAULT_BOX,
  SHAPE_DEFAULT_COLOR,
  SHAPE_DEFAULT_STROKE,
  TEXT_LINE_HEIGHT,
  makeShape,
  normalizeShape,
  polylineFromPoints,
  shapeFromDrag,
  shapePointsAbs
} from '../lib/shapes'
import { FONT_STACK, WEIGHT_BOLD, WEIGHT_REGULAR } from '../fonts'
import { clampWmSize, watermarkGap } from '../lib/watermark'
import {
  LABEL_W,
  LABEL_PAD,
  LABEL_TITLE_FONT,
  LABEL_LABEL_FONT,
  LABEL_VALUE_FONT,
  labelLayout,
  labelBoxHeight,
  leaderPoints,
  RED,
  INFO_W,
  INFO_GAP,
  INFO_PAD_X,
  INFO_TITLE_H,
  INFO_TITLE_FONT,
  INFO_LABEL_FONT,
  INFO_VALUE_DY,
  INFO_VALUE_INDENT,
  INFO_FONT,
  INFO_RULE_H,
  infoLayout,
  infoHeight,
  logoSize,
  LINE_W,
  ANCHOR_R,
  LINE_COLOR,
  UI_SELECT,
  UI_REGION,
  arrowHead,
  bounds
} from '../layout'

interface Props {
  stageRef: MutableRefObject<Konva.Stage | null>
  controlsRef: MutableRefObject<CanvasControls | null>
}

// 只保留四角手柄：图片、标注文本框、信息栏都是等比缩放，边中手柄只会把内容拉变形
const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const ALL_ANCHORS = ['top-left', 'top-center', 'top-right', 'middle-right', 'bottom-right', 'bottom-center', 'bottom-left', 'middle-left']

/** 五种形状工具：与 Toolbar 上的按钮一一对应 */
const SHAPE_TOOLS: ShapeKind[] = ['text', 'line', 'polyline', 'circle', 'rect']

/** 两点定大小的三个工具：双击起点 → 移动 → 双击终点（对角线决定大小） */
const SIZE_TOOLS: ShapeKind[] = ['line', 'circle', 'rect']

/** 一次导出的任务：画板 + 它自己的导出参数 */
interface BoardJob {
  board: Artboard
  format: ExportFormat
  dpi: number
  native: boolean
  name: string
}

export default function AnnotationCanvas({ stageRef, controlsRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const dragImgRef = useRef<{ id: string; px: number; py: number; base: DragBase } | null>(null)
  // 标注文本框整组拖动：记录起始位置与其余对象的基线
  const labelDragRef = useRef<{ sx: number; sy: number; base: DragBase } | null>(null)
  // 锚点整组拖动：同上（多选时拖一个锚点，其它文本框与锚点一起走）
  const anchorDragRef = useRef<{ sx: number; sy: number; base: DragBase } | null>(null)
  const panRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null) // 中键平移画布
  // 画板整组拖动：记起始位置，逐帧按位移量写回，避免多块画板累加误差
  const boardDragRef = useRef<{ sx: number; sy: number; base: { id: string; x: number; y: number }[] } | null>(null)
  // 形状整组拖动：与标注文本框同一套「基线 + 位移」逻辑
  const shapeDragRef = useRef<{ sx: number; sy: number; base: DragBase } | null>(null)
  const didFitRef = useRef(false)
  const lastBumpRef = useRef(0) // 上一次自动升版的时间，用于把连续导出合并成一次
  const fitTickRef = useRef(0) // 上一次「贴合内容」的代数，变化时强制精确重算而不是只扩不缩
  const boardCountRef = useRef(0) // 画板数量变了也精确重算一次（单板时按全部内容贴的板子要收回来）

  const [size, setSize] = useState({ w: 800, h: 600 })
  const [imgEls, setImgEls] = useState<Record<string, HTMLImageElement>>({})
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  // 右键上下文菜单：{ 屏幕坐标 x/y, 类型, 目标 id }
  const [ctx, setCtx] = useState<{ x: number; y: number; type: 'image' | 'annotation' | 'shape'; id: string } | null>(null)

  // 多段线是多点逐段画的：单击落一个点、双击收尾；收尾后再单击就是新的一条。
  // draft 存已落下的点（世界坐标），hover 只是从最后一点拖出来的预览终点
  const [draft, setDraft] = useState<{ x: number; y: number }[]>([])
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const draftRef = useRef<{ x: number; y: number }[]>([])
  // 双击自己算时间差：Konva 的 dblclick 在两次 mousedown 之后才发，点位会多塞一个
  const lastDrawRef = useRef<{ t: number; x: number; y: number } | null>(null)
  // 多段线刚收尾的时间：那次双击会继续冒到画布，挡住它，别刚画完又起一条新的
  const polyDoneRef = useRef(0)

  // 直线 / 圆形 / 矩形是「两点定大小」：第一组双击落起点，第二组双击落终点。
  // sizeFrom 是已落下的起点（世界坐标），hover 复用为预览终点，shiftOn 记着约束键
  const [sizeFrom, setSizeFrom] = useState<{ x: number; y: number } | null>(null)
  const sizeFromRef = useRef<{ x: number; y: number } | null>(null)
  const [shiftOn, setShiftOn] = useState(false)
  // 上一次「落终点」的时间：挡住紧接着冒上来的那个 dblclick
  const sizeDoneRef = useRef(0)

  const images = useStore((s) => s.images)
  const info = useStore((s) => s.info)
  const tool = useStore((s) => s.tool)
  const annotations = useStore((s) => s.annotations)
  const shapes = useStore((s) => s.shapes)
  const groups = useStore((s) => s.groups)
  const addImages = useStore((s) => s.addImages)
  const selectedIds = useStore((s) => s.selectedIds)
  const addAnnotation = useStore((s) => s.addAnnotation)
  const updateAnnotation = useStore((s) => s.updateAnnotation)
  const addShape = useStore((s) => s.addShape)
  const updateShape = useStore((s) => s.updateShape)
  const removeShapes = useStore((s) => s.removeShapes)
  const select = useStore((s) => s.select)
  const updateImage = useStore((s) => s.updateImage)
  const moveSelectionBy = useStore((s) => s.moveSelectionBy)
  const removeImage = useStore((s) => s.removeImage)
  const removeAnnotation = useStore((s) => s.removeAnnotation)
  const globalLineWidth = useStore((s) => s.globalLineWidth)
  const globalLineColor = useStore((s) => s.globalLineColor)
  const globalAnchorSize = useStore((s) => s.globalAnchorSize)
  const globalEndStyle = useStore((s) => s.globalEndStyle)
  const infoScale = useStore((s) => s.infoScale)
  const infoPos = useStore((s) => s.infoPos)
  const infoVisible = useStore((s) => s.infoVisible)
  const infoRule = useStore((s) => s.infoRule)
  const logo = useStore((s) => s.logo)
  const watermark = useStore((s) => s.watermark)
  const patchWatermark = useStore((s) => s.patchWatermark)
  const setInfoScale = useStore((s) => s.setInfoScale)
  const setInfoPos = useStore((s) => s.setInfoPos)
  // ---- 画板（原「导出区域」）：一个工程多块 ----
  const artboards = useStore((s) => s.artboards)
  const selectedBoardIds = useStore((s) => s.selectedBoardIds)
  const boardFocus = useStore((s) => s.boardFocus)
  const boardFitTick = useStore((s) => s.boardFitTick)
  const updateBoard = useStore((s) => s.updateBoard)
  const selectBoard = useStore((s) => s.selectBoard)
  const exportName = useStore((s) => s.exportName)
  const setZoom = useStore((s) => s.setZoom)

  // 「自由」比例的画板没有锁定宽高比，拖角点要能真的改形状；
  // 有具体页面规格（A4 / 1:1 / 16:9…）时保持等比，避免拖出「A4 但没那么 A4」的怪比例
  const freeBoard = useMemo(() => {
    if (!boardFocus || selectedBoardIds.length !== 1) return false
    const b = artboards.find((x) => x.id === selectedBoardIds[0])
    return !!b && !pageAspect(b.preset)
  }, [boardFocus, selectedBoardIds, artboards])

  // 单选一个「非文本」形状时，变换框放开长宽：四角 + 四边中都能拖，
  // 只有用户在尺寸栏里按了锁才恢复等比（文本框高度由内容算，不参与）
  const freeShape = useMemo(() => {
    if (boardFocus || selectedIds.length !== 1) return undefined
    return shapes.find((sh) => sh.id === selectedIds[0] && sh.kind !== 'text')
  }, [boardFocus, selectedIds, shapes])

  // 缩放比例同步到 store，供底部缩放条显示
  useEffect(() => {
    setZoom(scale)
  }, [scale, setZoom])

  // 开发环境暴露 stage 与 store，便于端到端交互自测（生产构建会被剔除）
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as any).__cmf = { stage: stageRef.current, store: useStore, controls: controlsRef }
  })

  // 以视口中心为基准缩放（工具栏按钮 / +/- 快捷键走这里）。
  // 滚轮不共用此函数：见下方 onWheel，滚轮以光标位置为基准。
  const zoomBy = useCallback(
    (factor: number) => {
      const stage = stageRef.current
      if (!stage) return
      const oldScale = stage.scaleX()
      const p = stage.position()
      const cx = stage.width() / 2
      const cy = stage.height() / 2
      const mx = (cx - p.x) / oldScale
      const my = (cy - p.y) / oldScale
      const ns = oldScale * factor
      setScale(ns)
      setPos({ x: cx - mx * ns, y: cy - my * ns })
    },
    [stageRef]
  )

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // 加载所有图片元素（多图拼接），并补全缺失的尺寸
  useEffect(() => {
    let cancelled = false
    const missing = images.filter((im) => !imgEls[im.id])
    if (missing.length === 0) return
    Promise.all(
      missing.map(
        (im) =>
          new Promise<[string, HTMLImageElement]>((resolve, reject) => {
            const el = new window.Image()
            el.onload = () => resolve([im.id, el])
            el.onerror = reject
            el.src = im.dataUrl
          })
      )
    )
      .then((loaded) => {
        if (cancelled) return
        setImgEls((prev) => {
          const n = { ...prev }
          for (const [id, el] of loaded) n[id] = el
          return n
        })
        // 旧存档里尺寸可能为 0，用真实加载结果回填
        for (const [id, el] of loaded) {
          const it = images.find((i) => i.id === id)
          if (it && (it.w === 0 || it.h === 0)) updateImage(id, { w: el.width, h: el.height })
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images])

  // 图片被删除后，清理其缓存的 HTMLImageElement
  useEffect(() => {
    setImgEls((prev) => {
      const ids = new Set(images.map((i) => i.id))
      let changed = false
      const n = { ...prev }
      for (const k of Object.keys(n)) {
        if (!ids.has(k)) {
          delete n[k]
          changed = true
        }
      }
      return changed ? n : prev
    })
  }, [images])

  // 品牌标识：单独加载一张 HTMLImageElement（imgEls 只管渲染图，不混用）
  const [logoEl, setLogoEl] = useState<HTMLImageElement | null>(null)
  const logoUrl = logo?.dataUrl ?? ''
  useEffect(() => {
    if (!logoUrl) {
      setLogoEl(null)
      return
    }
    let cancelled = false
    const el = new window.Image()
    el.onload = () => {
      if (!cancelled) setLogoEl(el)
    }
    el.onerror = () => {
      if (!cancelled) setLogoEl(null)
    }
    el.src = logoUrl
    return () => {
      cancelled = true
    }
  }, [logoUrl])

  // 信息栏里 logo 的实际显示尺寸（宽度按比例、高度限幅），版式与包围盒共用
  const logoSz = useMemo(() => logoSize(logo), [logo])

  // 图层可见性：自身眼睛关掉、或所在分组被隐藏 → 不渲染（也不进导出包围盒）
  const hiddenGroupIds = useMemo(
    () => new Set(groups.filter((g) => g.hidden).map((g) => g.id)),
    [groups]
  )
  const visImages = useMemo(
    () => images.filter((im) => !im.hidden && !(im.groupId && hiddenGroupIds.has(im.groupId))),
    [images, hiddenGroupIds]
  )
  const visAnns = useMemo(
    () => annotations.filter((a) => !a.hidden && !(a.groupId && hiddenGroupIds.has(a.groupId))),
    [annotations, hiddenGroupIds]
  )
  const visShapes = useMemo(
    () => shapes.filter((sh) => !sh.hidden && !(sh.groupId && hiddenGroupIds.has(sh.groupId))),
    [shapes, hiddenGroupIds]
  )
  // 图片 / CMF 标注 / 形状共处一套 z 序号：合并成一个序列渲染，谁压谁完全由图层顺序决定
  const drawList = useMemo(() => {
    const list = [
      ...visImages.map((im) => ({ kind: 'image' as const, z: im.z ?? 0, item: im })),
      ...visAnns.map((a) => ({ kind: 'ann' as const, z: a.z ?? 0, item: a })),
      ...visShapes.map((sh) => ({ kind: 'shape' as const, z: sh.z ?? 0, item: sh }))
    ]
    return list.sort((x, y) => x.z - y.z)
  }, [visImages, visAnns, visShapes])

  // 整图 content 包围盒（全部渲染图 + 信息栏，含其缩放与位置；信息栏隐藏时不占位）
  const fullContentRect = useCallback((): ExportRect => {
    // 隐藏的图层不占位：导出的画面和画布上看到的一致
    const { maxR, maxB } = bounds(visImages)
    const ix = infoPos?.x ?? maxR + INFO_GAP
    const iy = infoPos?.y ?? 0
    let left = Math.min(0, ix)
    let top = Math.min(0, iy)
    let right = Math.max(maxR, ix + INFO_W * infoScale)
    let bottom = Math.max(maxB, iy + infoHeight(info.fields, logoSz, logo?.place ?? 'top') * infoScale)
    if (!infoVisible) {
      left = Math.min(0, maxR)
      top = Math.min(0, maxB)
      right = maxR
      bottom = maxB
    }
    // 标注（文本块 + 锚点）同样属于成品内容，否则框体外扩后导出会被裁掉
    for (const a of visAnns) {
      const s = a.scale ?? 1
      const lw = LABEL_W * s
      const lh = labelBoxHeight(a) * s
      left = Math.min(left, a.label.x, a.anchor.x)
      top = Math.min(top, a.label.y, a.anchor.y)
      right = Math.max(right, a.label.x + lw, a.anchor.x)
      bottom = Math.max(bottom, a.label.y + lh, a.anchor.y)
    }
    // 形状标注同样算内容，否则画在取景框外的箭头 / 矩形会被裁掉
    for (const sh of visShapes) {
      left = Math.min(left, sh.x)
      top = Math.min(top, sh.y)
      right = Math.max(right, sh.x + sh.w)
      bottom = Math.max(bottom, sh.y + sh.h)
    }
    return { x: left, y: top, w: right - left, h: bottom - top }
  }, [visImages, visAnns, visShapes, infoPos, infoScale, info, infoVisible, logoSz])

  // 每样内容各自的包围盒（图片 / 信息栏 / 标注 / 形状）。
  // 「跟随内容」按这个把内容分派给各块画板，而不是让每块画板都去框全部内容 ——
  // 两块画板都开跟随内容时，才不会互相把对方的内容吞进来、越贴越大最后叠在一起
  const contentItems = useCallback((): ExportRect[] => {
    const items: ExportRect[] = []
    const { maxR } = bounds(visImages)
    for (const im of visImages) items.push({ x: im.x, y: im.y, w: im.w, h: im.h })
    if (infoVisible) {
      const ix = infoPos?.x ?? maxR + INFO_GAP
      const iy = infoPos?.y ?? 0
      items.push({
        x: ix,
        y: iy,
        w: INFO_W * infoScale,
        h: infoHeight(info.fields, logoSz, logo?.place ?? 'top') * infoScale
      })
    }
    for (const a of visAnns) {
      const sc = a.scale ?? 1
      const lw = LABEL_W * sc
      const lh = labelBoxHeight(a) * sc
      const left = Math.min(a.label.x, a.anchor.x)
      const top = Math.min(a.label.y, a.anchor.y)
      items.push({
        x: left,
        y: top,
        w: Math.max(a.label.x + lw, a.anchor.x) - left,
        h: Math.max(a.label.y + lh, a.anchor.y) - top
      })
    }
    for (const sh of visShapes) items.push({ x: sh.x, y: sh.y, w: sh.w, h: sh.h })
    return items
  }, [visImages, visAnns, visShapes, infoPos, infoScale, info, infoVisible, logoSz])

  const wmText = watermark.text.trim()

  // ---- 自动画布：画板跟着内容走 ----
  // 只在「内容真的越出画板」时向外扩，绝不缩回去 ——
  // 否则用户往左拖一下信息栏，画板就会跟着平移/收缩，看起来像整块区域被拽走了。
  // 想要精确重贴时点面板里的「贴合内容」（boardFitTick +1），那一次允许缩小。
  useEffect(() => {
    if (!artboards.length) return
    // 先把内容按「落在哪块画板里」分派，再让每块画板贴自己那份。
    // 单画板：它框的就是整张内容（含默认挂在图右侧的信息栏），老用法不变。
    // 多画板：只按**渲染图**贴合 —— 标注框 / 形状 / 信息栏本来就容易伸到板外，
    //   把它们算进来自动画布会互相吞内容，两块板最后叠在一起。
    const items = contentItems()
    const pics: ExportRect[] = visImages.map((im) => ({ x: im.x, y: im.y, w: im.w, h: im.h }))
    const single = artboards.length === 1
    const owned = single ? [items] : assignItemsToBoards(items, artboards)
    const ownedPics = single ? [pics] : assignItemsToBoards(pics, artboards)
    const countChanged = boardCountRef.current !== artboards.length
    boardCountRef.current = artboards.length
    const hard = countChanged || fitTickRef.current !== boardFitTick
    fitTickRef.current = boardFitTick
    let changed = false
    const next = artboards.map((b, i) => {
      if (!b.auto) return b
      // 有图就只按图走；板里一张图都没有（纯标注板）才退回按全部内容算
      const content = unionRects(ownedPics[i]) ?? unionRects(owned[i])
      if (!content) return b // 自己框里没东西就原地不动，别去抢别人的
      const a = pageAspect(b.preset)
      const want = a ? fitRectToAspect(content, a) : content
      if (!hard && rectContains(b, content) && aspectMatches(b)) return b
      changed = true
      return { ...b, ...want }
    })
    if (changed) useStore.setState({ artboards: next })
  }, [artboards, contentItems, boardFitTick, visImages])

  // 所有画板的外框（用于「适应视图」「水印铺满」）
  const boardsBox = useCallback((): ExportRect | null => {
    if (!artboards.length) return null
    const left = Math.min(...artboards.map((b) => b.x))
    const top = Math.min(...artboards.map((b) => b.y))
    const right = Math.max(...artboards.map((b) => b.x + b.w))
    const bottom = Math.max(...artboards.map((b) => b.y + b.h))
    return { x: left, y: top, w: right - left, h: bottom - top }
  }, [artboards])

  // 水印铺满「所有画板」的并集：导出是逐块进行的，铺得比单块大只会多出画面外的东西
  const wmRect = useMemo(() => boardsBox() ?? fullContentRect(), [boardsBox, fullContentRect])

  // 平铺水印：离屏 canvas 画一个文字单元，再用 pattern 重复填充整块矩形。
  // 不用「循环 Text」是因为 A4@150DPI 下会有上万个节点，拖动直接卡死；pattern 始终只有一个节点。
  // 按 2 倍分辨率绘制、再用 fillPatternScale 缩回 0.5：导出时 stage 被放大 1.5~2 倍，字仍然清晰。
  const tilePattern = useMemo(() => {
    if (!watermark.on || watermark.mode !== 'tile' || !wmText) return null
    const size = clampWmSize(watermark.size)
    // 间距随密度指数收缩：1 → 12 倍字号（很稀疏），100 → 0.4 倍字号（几乎连成一片）
    const gap = watermarkGap(size, watermark.density)
    const probeFont = `${size}px Arial`
    const cellH = Math.ceil(size * 1.35 + gap * 0.6)
    const probe = new Konva.Text({ text: wmText, fontSize: size, fontFamily: 'Arial' })
    const cellW = Math.ceil(probe.width() + gap)
    probe.destroy()
    const K = 2
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, cellW * K)
    cv.height = Math.max(1, cellH * K)
    const ctx = cv.getContext('2d')
    if (!ctx) return null
    ctx.scale(K, K)
    ctx.font = probeFont
    ctx.fillStyle = '#1f2329'
    ctx.textBaseline = 'middle'
    ctx.fillText(wmText, gap / 2, cellH / 2)
    return { canvas: cv, scale: 1 / K, w: cellW, h: cellH }
  }, [watermark.on, watermark.mode, watermark.text, watermark.size, watermark.density, wmText])

  // 单个水印：没拖动过就自动居中（按文字实际宽高算，避免视觉偏左）
  const wmSingle = useMemo(() => {
    if (!watermark.on || watermark.mode !== 'single' || !wmText) return null
    const size = clampWmSize(watermark.size)
    const probe = new Konva.Text({ text: wmText, fontSize: size, fontFamily: 'Arial' })
    const tw = probe.width()
    const th = probe.height()
    probe.destroy()
    return {
      size,
      w: tw,
      h: th,
      x: watermark.x ?? wmRect.x + (wmRect.w - tw) / 2,
      y: watermark.y ?? wmRect.y + (wmRect.h - th) / 2
    }
  }, [watermark.on, watermark.mode, watermark.text, watermark.size, watermark.x, watermark.y, wmRect, wmText])

  // 适应视图：把「内容 + 所有画板」整体居中铺满（纵向画板会变高，也能完整看到）
  const fitView = useCallback(() => {
    if (Object.keys(imgEls).length === 0) return
    const c = fullContentRect()
    const r = boardsBox() ?? c
    const left = Math.min(c.x, r.x)
    const top = Math.min(c.y, r.y)
    const right = Math.max(c.x + c.w, r.x + r.w)
    const bottom = Math.max(c.y + c.h, r.y + r.h)
    const contentW = Math.max(1, right - left)
    const contentH = Math.max(1, bottom - top)
    const s = Math.min(size.w / contentW, size.h / contentH) * 0.92 || 1
    setScale(s)
    setPos({ x: (size.w - contentW * s) / 2 - left * s, y: (size.h - contentH * s) / 2 - top * s })
  }, [imgEls, size, fullContentRect, boardsBox])

  // 首次加载图片后自动适应一次（之后用户可自由平移/缩放，不再被重置）
  useEffect(() => {
    if (!didFitRef.current && images.length > 0 && Object.keys(imgEls).length > 0) {
      didFitRef.current = true
      fitView()
    }
  }, [images, imgEls, fitView])

  // 实际大小（工具条上的 100%）：以渲染图为准，不掺画板与信息栏 ——
  // 图比窗口小就按 1 像素对 1 像素；图比窗口大（渲染图常见三四千像素）缩到刚好铺满一屏，
  // 免得按下去只剩一个角落。要抠细节请用滚轮 / 底部缩放条放大
  const actualSize = useCallback(() => {
    if (!images.length) {
      setScale(1)
      setPos({ x: 40, y: 40 })
      return
    }
    const left = Math.min(...images.map((i) => i.x))
    const top = Math.min(...images.map((i) => i.y))
    const w = Math.max(1, Math.max(...images.map((i) => i.x + i.w)) - left)
    const h = Math.max(1, Math.max(...images.map((i) => i.y + i.h)) - top)
    const fit = Math.min(size.w / w, size.h / h) * 0.96
    if (fit >= 1) {
      setScale(1)
      setPos({ x: 40, y: 40 })
      return
    }
    setScale(fit)
    setPos({ x: (size.w - w * fit) / 2 - left * fit, y: (size.h - h * fit) / 2 - top * fit })
  }, [images, size])

  // 把视图对到某块画板上（左侧列表点一下就能看到它在哪，窗口小的时候尤其必要）
  const showBoard = useCallback(
    (id: string) => {
      const b = useStore.getState().artboards.find((x) => x.id === id)
      if (!b) return
      const s = Math.min(size.w / Math.max(1, b.w), size.h / Math.max(1, b.h)) * 0.84 || 1
      setScale(s)
      setPos({ x: (size.w - b.w * s) / 2 - b.x * s, y: (size.h - b.h * s) / 2 - b.y * s })
    },
    [size]
  )

  // 出图成功后把「版本号」+0.1 准备下一版；1.5s 内连续导出（PNG 接着 PDF）算同一次，
  // 否则会从 V1.0 一路跳到 V1.2
  const bumpExportVersion = useCallback(() => {
    const now = Date.now()
    if (now - lastBumpRef.current > 1500) {
      lastBumpRef.current = now
      useStore.getState().bumpInfoVersion()
    }
  }, [])

  // 单块画板出图：把 stage 临时缩放/平移到画板范围，抓图后原样还原。
  // 返回 null 表示成功；返回字符串表示失败原因（超尺寸 / 异常），由调用方汇总提示。
  const renderBoard = useCallback(
    async (job: BoardJob): Promise<string | null> => {
      const stage = stageRef.current
      if (!stage) return '画布未就绪'
      const b = job.board
      const r: ExportRect = { x: b.x, y: b.y, w: b.w, h: b.h }
      const isNative = job.native
      const presetPx = isNative ? null : pagePx(b.preset, job.dpi)

      let pageW: number
      let pageH: number
      let fit: number
      let offX: number
      let offY: number
      // 原生模式下把画板原点取整：坐标常带小数，平移带小数会让整张图被重采样一遍，
      // 「1:1」就变成「差不多 1:1」，边缘发糊
      let rx = r.x
      let ry = r.y
      if (isNative) {
        rx = Math.round(r.x)
        ry = Math.round(r.y)
        pageW = Math.max(1, Math.round(r.w))
        pageH = Math.max(1, Math.round(r.h))
        fit = 1
        offX = 0
        offY = 0
      } else if (presetPx) {
        pageW = presetPx.w
        pageH = presetPx.h
        fit = Math.min(pageW / Math.max(1, r.w), pageH / Math.max(1, r.h))
        offX = (pageW - r.w * fit) / 2
        offY = (pageH - r.h * fit) / 2
      } else {
        // 自由比例：画板尺寸 × (DPI/96)
        fit = job.dpi / 96
        pageW = Math.max(1, Math.round(r.w * fit))
        pageH = Math.max(1, Math.round(r.h * fit))
        offX = 0
        offY = 0
      }

      // 分辨率可自定义后，超大输出会把 canvas 撑爆（toDataURL 返回全白图甚至抛错），
      // 这里提前拦下并说清怎么改，比导出一张废图好
      const over = overCanvasLimit(pageW, pageH)
      if (over) {
        return isNative
          ? `「${b.name}」原尺寸输出 ${pageW} × ${pageH} px 超出浏览器画布能力：${over}。请把画板缩小一点，或改用比例 + 较低分辨率。`
          : `「${b.name}」输出尺寸 ${pageW} × ${pageH} px 超出浏览器画布能力：${over}。请降低分辨率，或换用更小的画板比例。`
      }

      // ---- SVG：走矢量分层这条路，不经过位图 ----
      // 渲染图 / 每条标注 / 项目信息栏 / 水印 各是一个 <g>，文字仍是 text，
      // 所以在 Illustrator 里可以逐个选中拖动、直接改字，而不是一张切不开的图。
      if (job.format === 'svg') {
        const svgDpi = isNative ? nativeDpiFor(pageW, b.preset) ?? 96 : job.dpi
        const svg = buildLayeredSvg({
          rect: r,
          title: job.name,
          pageW,
          pageH,
          fit,
          offX,
          offY,
          ptW: (pageW * 72) / svgDpi,
          ptH: (pageH * 72) / svgDpi,
          pageBg: b.bg ?? null,
          images: visImages,
          annotations: visAnns,
          shapes: visShapes,
          info,
          infoPos,
          infoScale,
          infoVisible,
          infoRule,
          logo,
          watermark
        })
        downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${job.name}.svg`)
        return null
      }

      const oldScale = stage.scaleX()
      const oldPos = stage.position()
      const tr = trRef.current
      const trVis = tr ? tr.visible() : false
      if (tr) tr.visible(false)
      const group = stage.findOne('#' + EXPORT_RECT_GROUP_ID)
      const groupVis = group ? group.visible() : false
      if (group) group.visible(false)
      const back = stage.findOne('#' + BOARDS_BACK_GROUP_ID)
      const backVis = back ? back.visible() : false
      if (back) back.visible(false)

      // 底色覆盖整页（放在最底层，避免盖住图片）。
      // 画板没设底色 = 透明：PNG / WebP 就真的不带底；JPEG / PDF 没有透明通道，只能填白。
      const flat = job.format === 'jpeg' || job.format === 'pdf'
      const bgFill = b.bg ?? (flat ? '#ffffff' : null)
      const posX = offX - rx * fit
      const posY = offY - ry * fit
      const bg = bgFill
        ? new Konva.Rect({
            x: (0 - posX) / fit,
            y: (0 - posY) / fit,
            width: pageW / fit,
            height: pageH / fit,
            fill: bgFill
          })
        : null
      stage.scale({ x: fit, y: fit })
      stage.position({ x: posX, y: posY })
      if (bg) {
        stage.getLayers()[0].add(bg)
        bg.moveToBottom()
      }

      // 选中态是编辑器的东西（标注变冷灰、框变粗），不能进成品：
      // 临时清空选中，等 React 把这一帧画出来再抓图，导出完原样还回去
      const prevSel = useStore.getState().selectedIds

      try {
        if (prevSel.length) {
          useStore.setState({ selectedIds: [] })
          await new Promise<void>((r2) => requestAnimationFrame(() => requestAnimationFrame(() => r2())))
        }

        if (job.format === 'pdf') {
          const raster = stage.toDataURL({
            x: 0,
            y: 0,
            width: pageW,
            height: pageH,
            pixelRatio: 1,
            mimeType: 'image/jpeg',
            quality: 0.95
          })
          const b64 = raster.split(',')[1]
          // 原分辨率模式下页面物理尺寸要跟着自动 DPI 走，否则 PDF 会是一张"8 米宽"的纸
          const pdfDpi = isNative ? nativeDpiFor(pageW, b.preset) ?? 96 : job.dpi
          const ptW = (pageW * 72) / pdfDpi
          const ptH = (pageH * 72) / pdfDpi
          downloadBlob(buildPdfFromJpeg(b64, pageW, pageH, ptW, ptH), `${job.name}.pdf`)
        } else {
          const mime =
            job.format === 'jpeg' ? 'image/jpeg' : job.format === 'webp' ? 'image/webp' : 'image/png'
          const uri = stage.toDataURL({
            x: 0,
            y: 0,
            width: pageW,
            height: pageH,
            pixelRatio: 1,
            mimeType: mime,
            quality: 0.95
          })
          downloadUrl(uri, `${job.name}.${job.format}`)
        }
        return null
      } catch (err) {
        return `「${b.name}」导出失败：${err instanceof Error ? err.message : String(err)}`
      } finally {
        if (bg) bg.destroy()
        stage.scale({ x: oldScale, y: oldScale })
        stage.position(oldPos)
        stage.batchDraw()
        if (group) group.visible(groupVis)
        if (back) back.visible(backVis)
        if (tr) tr.visible(trVis)
        if (prevSel.length) useStore.setState({ selectedIds: prevSel })
      }
    },
    [stageRef, visImages, visAnns, info, infoPos, infoScale, infoVisible, infoRule, logo, watermark]
  )

  // 导出：scope=selected 出当前选中的画板，all 出全部。
  // unify=true（默认）时「导出所有画板」统一用当前画板的分辨率与格式 ——
  // 一套交付物通常要一致；个别画板要单独出 SVG 的，把这个开关关掉即可。
  const exportBoards = useCallback(
    async (scope: 'selected' | 'all' = 'selected', unify = true) => {
      if (visImages.length === 0) {
        alert(images.length ? '所有渲染图都被隐藏了，请先在图层里打开至少一张' : '请先导入渲染图')
        return
      }
      const st = useStore.getState()
      const ref = activeBoard(st)
      if (!ref) {
        alert('还没有画板：先在左侧「画板」里新建一块')
        return
      }
      const picked = scope === 'all' ? st.artboards : st.artboards.filter((b) => st.selectedBoardIds.includes(b.id))
      const list = picked.length ? picked : [ref]
      const base = safeFileName(st.exportName || infoName(st.info))

      const multi = list.length > 1
      const used = new Set<string>()
      const jobs: BoardJob[] = list.map((b) => ({
        board: b,
        format: unify ? ref.format ?? DEFAULT_BOARD_FORMAT : b.format ?? ref.format ?? DEFAULT_BOARD_FORMAT,
        dpi: unify ? ref.dpi ?? DEFAULT_BOARD_DPI : b.dpi ?? ref.dpi ?? DEFAULT_BOARD_DPI,
        native: unify ? !!ref.native : !!b.native,
        // 单块：就用「导出设置 → 文件名」；多块：文件名后面缀上画板名，不然会互相覆盖
        name: multi ? uniqueFileBase(`${base}-${safeFileName(b.name)}`, used) : base
      }))

      const fails: string[] = []
      for (let i = 0; i < jobs.length; i += 1) {
        const msg = await renderBoard(jobs[i])
        if (msg) fails.push(msg)
        // 多块连续下载时留一点间隔：浏览器要逐个弹下载，太快会被当成弹窗拦掉
        if (i < jobs.length - 1) await new Promise<void>((r) => setTimeout(r, 260))
      }
      if (fails.length < jobs.length) bumpExportVersion()
      if (fails.length) alert(fails.join('\n\n'))
    },
    [visImages, images, renderBoard, bumpExportVersion]
  )

  // 暴露命令式控制给工具栏 / 导出面板
  useEffect(() => {
    controlsRef.current = {
      fit: fitView,
      actualSize,
      zoomBy,
      showBoard,
      exportBoards
    }
  }, [controlsRef, fitView, actualSize, zoomBy, showBoard, exportBoards])

  // 直接粘贴剪贴板里的图片（截图 / 复制的图）：落到当前视口中心
  // 只接管「剪贴板里真有图片」的情况，复制标注文本时仍走原来的 Ctrl+V
  const pasteImages = useCallback(
    async (files: File[]) => {
      const metas = await Promise.all(
        files.map(async (f) => {
          const { dataUrl, name } = await readImageFile(f)
          const el = await loadImageElement(dataUrl)
          return { dataUrl, name, width: el.width, height: el.height }
        })
      )
      // 视口中心换回 content 坐标；图比视口还大时先缩到八成像素宽，避免一贴就看不见边
      const cx = (size.w / 2 - pos.x) / scale
      const cy = (size.h / 2 - pos.y) / scale
      const maxW = (size.w / scale) * 0.8
      const items: ImageItem[] = metas.map((m, i) => {
        const k = m.width > maxW ? maxW / Math.max(1, m.width) : 1
        const w = Math.max(20, m.width * k)
        const h = Math.max(20, m.height * k)
        return {
          id: uid(),
          dataUrl: m.dataUrl,
          name: m.name && !/^image\d*\.(png|jpe?g|webp)$/i.test(m.name) ? m.name : '粘贴图片',
          x: Math.round(cx - w / 2 + i * 24),
          y: Math.round(cy - h / 2 + i * 24),
          w,
          h
        }
      })
      if (items.length) addImages(items)
    },
    [size.w, size.h, pos.x, pos.y, scale, addImages]
  )

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null
      // 输入框里粘图交给浏览器（比如往 textarea 粘贴不算）
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .filter((f): f is File => !!f)
      if (!files.length) {
        // 剪贴板里不是图片 → 走原来的「粘贴复制的图层」
        useStore.getState().pasteClipboard()
        return
      }
      e.preventDefault()
      void pasteImages(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [pasteImages])

  // 键盘快捷键（输入框聚焦时只保留系统文本操作）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 弹窗（二维码）打开时让位：Esc 由弹窗自己关，Delete 不该删到背后的标注
      if (document.querySelector('.modal-backdrop')) return
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      // 撤销 / 重做
      if (mod && (key === 'z' || key === 'y')) {
        if (typing) return // 输入框内交给浏览器撤销文本
        e.preventDefault()
        if (key === 'y' || (key === 'z' && e.shiftKey)) redo()
        else undo()
        return
      }
      if (typing) return

      const st = useStore.getState()

      if (mod && key === 'a') {
        e.preventDefault()
        st.selectAll()
        return
      }
      if (mod && key === 'd') {
        e.preventDefault()
        st.duplicateSelected()
        return
      }
      // Ctrl+G：把选中的图层归到一个分组（与左栏「分组」按钮同一个动作）
      if (mod && key === 'g') {
        e.preventDefault()
        st.groupSelectedLayers()
        return
      }
      if (mod && key === 'c') {
        st.copySelected()
        return
      }
      // Ctrl+V 不在这里处理：统一交给 paste 事件 —— 剪贴板里是图片就贴图，
      // 是自家复制的内容就粘贴图层，避免一次按键贴出两份
      if (mod && key === 's') {
        e.preventDefault()
        if (st.images.length) downloadJSON(st.exportProject())
        return
      }
      if (mod && (key === '=' || key === '+')) {
        e.preventDefault()
        zoomBy(1.1)
        return
      }
      if (mod && key === '-') {
        e.preventDefault()
        zoomBy(1 / 1.1)
        return
      }
      if (mod && key === '0') {
        e.preventDefault()
        controlsRef.current?.fit()
        return
      }
      if (mod && key === '1') {
        e.preventDefault()
        controlsRef.current?.actualSize()
        return
      }

      if (e.key === 'Escape') {
        st.select(null)
        // 形状工具是「一次性」的：Esc 顺手回到选择，避免下一次点空白又冒出新形状
        if (st.tool !== 'select' && st.tool !== 'callout') st.setTool('select')
        return
      }

      // 画板聚焦时：Delete 删画板、方向键挪画板（画板不属于 selectedIds，得单独接）
      if (st.boardFocus && st.selectedBoardIds.length) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          // 至少留一块：全删掉之后就没有取景框可导出了
          if (st.artboards.length > st.selectedBoardIds.length) st.removeBoards(st.selectedBoardIds)
          return
        }
        if (e.key.startsWith('Arrow')) {
          const step = e.shiftKey ? 10 : 1
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          if (dx || dy) {
            e.preventDefault()
            const ids = st.selectedBoardIds
            useStore.setState({
              artboards: st.artboards.map((b) => (ids.includes(b.id) ? { ...b, x: b.x + dx, y: b.y + dy } : b))
            })
          }
          return
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!st.selectedIds.length) return
        e.preventDefault()
        const ids = [...st.selectedIds]
        for (const id of ids) {
          if (st.images.some((im) => im.id === id)) st.removeImage(id)
          else if (st.annotations.some((a) => a.id === id)) st.removeAnnotation(id)
          else if (st.shapes.some((sh) => sh.id === id)) st.removeShapes([id])
        }
        return
      }

      if (e.key.startsWith('Arrow') && st.selectedIds.length) {
        const step = e.shiftKey ? 10 : 1
        let dx = 0
        let dy = 0
        if (e.key === 'ArrowLeft') dx = -step
        else if (e.key === 'ArrowRight') dx = step
        else if (e.key === 'ArrowUp') dy = -step
        else if (e.key === 'ArrowDown') dy = step
        if (dx || dy) {
          e.preventDefault()
          st.nudgeSelected(dx, dy)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomBy, controlsRef])

  // 仅单选时把 Transformer 绑定过去（多选内容时不显示缩放框，只做对齐/移动）。
  // 画板不同：多选时要整组等比缩放，所以把选中的每一块都绑上去 ——
  // Konva 会按整体包围盒缩放，各块同步位移 + 等比放大。
  useEffect(() => {
    const tr = trRef.current
    if (!tr) return
    const stage = tr.getStage()
    if (!stage) return
    if (boardFocus && selectedBoardIds.length) {
      const nodes = selectedBoardIds
        .map((id) => stage.findOne('#' + boardNodeId(id)))
        .filter((n): n is Konva.Node => !!n)
      if (nodes.length) {
        tr.nodes(nodes)
        tr.getLayer()?.batchDraw()
        return
      }
    }
    const target = !boardFocus && selectedIds.length === 1 ? selectedIds[0] : null
    if (target) {
      const node = stage.findOne('#' + target)
      if (node) {
        tr.nodes([node])
        tr.getLayer()?.batchDraw()
        return
      }
    }
    tr.nodes([])
    tr.getLayer()?.batchDraw()
  }, [selectedIds, annotations, shapes, infoScale, infoPos, artboards, boardFocus, selectedBoardIds])

  const getPos = (e: any) => e.target.getStage().getRelativePointerPosition()

  // 换工具（含 Esc 回选择）就丢掉没画完的半截：多段线的点、两点定形状的起点都清掉，
  // 否则下次进来还挂着上一个工具留下的预览
  useEffect(() => {
    if (tool !== 'polyline') {
      draftRef.current = []
      setDraft([])
    }
    if (!SIZE_TOOLS.includes(tool as ShapeKind)) {
      sizeFromRef.current = null
      setSizeFrom(null)
    }
    setHover(null)
    setShiftOn(false)
    lastDrawRef.current = null
  }, [tool])

  // 多段线收尾：双击那一下会连着落两个点，挨太近的去掉；够两个点才成线
  const finishPolyline = () => {
    const pts: { x: number; y: number }[] = []
    for (const p of draftRef.current) {
      const prev = pts[pts.length - 1]
      if (prev && Math.hypot(p.x - prev.x, p.y - prev.y) < 2) continue
      pts.push(p)
    }
    draftRef.current = []
    setDraft([])
    setHover(null)
    lastDrawRef.current = null
    if (pts.length >= 2) addShape(polylineFromPoints(pts))
    // 收尾后覆盖层会卸载，这次双击的 mousedown 还会冒到画布上：记个时间戳挡住它
    polyDoneRef.current = Date.now()
  }

  // 覆盖层按下：落点或收尾。双击在「还没起手」时只是把起点定住，
  // 再点下一个点才成段——这样双击既能结束，也能从双击处重新开始
  const onDrawDown = (e: any) => {
    if (e.evt.button !== 0) return
    const p = getPos(e)
    const now = Date.now()
    const last = lastDrawRef.current
    const dbl = !!last && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 8
    lastDrawRef.current = { t: now, x: p.x, y: p.y }
    if (dbl) {
      if (draftRef.current.length <= 1) return
      finishPolyline()
      return
    }
    draftRef.current = [...draftRef.current, p]
    setDraft(draftRef.current)
  }

  // 两点定形状的覆盖层按下：这里只负责「落终点」。起点由画布的双击（onDblClick）落下，
  // 覆盖层只在起点落定后才存在，所以单击不会误建形状
  const onSizeDown = (e: any) => {
    if (e.evt.button !== 0) return
    const from = sizeFromRef.current
    if (!from) return
    const p = getPos(e)
    const now = Date.now()
    const last = lastDrawRef.current
    const dbl = !!last && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 8
    lastDrawRef.current = { t: now, x: p.x, y: p.y }
    if (!dbl) return
    const s = shapeFromDrag(tool as ShapeKind, from, p, {
      shift: !!e.evt.shiftKey,
      color: SHAPE_DEFAULT_COLOR,
      strokeWidth: SHAPE_DEFAULT_STROKE
    })
    sizeFromRef.current = null
    setSizeFrom(null)
    setHover(null)
    setShiftOn(false)
    lastDrawRef.current = null
    // 收尾这一下紧接着还会冒一个 dblclick（覆盖层已卸掉，事件落到画布上），
    // 打个时间戳挡住它，否则刚建完就又起一个新起点
    sizeDoneRef.current = now
    if (s) addShape(s)
  }

  const onWheel = (e: any) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const oldScale = stage.scaleX()
    const pointer = stage.getPointerPosition()
    if (!pointer) return
    const mx = (pointer.x - stage.x()) / oldScale
    const my = (pointer.y - stage.y()) / oldScale
    const dir = e.evt.deltaY > 0 ? -1 : 1
    const newScale = dir > 0 ? oldScale * 1.1 : oldScale / 1.1
    setScale(newScale)
    setPos({ x: pointer.x - mx * newScale, y: pointer.y - my * newScale })
  }

  const onStageMouseDown = (e: any) => {
    // Ctrl / ⌘ + 左键：随手退回选择工具。画标注、逐点画多段线到一半时，
    // 不用去够工具条也不用先按 Esc，按住 Ctrl 点一下就回到「选择」，半截的多段线也会丢掉
    if (e.evt.button === 0 && (e.evt.ctrlKey || e.evt.metaKey)) {
      if (tool !== 'select') useStore.getState().setTool('select')
      return
    }
    // 中键：平移画布（空白处）
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      startPan(e)
      return
    }
    // 多段线还没落点时：点空白 / 渲染图就落第一个点（覆盖层这时还没挂上）。
    // 点在形状上不会走到这里 —— 形状自己的 mousedown 已经 cancelBubble 了，
    // 所以形状工具空闲时单击形状仍然是「选中」，和选择工具一样
    if (tool === 'polyline' && !draftRef.current.length && Date.now() - polyDoneRef.current > 400) {
      if (e.evt.button === 0 && !e.evt.shiftKey) {
        const p = getPos(e)
        draftRef.current = [p]
        setDraft([p])
        lastDrawRef.current = null
        return
      }
    }
    if (e.target !== e.target.getStage()) return
    // 空白处左键：清空选择（按住 Shift 时保留当前选择）。
    // 画板是另一套选中状态，得单独清 —— 只清 selectedIds 的话，
    // 多选画板后点空白，画板和缩放框会赖着不走
    if (tool === 'select' && !e.evt.shiftKey) {
      select(null)
      if (useStore.getState().selectedBoardIds.length) selectBoard(null)
    }
  }

  // 取「当前选中对象」的位置基线；excludeId 用于排除由 Konva 自己拖动的那个节点
  // 整组拖动的基线。exclude 指「正被 Konva 拖动的那一个部件」——
  // 它由 Konva 自己更新，不能再按位移写第二遍；但同一条标注的另一个部件要跟着走。
  const dragBase = (exclude?: { id: string; part: 'image' | 'label' | 'anchor' | 'shape' }): DragBase => {
    const st = useStore.getState()
    const ids = st.selectedIds
    return {
      images: st.images
        .filter((im) => ids.includes(im.id) && !(exclude?.part === 'image' && im.id === exclude.id))
        .map((im) => ({ id: im.id, x: im.x, y: im.y })),
      annotations: st.annotations
        .filter((a) => ids.includes(a.id))
        .map((a) => {
          const movingLabel = !(exclude?.part === 'label' && a.id === exclude.id)
          const movingAnchor = !(exclude?.part === 'anchor' && a.id === exclude.id)
          return {
            id: a.id,
            ...(movingLabel ? { x: a.label.x, y: a.label.y } : {}),
            ...(movingAnchor ? { ax: a.anchor.x, ay: a.anchor.y } : {})
          }
        })
        .filter((e) => e.x !== undefined || e.ax !== undefined),
      shapes: st.shapes
        .filter((sh) => ids.includes(sh.id) && !(exclude?.part === 'shape' && sh.id === exclude.id))
        .map((sh) => ({ id: sh.id, x: sh.x, y: sh.y }))
    }
  }

  // 锚点拖动：多选时整组一起动 —— 文本框跟着锚点走，否则一拖就只剩引线在拉长
  const onAnchorDragStart = (id: string) => (e: any) => {
    const st = useStore.getState()
    anchorDragRef.current =
      st.selectedIds.length > 1 && st.selectedIds.includes(id)
        ? { sx: e.target.x(), sy: e.target.y(), base: dragBase({ id, part: 'anchor' }) }
        : null
  }
  const onAnchorDragMove = (id: string) => (e: any) => {
    updateAnnotation(id, { anchor: { x: e.target.x(), y: e.target.y() } })
    const d = anchorDragRef.current
    if (d) moveSelectionBy(d.base, e.target.x() - d.sx, e.target.y() - d.sy)
  }
  const onAnchorDragEnd = () => {
    anchorDragRef.current = null
  }

  // 手动拖拽图片：仅在「选择」模式左键移动（中键改为平移画布，不再移动图片）
  // 图片被多选时，整组一起移动
  const startImgDrag = (id: string, ix: number, iy: number, e: any) => {
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    if (!p) return
    const st = useStore.getState()
    const multi = st.selectedIds.length > 1 && st.selectedIds.includes(id)
    const base: DragBase = multi
      ? dragBase()
      : { images: [{ id, x: ix, y: iy }], annotations: [], shapes: [] }
    dragImgRef.current = {
      id,
      px: (p.x - pos.x) / scale,
      py: (p.y - pos.y) / scale,
      base
    }
  }
  // 中键平移画布（在图片上或空白处均可）
  const startPan = (e: any) => {
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    if (!p) return
    panRef.current = { px: p.x, py: p.y, ox: pos.x, oy: pos.y }
  }
  const onStageMove = (e: any) => {
    // 两点定形状：起点落定后预览跟着光标走。画的时候才挂覆盖层（见下面那个 Layer），
    // 没在画的时候事件照常落到形状上 —— 单击就能选中 / 拖动 / 缩放
    if (sizeFromRef.current) {
      setHover(getPos(e))
      setShiftOn(!!e.evt.shiftKey)
    }
    // 中键平移画布优先
    if (panRef.current) {
      const stage = e.target.getStage()
      const p = stage.getPointerPosition()
      if (!p) return
      setPos({ x: panRef.current.ox + (p.x - panRef.current.px), y: panRef.current.oy + (p.y - panRef.current.py) })
      return
    }
    const d = dragImgRef.current
    if (!d) return
    const stage = e.target.getStage()
    const p = stage.getPointerPosition()
    if (!p) return
    const cx = (p.x - pos.x) / scale
    const cy = (p.y - pos.y) / scale
    moveSelectionBy(d.base, cx - d.px, cy - d.py)
  }
  const endStage = () => {
    dragImgRef.current = null
    panRef.current = null
  }

  // 右键上下文菜单：从点击目标向上查找所属图片 / 标注，弹出「删除」菜单
  const onStageContextMenu = (e: any) => {
    e.evt.preventDefault()
    let n: any = e.target
    let found: { type: 'image' | 'annotation' | 'shape'; id: string } | null = null
    while (n) {
      const id = n.id && n.id()
      if (id) {
        if (images.some((im) => im.id === id)) {
          found = { type: 'image', id }
          break
        }
        if (annotations.some((a) => a.id === id)) {
          found = { type: 'annotation', id }
          break
        }
        if (shapes.some((sh) => sh.id === id)) {
          found = { type: 'shape', id }
          break
        }
      }
      n = n.getParent && n.getParent()
    }
    if (!found) return
    select(found.id)
    const x = Math.min(e.evt.clientX, window.innerWidth - 150)
    const y = Math.min(e.evt.clientY, window.innerHeight - 64)
    setCtx({ x, y, ...found })
  }

  const onDblClick = (e: any) => {
    const t = e.target
    const onStage = t === t.getStage()
    const onImage = t.getClassName && t.getClassName() === 'Image'
    // 形状工具选着的时候双击落在哪里都算「用这个工具起笔」（包括压在已有形状上）；
    // 其余情况只认空白与渲染图，点已有对象时交给它自己的双击行为
    if (!onStage && !onImage && !SHAPE_TOOLS.includes(tool as ShapeKind)) return
    // 直线 / 圆形 / 矩形：双击空白（或渲染图上）落起点，移动时跟出实线预览，
    // 再双击一次才落终点。没在画的时候事件不拦截，形状照样可以直接单击选中
    if (SIZE_TOOLS.includes(tool as ShapeKind)) {
      // 刚收尾的那一下双击别再起一个起点（见 onSizeDown 末尾）
      if (Date.now() - sizeDoneRef.current < 400) return
      const p = getPos(e)
      sizeFromRef.current = p
      setSizeFrom(p)
      setHover(p)
      setShiftOn(!!e.evt.shiftKey)
      lastDrawRef.current = null
      return
    }
    // 文本框：双击空白（或渲染图上）就按默认尺寸落一个（多段线是「单击落点、双击收尾」，见 onDrawDown）
    if (tool === 'text') {
      const p = getPos(e)
      const box = SHAPE_DEFAULT_BOX.text
      addShape(makeShape('text', { x: p.x - box.w / 2, y: p.y - box.h / 2, w: box.w, h: box.h }))
      return
    }
    if (tool === 'callout') {
      const p = getPos(e)
      // 吸附：靠近已有锚点时，对齐到该锚点（阈值随视图缩放换算为内容坐标）
      const snapDist = 12 / scale
      let ax = p.x
      let ay = p.y
      let best = Infinity
      for (const a of annotations) {
        const d = Math.hypot(a.anchor.x - p.x, a.anchor.y - p.y)
        if (d < best) {
          best = d
          ax = a.anchor.x
          ay = a.anchor.y
        }
      }
      if (best > snapDist) {
        ax = p.x
        ay = p.y
      }
      const a: CMFAnnotation = {
        id: uid(),
        anchor: { x: ax, y: ay },
        label: { x: ax + 260, y: Math.max(20, ay - 140) },
        lineWidth: globalLineWidth,
        anchorSize: globalAnchorSize,
        endStyle: globalEndStyle,
        lineColor: globalLineColor,
        cmf: cmfFromTemplate(useStore.getState().annTemplate),
        createdAt: Date.now()
      }
      addAnnotation(a)
    }
  }

  // ---- 形状标注：点选 / 整组拖动 / 拖角缩放 ----
  const onShapePointerDown = (id: string) => (e: any) => {
    const btn = e.evt.button
    // Ctrl / ⌘ + 左键：随手退回选择工具（形状工具选着时点形状也照样生效，
    // 不然这一下会被形状的选中吃掉，退不回去）
    if (btn === 0 && (e.evt.ctrlKey || e.evt.metaKey)) {
      useStore.getState().setTool('select')
      return
    }
    // 中键一律用来平移画布，不吃掉形状本身的拖动
    if (btn === 1) {
      e.cancelBubble = true
      e.evt.preventDefault()
      startPan(e)
      return
    }
    if (btn !== 0) return
    e.cancelBubble = true
    e.evt.preventDefault()
    const st = useStore.getState()
    // 已是多选成员：默认保留整组（便于整体拖动），只有 Shift 才切换该成员
    if (st.selectedIds.length > 1 && st.selectedIds.includes(id)) {
      if (e.evt.shiftKey) select(id, true)
      return
    }
    select(id, e.evt.shiftKey)
  }

  const onShapeDragStart = (id: string) => (e: any) => {
    const st = useStore.getState()
    shapeDragRef.current =
      st.selectedIds.length > 1 && st.selectedIds.includes(id)
        ? { sx: e.target.x(), sy: e.target.y(), base: dragBase({ id, part: 'shape' }) }
        : null
  }
  const onShapeDragMove = (id: string) => (e: any) => {
    const node = e.target
    updateShape(id, { x: node.x(), y: node.y() })
    const d = shapeDragRef.current
    if (d) moveSelectionBy(d.base, node.x() - d.sx, node.y() - d.sy)
  }
  const onShapeDragEnd = () => {
    shapeDragRef.current = null
  }
  const onShapeTransformEnd = (sh: ShapeItem) => (e: any) => {
    const node = e.target
    const sx = node.scaleX()
    const sy = node.scaleY()
    // 缩放只改包围盒尺寸，不把 scale 留在节点上 —— 否则下一次变换会叠乘
    node.scaleX(1)
    node.scaleY(1)
    // 文本框的高度由内容反算（normalizeShape 会做），折线的归一化点整套跟着盒子等比变形
    updateShape(sh.id, {
      x: node.x(),
      y: node.y(),
      w: Math.max(2, sh.w * sx),
      h: Math.max(2, sh.h * sy)
    })
  }

  const onShapeDown = (id: string) => (e: any) => {
    e.cancelBubble = true
    const st = useStore.getState()
    // 已是多选成员：默认保留整组（便于整体拖动），只有 Shift 才切换该成员
    if (st.selectedIds.length > 1 && st.selectedIds.includes(id)) {
      if (e.evt.shiftKey) select(id, true)
      return
    }
    // 按住 Shift 叠加选择
    select(id, e.evt.shiftKey)
  }

  const onTransformEnd = (id: string) => (e: any) => {
    const node = e.target
    const s = node.scaleX()
    updateAnnotation(id, { scale: s, label: { x: node.x(), y: node.y() } })
    node.scaleX(1)
    node.scaleY(1)
  }

  // 信息栏拖拽 / 缩放（多选时随整组一起移动）
  const infoDragRef = useRef<{ sx: number; sy: number; base: DragBase } | null>(null)
  const onInfoDragStart = (e: any) => {
    const st = useStore.getState()
    infoDragRef.current =
      st.selectedIds.length > 1 && st.selectedIds.includes(INFO_GROUP_ID)
        ? { sx: e.target.x(), sy: e.target.y(), base: dragBase() }
        : null
  }
  const onInfoDragMove = (e: any) => {
    setInfoPos({ x: e.target.x(), y: e.target.y() })
    const d = infoDragRef.current
    if (d) moveSelectionBy(d.base, e.target.x() - d.sx, e.target.y() - d.sy)
  }
  const onInfoDragEnd = () => {
    infoDragRef.current = null
  }
  const onInfoTransformEnd = (e: any) => {
    const node = e.target
    const s = node.scaleX()
    setInfoScale(s)
    node.scaleX(1)
    node.scaleY(1)
    setInfoPos({ x: node.x(), y: node.y() })
  }
  const onInfoDown = (e: any) => {
    e.cancelBubble = true
    const st = useStore.getState()
    // 已是多选成员时保留整组，避免按下瞬间把选择收窄
    if (st.selectedIds.length > 1 && st.selectedIds.includes(INFO_GROUP_ID)) {
      if (e.evt.shiftKey) select(INFO_GROUP_ID, true)
      return
    }
    select(INFO_GROUP_ID)
  }

  const imgW = bounds(images).maxR

  // 画板名牌文案：名称 + 实际像素 + 比例（自动画布再点出来，免得以为是「框坏了」）
  const boardTag = (b: Artboard) => {
    const name = presetShortName(b.preset)
    const base = name && name !== '自由' ? name : '自由'
    const auto = b.auto ? ' · 跟随内容' : ''
    const bg = b.bg ? '' : ' · 透明'
    return `${b.name}  ${Math.round(b.w)}×${Math.round(b.h)} · ${base}${auto}${bg}`
  }

  // 单张渲染图的节点：抽成函数，才能和标注一起按 z 排序后统一渲染
  const imgNode = (im: ImageItem) =>
            imgEls[im.id] ? (
              <KonvaImage
                key={im.id}
                id={im.id}
                image={imgEls[im.id]}
                x={im.x}
                y={im.y}
                width={im.w}
                height={im.h}
                onMouseDown={(e) => {
                  const btn = e.evt.button
                  // 中键：平移画布（不再移动图片）
                  if (btn === 1) {
                    e.cancelBubble = true
                    e.evt.preventDefault() // 阻止中键自动滚动
                    startPan(e)
                    return
                  }
                  // 仅「选择」模式左键：移动图片并选中（以便缩放）
                  if (tool !== 'select' || btn !== 0) return
                  e.cancelBubble = true
                  e.evt.preventDefault()
                  // 按住 Shift：叠加 / 取消选择，不进入拖动
                  if (e.evt.shiftKey) {
                    select(im.id, true)
                    return
                  }
                  if (!(selectedIds.length > 1 && selectedIds.includes(im.id))) select(im.id)
                  startImgDrag(im.id, im.x, im.y, e)
                }}
                onTransformEnd={(e) => {
                  const node = e.target
                  const sx = node.scaleX()
                  const sy = node.scaleY()
                  updateImage(im.id, {
                    w: Math.max(20, node.width() * sx),
                    h: Math.max(20, node.height() * sy),
                    x: node.x(),
                    y: node.y()
                  })
                  node.scaleX(1)
                  node.scaleY(1)
                }}
                stroke={selectedIds.includes(im.id) ? UI_SELECT : undefined}
                strokeWidth={selectedIds.includes(im.id) ? 2 : 0}
                onMouseEnter={(e) => {
                  const c = e.target.getStage()?.container()
                  if (c) c.style.cursor = tool === 'callout' && e.evt.button !== 1 ? 'crosshair' : 'move'
                }}
                onMouseLeave={(e) => {
                  const c = e.target.getStage()?.container()
                  if (c) c.style.cursor = tool === 'callout' ? 'crosshair' : 'default'
                }}
              />
            ) : null

  // 单条标注的节点：引线 + 文本块 + 锚点
  const annNode = (a: CMFAnnotation) => {
            const lay = labelLayout(a)
            const sel = selectedIds.includes(a.id)
            const c = sel ? UI_SELECT : a.lineColor ?? LINE_COLOR
            const sc = a.scale ?? 1
            const lw = a.lineWidth ?? LINE_W
            const asz = a.anchorSize ?? ANCHOR_R
            const isArrow = a.endStyle === 'arrow'
            const head = arrowHead(lw, asz)
            return (
              <Group key={a.id}>
                {a.endStyle === 'arrow' ? (
                  <Arrow
                    points={leaderPoints(a)}
                    stroke={c}
                    fill={c}
                    strokeWidth={lw}
                    lineJoin="round"
                    pointerAtBeginning={false}
                    {...head}
                    onMouseDown={onShapeDown(a.id)}
                  />
                ) : (
                  <Line
                    points={leaderPoints(a)}
                    stroke={c}
                    strokeWidth={lw}
                    onMouseDown={onShapeDown(a.id)}
                  />
                )}

                <Group
                  id={a.id}
                  x={a.label.x}
                  y={a.label.y}
                  scaleX={sc}
                  scaleY={sc}
                  draggable
                  onDragStart={(e) => {
                    const st = useStore.getState()
                    labelDragRef.current =
                      st.selectedIds.length > 1 && st.selectedIds.includes(a.id)
                        ? { sx: e.target.x(), sy: e.target.y(), base: dragBase({ id: a.id, part: 'label' }) }
                        : null
                  }}
                  onDragMove={(e) => {
                    const node = e.target
                    updateAnnotation(a.id, { label: { x: node.x(), y: node.y() } })
                    const d = labelDragRef.current
                    if (d) moveSelectionBy(d.base, node.x() - d.sx, node.y() - d.sy)
                  }}
                  onDragEnd={() => {
                    labelDragRef.current = null
                  }}
                  onTransformEnd={onTransformEnd(a.id)}
                  onMouseDown={onShapeDown(a.id)}
                >
                  {/* 透明底 + 默认黑色圆角外框（选中时换成蓝色描边），
                      填充留 0.001 透明度只为保留命中区 */}
                  <Rect
                    width={LABEL_W}
                    height={lay.height}
                    fill="rgba(255,255,255,0.001)"
                    cornerRadius={10}
                    stroke={sel ? c : '#1f2329'}
                    strokeWidth={sel ? 2.5 : 2}
                  />
                  {lay.showTitle ? (
                    <Text
                      x={LABEL_PAD}
                      y={LABEL_PAD}
                      text={lay.title}
                      fontSize={LABEL_TITLE_FONT}
                      fontStyle={WEIGHT_REGULAR}
                      fontFamily={FONT_STACK}
                      lineHeight={1}
                      fill="#1f2329"
                      width={LABEL_W - LABEL_PAD * 2}
                      wrap="word"
                    />
                  ) : null}
                  {lay.rows.map((r) => (
                    <Group key={r.key}>
                      {/* 类目名与内容同一行：内容贴着类目名的实际宽度起排，
                          超宽换行时续行自动对齐到这个 x，形成按类目名长度的悬挂缩进 */}
                      <Text
                        x={LABEL_PAD}
                        y={r.nameY}
                        text={r.label}
                        fontSize={LABEL_LABEL_FONT}
                        fontStyle={WEIGHT_BOLD}
                        fontFamily={FONT_STACK}
                        lineHeight={1}
                        fill="#1f2329"
                        width={LABEL_W - LABEL_PAD * 2}
                        wrap={r.stacked ? 'word' : 'none'}
                      />
                      <Text
                        x={r.valueX}
                        y={r.valueY}
                        text={r.value}
                        fontSize={LABEL_VALUE_FONT}
                        fontStyle={WEIGHT_BOLD}
                        fontFamily={FONT_STACK}
                        lineHeight={1}
                        fill={r.isPlaceholder ? '#aab2bf' : r.accent ? RED : '#5b6270'}
                        width={r.valueW}
                        wrap="word"
                      />
                    </Group>
                  ))}
                </Group>

                {isArrow ? (
                  // 箭头端点本身不好拖，放一个透明热区承接拖拽
                  <Circle
                    x={a.anchor.x}
                    y={a.anchor.y}
                    radius={Math.max(14, head.pointerLength * 0.8)}
                    fill="rgba(0,0,0,0.001)"
                    draggable
                    onDragStart={onAnchorDragStart(a.id)}
                    onDragMove={onAnchorDragMove(a.id)}
                    onDragEnd={onAnchorDragEnd}
                    onMouseDown={onShapeDown(a.id)}
                  />
                ) : (
                  <Circle
                    x={a.anchor.x}
                    y={a.anchor.y}
                    radius={asz}
                    fill={c}
                    draggable
                    onDragStart={onAnchorDragStart(a.id)}
                    onDragMove={onAnchorDragMove(a.id)}
                    onDragEnd={onAnchorDragEnd}
                    onMouseDown={onShapeDown(a.id)}
                  />
                )}
              </Group>
            )
          
  }

  /** 单个形状标注的节点：包围盒挂在 Group 上，内部只用局部坐标 */
  const shapeNode = (sh: ShapeItem) => {
    const sel = selectedIds.includes(sh.id)
    const sw = sh.strokeWidth ?? SHAPE_DEFAULT_STROKE
    const op = sh.opacity ?? 1
    // 近乎透明的填充只用来保留命中区：矩形 / 圆形 / 文本框内部也能点中拖动
    const hit = 'rgba(0,0,0,0.001)'
    const norm = sh.points?.length ? sh.points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    const pts = norm.flatMap((p) => [p.x * sh.w, p.y * sh.h])
    let body: JSX.Element
    if (sh.kind === 'text') {
      body = (
        <>
          <Rect width={sh.w} height={sh.h} fill={hit} />
          <Text
            text={sh.text ?? ''}
            width={sh.w}
            fontSize={sh.fontSize ?? 28}
            fontFamily={FONT_STACK}
            fontStyle={WEIGHT_REGULAR}
            lineHeight={TEXT_LINE_HEIGHT}
            fill={sh.color}
            opacity={op}
            wrap="word"
            listening={false}
          />
        </>
      )
    } else if (sh.kind === 'line' || sh.kind === 'polyline') {
      body = (
        <Line
          points={pts}
          stroke={sh.color}
          strokeWidth={Math.max(0.5, sw)}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(14, sw * 4)}
          opacity={op}
        />
      )
    } else if (sh.kind === 'circle') {
      body = (
        <Ellipse
          x={sh.w / 2}
          y={sh.h / 2}
          radiusX={sh.w / 2}
          radiusY={sh.h / 2}
          fill={sh.fill || hit}
          stroke={sh.color}
          strokeWidth={Math.max(0.5, sw)}
          hitStrokeWidth={Math.max(14, sw * 4)}
          opacity={op}
        />
      )
    } else {
      body = (
        <Rect
          width={sh.w}
          height={sh.h}
          fill={sh.fill || hit}
          stroke={sh.color}
          strokeWidth={Math.max(0.5, sw)}
          hitStrokeWidth={Math.max(14, sw * 4)}
          opacity={op}
        />
      )
    }
    return (
      <Group
        key={sh.id}
        id={sh.id}
        x={sh.x}
        y={sh.y}
        draggable
        onMouseDown={onShapePointerDown(sh.id)}
        onDragStart={onShapeDragStart(sh.id)}
        onDragMove={onShapeDragMove(sh.id)}
        onDragEnd={onShapeDragEnd}
        onTransformEnd={onShapeTransformEnd(sh)}
        onDblClick={(e: any) => {
          // 形状工具选着的时候，双击是「落起点」，冒泡给画布；选择工具下才是「选中 + 改文字」
          if (SHAPE_TOOLS.includes(tool as ShapeKind)) return
          e.cancelBubble = true
          select(sh.id)
          window.dispatchEvent(new CustomEvent('cmf:edit-shape', { detail: { id: sh.id } }))
        }}
      >
        {body}
        {/* 选中框：折线 / 直线本身很细，给一圈虚线包围盒才知道选中的是哪个 */}
        {sel ? (
          <Rect
            x={-2}
            y={-2}
            width={sh.w + 4}
            height={sh.h + 4}
            stroke={UI_SELECT}
            strokeWidth={1.5 / scale}
            dash={[5 / scale, 4 / scale]}
            listening={false}
          />
        ) : null}
      </Group>
    )
  }

  return (
    <div
      ref={wrapRef}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: '100%',
        height: '100%',
        cursor: tool === 'callout' || SHAPE_TOOLS.includes(tool as ShapeKind) ? 'crosshair' : 'default'
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        draggable={tool === 'select'}
        onWheel={onWheel}
        onMouseDown={onStageMouseDown}
        onMouseMove={onStageMove}
        onMouseUp={endStage}
        onMouseLeave={endStage}
        /* 左键空白拖动画布走的是 Konva 自己的 Stage 拖动（不经过 pos 状态）：
           拖动结束同步一次，否则下一次重渲染会把视口按旧坐标弹回去 */
        onDragEnd={(e: any) => {
          // 子节点的 dragend 会冒泡上来，这里只认画布自己被拖
          if (e.target !== e.target.getStage()) return
          const nx = e.target.x()
          const ny = e.target.y()
          if (nx !== pos.x || ny !== pos.y) setPos({ x: nx, y: ny })
        }}
        onDblClick={onDblClick}
        onContextMenu={onStageContextMenu}
      >
        <Layer>
          {/* 每块画板铺一张纸：有底色就用底色，透明底在画布上仍画白纸（否则和白色工作台糊成一片，
              看不出取景范围），导出时才按「透明」处理。
              不参与命中，也不计入内容包围盒（否则会把自动画布顶大一圈） */}
          <Group id={BOARDS_BACK_GROUP_ID} listening={false}>
            {artboards.map((b) => (
              <Rect
                key={b.id}
                name="paper"
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                fill={b.bg ?? '#ffffff'}
                /* 纸面投影：画布压在暖灰工作台上，得有一点阴影才读得出「一张纸」而不是一块白斑。
                   同时给一圈极淡描边，缩得很小时边界也不会糊掉 */
                shadowColor="rgba(27, 31, 46, 0.22)"
                shadowBlur={22}
                shadowOffsetY={6}
                stroke="rgba(27, 31, 46, 0.06)"
                strokeWidth={1}
                listening={false}
              />
            ))}
          </Group>
          {/* 内容层：图片与标注放在同一套层级里，按 z 排序渲染 —— 谁压谁由图层顺序决定 */}
          {drawList.map((d) =>
            d.kind === 'image'
              ? imgNode(d.item as ImageItem)
              : d.kind === 'shape'
                ? shapeNode(d.item as ShapeItem)
                : annNode(d.item as CMFAnnotation)
          )}

          {/* 右侧信息栏（可缩放 / 拖动，可导出；栏目可自由增删）
              版式参考竖版图纸信息栏：大标题 + 粗线，栏目名在上、数值在下 */}
          {visImages.length > 0 && infoVisible && (() => {
            const infoSel = selectedIds.includes(INFO_GROUP_ID)
            const fields = info.fields
            const title = fields[0]?.value || ''
            const layout = infoLayout(fields, logoSz, logo?.place ?? 'top')
            return (
            <Group
              id={INFO_GROUP_ID}
              x={infoPos?.x ?? imgW + INFO_GAP}
              y={infoPos?.y ?? 0}
              scaleX={infoScale}
              scaleY={infoScale}
              draggable
              onDragStart={onInfoDragStart}
              onDragMove={onInfoDragMove}
              onDragEnd={onInfoDragEnd}
              onTransformEnd={onInfoTransformEnd}
              onMouseDown={onInfoDown}
            >
              {/* 透明底：仅保留几乎不可见的命中区（保证空白处也能拖动整栏），
                  不做白底与边框；选中时用描边提示 */}
              <Rect
                width={INFO_W}
                height={layout.height}
                fill="rgba(255,255,255,0.001)"
                cornerRadius={4}
                stroke={infoSel ? UI_SELECT : undefined}
                strokeWidth={infoSel ? 2 : 0}
              />
              {/* 品牌标识：居中放在标题上方，宽度按内宽比例、高度限幅，不参与命中 */}
              {layout.logoBox && logoEl ? (
                <KonvaImage
                  image={logoEl}
                  x={layout.logoBox.x}
                  y={layout.logoBox.y}
                  width={layout.logoBox.w}
                  height={layout.logoBox.h}
                  listening={false}
                />
              ) : null}
              {layout.showTitle && title ? (
                <Text
                  x={INFO_PAD_X}
                  y={layout.titleY}
                  text={title}
                  fontSize={INFO_TITLE_FONT}
                  fontStyle={WEIGHT_BOLD}
                  fontFamily={FONT_STACK}
                  fill="#1f2329"
                  width={INFO_W - INFO_PAD_X * 2}
                  wrap="none"
                  ellipsis
                />
              ) : null}
              {/* 分隔横线：品牌标识置顶时画在标识下方（「公司」块的下边界），否则画在标题下方。
                  标题隐藏或用户关掉开关时一起收掉 */}
              {infoRule && (layout.ruleAnchor === 'logo' || layout.showTitle) ? (
                <Line
                  points={[INFO_PAD_X, layout.ruleY, INFO_W - INFO_PAD_X, layout.ruleY]}
                  stroke="#1f2329"
                  strokeWidth={INFO_RULE_H}
                  listening={false}
                />
              ) : null}
              {layout.rows.map(({ field: fl, y }) => (
                <Group key={fl.id}>
                  <Text
                    x={INFO_PAD_X}
                    y={y}
                    text={fl.label}
                    fontSize={INFO_LABEL_FONT}
                    fontStyle={WEIGHT_BOLD}
                    fontFamily={FONT_STACK}
                    fill="#1f2329"
                    width={INFO_W - INFO_PAD_X * 2}
                    wrap="none"
                    ellipsis
                  />
                  {fl.value ? (
                    <Text
                      x={INFO_PAD_X + INFO_VALUE_INDENT}
                      y={y + INFO_VALUE_DY}
                      text={fl.value}
                      fontSize={INFO_FONT}
                      fontStyle={WEIGHT_REGULAR}
                      fontFamily={FONT_STACK}
                      fill={fl.label.includes('特别说明') ? RED : '#343b47'}
                      width={INFO_W - INFO_PAD_X * 2 - INFO_VALUE_INDENT}
                      wrap="none"
                      ellipsis
                    />
                  ) : null}
                </Group>
              ))}
            </Group>
            )
          })()}

          {/* 画板取景框：每块都能点选 / 拖动 / 拖角点缩放。
              只有边框接收点击（中间是空的），所以点画板内部还是正常选图片、拖标注。
              拖动或缩放后这块画板就不再「跟随内容」，需要跟随可在面板里打开「自动画布」 */}
          <Group id={EXPORT_RECT_GROUP_ID}>
            {artboards.map((b) => {
              const sel = selectedBoardIds.includes(b.id)
              return (
                <Group key={b.id}>
                  <Rect
                    id={boardNodeId(b.id)}
                    x={b.x}
                    y={b.y}
                    width={b.w}
                    height={b.h}
                    /* 只有边框能命中：Konva 的命中画布按 fillEnabled 填充，
                       不显式关掉的话整个矩形内部都会吃掉点击 —— 表现为
                       「画板盖住的地方既选不中图，也拖不动画布」 */
                    fillEnabled={false}
                    stroke={sel ? UI_SELECT : UI_REGION}
                    strokeWidth={(sel ? 2 : 1.5) / scale}
                    dash={
                      sel ? undefined : b.auto ? [5 / scale, 5 / scale] : [8 / scale, 5 / scale]
                    }
                    opacity={sel ? 1 : 0.8}
                    hitStrokeWidth={10 / scale}
                    draggable
                    onMouseDown={(e) => {
                      // Ctrl / ⌘ + 左键：退回选择工具（同形状，别被画板的选中吃掉）
                      if (e.evt.button === 0 && (e.evt.ctrlKey || e.evt.metaKey)) {
                        useStore.getState().setTool('select')
                        return
                      }
                      e.cancelBubble = true
                      // 已在多选里的一员：按下时保持整组（否则一按就只剩这一块，整组拖动失效）
                      if (selectedBoardIds.length > 1 && selectedBoardIds.includes(b.id)) {
                        if (e.evt.shiftKey) selectBoard(b.id, true)
                        return
                      }
                      selectBoard(b.id, e.evt.shiftKey)
                    }}
                    onDragStart={(e) => {
                      // 多选时拖任意一块 = 整组一起走
                      if (selectedBoardIds.length > 1 && selectedBoardIds.includes(b.id)) {
                        boardDragRef.current = {
                          sx: e.target.x(),
                          sy: e.target.y(),
                          base: useStore.getState().artboards.map((x) => ({ id: x.id, x: x.x, y: x.y }))
                        }
                      } else boardDragRef.current = null
                    }}
                    onDragMove={(e) => {
                      const d = boardDragRef.current
                      if (d) {
                        const dx = e.target.x() - d.sx
                        const dy = e.target.y() - d.sy
                        useStore.setState({
                          artboards: useStore.getState().artboards.map((x) => {
                            const base = d.base.find((v) => v.id === x.id)
                            return base ? { ...x, x: base.x + dx, y: base.y + dy, auto: false } : x
                          })
                        })
                      } else {
                        updateBoard(b.id, { x: e.target.x(), y: e.target.y() })
                      }
                    }}
                    onDragEnd={() => {
                      boardDragRef.current = null
                    }}
                    onTransformEnd={(e) => {
                      const n = e.target
                      const w = Math.max(40, n.width() * n.scaleX())
                      const h = Math.max(40, n.height() * n.scaleY())
                      n.scaleX(1)
                      n.scaleY(1)
                      n.width(w)
                      n.height(h)
                      updateBoard(b.id, { x: n.x(), y: n.y(), w, h })
                    }}
                  />
                  {/* 名牌：随缩放保持固定屏幕字号，跟着画板左上角走 */}
                  <Group x={b.x} y={b.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
                    <Label x={0} y={-23} opacity={sel ? 1 : 0.9}>
                      <Tag fill={sel ? UI_SELECT : b.auto ? 'rgba(74,85,104,0.72)' : UI_REGION} cornerRadius={3} />
                      <Text text={boardTag(b)} fontSize={11} fill="#ffffff" padding={5} />
                    </Label>
                  </Group>
                </Group>
              )
            })}
          </Group>

          {/* 全局水印：画在最上层，导出时原样带出。
              平铺 = 一个 pattern 矩形（节点数恒为 1）；单个 = 可拖动文字 */}
          {watermark.on && wmText ? (
            watermark.mode === 'tile' && tilePattern ? (
              <Rect
                x={wmRect.x}
                y={wmRect.y}
                width={wmRect.w}
                height={wmRect.h}
                fillPatternImage={tilePattern.canvas as unknown as HTMLImageElement}
                fillPatternRepeat="repeat"
                fillPatternScale={{ x: tilePattern.scale, y: tilePattern.scale }}
                opacity={watermark.opacity}
                listening={false}
              />
            ) : wmSingle ? (
              // 外层 Group 承担拖动，命中区是下面的透明矩形：
              // Text 默认只有字形笔画能命中，中文字形空隙多，点空隙会「透过」到下层，表现为拖不动
              <Group
                x={wmSingle.x}
                y={wmSingle.y}
                draggable
                onMouseDown={(e) => {
                  e.cancelBubble = true
                }}
                onDragEnd={(e) => patchWatermark({ x: e.target.x(), y: e.target.y() })}
                onMouseEnter={(e) => {
                  const c = e.target.getStage()?.container()
                  if (c) c.style.cursor = 'move'
                }}
                onMouseLeave={(e) => {
                  const c = e.target.getStage()?.container()
                  if (c) c.style.cursor = 'default'
                }}
              >
                <Text
                  text={wmText}
                  fontSize={wmSingle.size}
                  fontFamily="Arial"
                  fill="#1f2329"
                  opacity={watermark.opacity}
                  listening={false}
                />
                <Rect width={wmSingle.w} height={wmSingle.h} fill="rgba(0,0,0,0.001)" />
              </Group>
            ) : null
          ) : null}

          <Transformer
            ref={trRef}
            rotateEnabled={false}
            // 等比缩放：图片不能被拉扁，标注文本框与信息栏本身就是等比（只写 scaleX），
            // 放开比例只会让拖动过程显示变形、松手又弹回。
            // 例外是「自由」画板——它没有页面规格，等比就失去意义了
            keepRatio={freeShape ? !!freeShape.lockRatio : !freeBoard}
            // 形状可以自由拉长宽：八只手柄都放出来；其余对象仍只留四角
            enabledAnchors={freeShape ? ALL_ANCHORS : CORNER_ANCHORS}
            // 拖过头会把图片翻面（镜像），CMF 表里等于换了产品朝向，直接禁掉
            flipEnabled={false}
            anchorStroke={UI_SELECT}
            anchorFill="#ffffff"
            borderStroke={UI_SELECT}
            boundBoxFunc={(oldBox, newBox) =>
              newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
            }
          />
        </Layer>

        {/* 多段线的绘制层：只在**已经落点**之后才挂 —— 空闲时它不存在，
            形状和图片照常可以点选中；挂上以后按下都落在它身上，
            不会误选中 / 拖动下面的图。预览线与成品同色同粗细（实线） */}
        {tool === 'polyline' && draft.length ? (
          <Layer>
            {draft.length ? (
              <>
                <Line
                  points={[...draft, hover ?? draft[draft.length - 1]].flatMap((p) => [p.x, p.y])}
                  stroke={SHAPE_DEFAULT_COLOR}
                  strokeWidth={Math.max(0.5, SHAPE_DEFAULT_STROKE)}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                />
                {draft.map((p, i) => (
                  <Circle
                    key={i}
                    x={p.x}
                    y={p.y}
                    radius={3 / scale}
                    fill="#ffffff"
                    stroke={SHAPE_DEFAULT_COLOR}
                    strokeWidth={1.5 / scale}
                    listening={false}
                  />
                ))}
              </>
            ) : null}
            <Rect
              x={-pos.x / scale}
              y={-pos.y / scale}
              width={size.w / scale}
              height={size.h / scale}
              fill="rgba(0,0,0,0.001)"
              onMouseDown={onDrawDown}
              onMouseMove={(e: any) => {
                if (draft.length) setHover(getPos(e))
              }}
            />
          </Layer>
        ) : null}

        {/* 直线 / 圆形 / 矩形的绘制层：**只在画的时候挂**（起点已落定）。
            没在画的时候它根本不存在，事件照常落到形状上 —— 形状工具下也能
            单击选中、拖动、拖角缩放，和选择工具一样 */}
        {SIZE_TOOLS.includes(tool as ShapeKind) && sizeFrom ? (
          <Layer>
            {(() => {
              const s = hover ? shapeFromDrag(tool as ShapeKind, sizeFrom, hover, { shift: shiftOn }) : null
              if (!s) return null
              // 预览就是最终的样子：实线 + 和成品一样的粗细，不再用虚线示意
              const lw = Math.max(0.5, SHAPE_DEFAULT_STROKE)
              if (s.kind === 'line') {
                const pts = shapePointsAbs(s)
                return (
                  <Line
                    points={pts.flatMap((p) => [p.x, p.y])}
                    stroke={SHAPE_DEFAULT_COLOR}
                    strokeWidth={lw}
                    lineCap="round"
                    listening={false}
                  />
                )
              }
              if (s.kind === 'circle') {
                return (
                  <Ellipse
                    x={s.x + s.w / 2}
                    y={s.y + s.h / 2}
                    radiusX={s.w / 2}
                    radiusY={s.h / 2}
                    stroke={SHAPE_DEFAULT_COLOR}
                    strokeWidth={lw}
                    listening={false}
                  />
                )
              }
              return (
                <Rect
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  stroke={SHAPE_DEFAULT_COLOR}
                  strokeWidth={lw}
                  listening={false}
                />
              )
            })()}
            <Circle
              x={sizeFrom.x}
              y={sizeFrom.y}
              radius={4 / scale}
              fill="#ffffff"
              stroke={SHAPE_DEFAULT_COLOR}
              strokeWidth={1.5 / scale}
              listening={false}
            />
            <Rect
              x={-pos.x / scale}
              y={-pos.y / scale}
              width={size.w / scale}
              height={size.h / scale}
              fill="rgba(0,0,0,0.001)"
              onMouseDown={onSizeDown}
              onMouseMove={(e: any) => {
                setHover(getPos(e))
                setShiftOn(!!e.evt.shiftKey)
              }}
            />
          </Layer>
        ) : null}
      </Stage>

      {/* 右键上下文菜单 */}
      {ctx && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setCtx(null)} onContextMenu={(e) => { e.preventDefault(); setCtx(null) }} />
          <div className="ctx-menu" style={{ left: ctx.x, top: ctx.y }} onContextMenu={(e) => e.preventDefault()}>
            <div
              className="ctx-item danger"
              onClick={() => {
                if (ctx.type === 'image') removeImage(ctx.id)
                else if (ctx.type === 'shape') removeShapes([ctx.id])
                else removeAnnotation(ctx.id)
                setCtx(null)
              }}
            >
              删除{ctx.type === 'image' ? '图片' : ctx.type === 'shape' ? '形状' : '标注'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
