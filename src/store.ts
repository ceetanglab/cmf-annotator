import { create } from 'zustand'
import type { AnchorStyle, AnnTemplate, Artboard, CMFAnnotation, CMFMeta, CMFProject, CMFRow, CMFTemplate, ExportFormat, ExportRect, ImageItem, InfoField, LayerGroup, LogoMeta, ProjectInfo, ShapeItem, WatermarkMeta } from './types'
import { LABEL_W, labelBoxHeight, LINE_W, ANCHOR_R, LINE_COLOR, infoScaleForImages } from './layout'
import { applyCmfRows, cmfRows, isBuiltinCmfKey, newCmfRow } from './lib/cmfRows'
import { uid } from './lib/id'
import { pageAspect, fitRectToAspect, clampDpi, DPI_OPTIONS } from './lib/presets'
import { BOARD_GAP, DEFAULT_BOARD_DPI, DEFAULT_BOARD_FORMAT, DEFAULT_BOARD_PRESET, boardFromContent, makeBoard, nextBoardName, refitBoard, safePreset } from './lib/artboard'
import { loadTemplates, saveTemplates, loadAnnTemplate, saveAnnTemplate, normalizeTemplate } from './lib/templates'
import { upgradeWatermark, WM_DENSITY_VERSION } from './lib/watermark'
import { normalizeShape, polylineFromPoints } from './lib/shapes'
import { toColorCode } from './lib/pantone'

export type Tool = 'select' | 'callout' | 'text' | 'line' | 'polyline' | 'rect' | 'circle'
export type AlignDir = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'

// 拖动起始快照：整组移动时以它为准，避免逐帧累加误差。
// 标注的文本块和锚点是两个能各自拖动的位置，所以分开记：
// x/y = 文本块起始位置，ax/ay = 锚点起始位置；缺省的那一项表示「不跟着动」
// （单独拖文本框时，那个框本身由 Konva 负责，不能再按位移写一遍）
export interface DragBase {
  images: { id: string; x: number; y: number }[]
  annotations: { id: string; x?: number; y?: number; ax?: number; ay?: number }[]
  shapes: { id: string; x: number; y: number }[]
}

export const emptyCMF = (): CMFAnnotation['cmf'] => ({
  name: '',
  color: 'Cool Gray 3 C',
  material: '',
  finish: '',
  process: '',
  note: ''
})

// 本地日期 YYYY.MM.DD：toISOString 走 UTC，北京时间清晨会差一天，这里用本地时间拼
export function todayStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

export const emptyInfo = (): ProjectInfo => ({
  fields: [
    { id: uid(), label: '公司', value: '' },
    { id: uid(), label: '部门', value: '' },
    { id: uid(), label: '项目', value: '' },
    { id: uid(), label: '设计师', value: '' },
    { id: uid(), label: '版本号', value: 'V1.0' },
    { id: uid(), label: '时间', value: todayStamp() },
    { id: uid(), label: '颜色', value: '' },
    { id: uid(), label: '材质', value: '' },
    { id: uid(), label: '工艺', value: '' },
    { id: uid(), label: '制作工序', value: '' },
    { id: uid(), label: '特别说明', value: '' }
  ]
})

// 水印默认值：默认关闭；平铺模式 + 浅灰半透明，文案给一个通用的内部稿标记，打开即用
export const emptyWatermark = (): WatermarkMeta => ({
  on: false,
  mode: 'tile',
  text: 'CMF · 内部评审稿',
  size: 22,
  density: 50,
  densityV: WM_DENSITY_VERSION,
  opacity: 0.12
})

// 项目信息栏的标准栏目（第 7~11 项是 CMF 字段，与「选中对象」的默认栏目同名）
const INFO_FIELD_LABELS = ['公司', '部门', '项目', '设计师', '版本号', '时间']
const CMF_FIELD_LABELS = ['颜色', '材质', '工艺', '制作工序', '特别说明']

// ---- 自动维护的两个栏目：时间（打开工程时刷新为当天）、版本号（每次导出后 +0.1）
// 认栏目名而不是认 id，用户改名成「日期 / 版本」也能命中；改叫别的名字即视为普通栏目，不再自动动它。
const DATE_LABELS = ['时间', '日期', 'date']
const VERSION_LABELS = ['版本号', '版本', 'version']
export const isAutoDateLabel = (label: string) => DATE_LABELS.includes(label.trim().toLowerCase())
export const isAutoVersionLabel = (label: string) => VERSION_LABELS.includes(label.trim().toLowerCase())

// 打开工程时把「时间」刷成当天；已经是当天就原样返回，避免多余的状态更新
export function refreshInfoDate(info: ProjectInfo, stamp = todayStamp()): ProjectInfo {
  let changed = false
  const fields = info.fields.map((f) => {
    if (!isAutoDateLabel(f.label) || f.value === stamp) return f
    changed = true
    return { ...f, value: stamp }
  })
  return changed ? { ...info, fields } : info
}

// 版本号 +0.1：V1.0 → V1.1 … V1.9 → V2.0；V1.10 这类多段编号只末段 +1；
// 认不出的写法（V1.0-final、Final 等）原样返回，绝不破坏用户自己的编号体系
export function bumpVersionValue(v: string): string {
  const m = /^(\s*[vV]?\s*)(\d+)(?:\.(\d+))?\s*$/.exec(v)
  if (!m) return v
  const [, prefix, majorRaw, minorRaw] = m
  let major = Number(majorRaw)
  const width = minorRaw ? minorRaw.length : 0
  let minor = (minorRaw ? Number(minorRaw) : 0) + 1
  if (width > 1) return `${prefix}${major}.${String(minor).padStart(width, '0')}`
  if (minor > 9) {
    major += 1
    minor = 0
  }
  return `${prefix}${major}.${minor}`
}

// 旧版结构化 ProjectInfo → 新版 fields 数组（含首行标题）
function toInfo(p: CMFProject): ProjectInfo {
  const raw = (p as unknown as { info?: any }).info
  if (raw && Array.isArray(raw.fields) && raw.fields.length > 0) {
    // 上一版曾把 颜色/材质/工艺/制作工序/特别说明 从信息栏清掉，这里把被清空的工程补回来。
    // 只认「正好是标准 6 行、没有自定义行」这一种特征，有自定义行的工程一律不动。
    const labels = raw.fields.map((f: InfoField) => String(f.label || '').trim())
    const cleaned =
      raw.fields.length === INFO_FIELD_LABELS.length && labels.every((l: string, i: number) => l === INFO_FIELD_LABELS[i])
    if (cleaned) {
      return {
        fields: [
          ...raw.fields,
          ...CMF_FIELD_LABELS.map((label) => ({ id: uid(), label, value: '' }))
        ]
      }
    }
    return { fields: raw.fields }
  }
  const order: [string, string][] = [
    ['company', '公司'],
    ['department', '部门'],
    ['project', '项目'],
    ['designer', '设计师'],
    ['version', '版本号'],
    ['date', '时间'],
    ['color', '颜色'],
    ['material', '材质'],
    ['finish', '工艺'],
    ['process', '制作工序'],
    ['requirement', '特别说明']
  ]
  const fields = order.map(([k, label]) => ({
    id: uid(),
    label,
    value: (raw && typeof raw[k] === 'string' ? raw[k] : '') as string
  }))
  return { fields }
}

interface State {
  images: ImageItem[]
  info: ProjectInfo
  tool: Tool
  annotations: CMFAnnotation[]
  /** 标注形状：文本框 / 直线 / 折线 / 矩形 / 圆形，与图片、标注共用一套 z */
  shapes: ShapeItem[]
  /** 图层分组（图片与标注都可归组；只是归类，不改对象坐标） */
  groups: LayerGroup[]
  selectedIds: string[] // 多选（Shift 点选叠加）
  // 全局引线样式（改一处，所有标注同步）
  globalLineWidth: number
  globalAnchorSize: number
  globalEndStyle: AnchorStyle // 引线端点样式（圆点 / 箭头）
  globalLineColor: string // 引线与锚点颜色（同步到全部标注）
  // 右侧信息栏整体状态（可选缩放 / 位置）
  infoScale: number
  /** 尺寸是否仍跟随图片自动定（用户手动缩放过、或套用了模板 → false，不再自动改） */
  infoScaleAuto: boolean
  infoPos: { x: number; y: number } | null
  infoVisible: boolean // 信息栏显示开关（眼睛）
  infoRule: boolean    // 标题下横线显示开关
  logo: LogoMeta | null // 信息栏顶部的品牌标识
  // 水印：全局选项，作用于整张图（单个可拖动 / 平铺重复）
  watermark: WatermarkMeta
  // ---- 画板（原「导出区域」）：一个工程可以有多块，各自独立出图 ----
  artboards: Artboard[]
  /** 选中的画板（多选用于批量改比例 / 底色；始终至少有一块） */
  selectedBoardIds: string[]
  /** 右侧面板是否聚焦到画板：点画板 / 点画板行置 true，选对象或点空白置 false */
  boardFocus: boolean
  /** 「贴合内容」的强制重算信号：+1 让画布把选中的画板精确包住内容（平时只扩不缩） */
  boardFitTick: number
  // 导出文件名（不含扩展名）：默认「CMF 总表」，导出时按格式补 .png / .pdf / .svg
  exportName: string
  // 视图缩放（画布同步过来，供底部缩放条显示）
  zoom: number
  // 撤销/重做栈版本号（变化即说明历史栈有更新，用于按钮可用态）
  histTick: number
  // 顶部工具条「导出设置」的触发计数：+1 即让左下角那块分组展开并滚到可见处
  setZoom: (v: number) => void
  bumpHist: () => void
  addImages: (items: ImageItem[]) => void
  updateImage: (id: string, patch: Partial<ImageItem>) => void
  removeImage: (id: string) => void
  /** 图片显示 / 隐藏（图层眼睛，与标注同一个入口） */
  setImageVisible: (id: string, v: boolean) => void
  /* ---- 图层层级与分组 ---- */
  /** 把某个图层（或整个分组）拖到另一个图层的前 / 后 */
  reorderLayers: (dragId: string, targetId: string, place: 'before' | 'after') => void
  /** 把当前选中的图层（≥2 个）归到一个新分组 */
  groupSelectedLayers: () => void
  /** 解散分组（组内对象保留在画布上） */
  ungroupLayer: (groupId: string) => void
  renameLayerGroup: (groupId: string, name: string) => void
  setGroupVisible: (groupId: string, v: boolean) => void
  toggleGroupCollapsed: (groupId: string) => void
  /* ---- 画板 ---- */
  /** 新建一块画板：rect 省略时在内容右侧排一块，比例默认 A4 横向 */
  addBoard: (preset?: string, rect?: ExportRect) => Artboard | null
  /** 按内容重新造一块画板（「新建画板」按钮的默认行为） */
  addBoardFromContent: (preset?: string) => Artboard | null
  removeBoards: (ids: string[]) => void
  duplicateBoard: (id: string) => void
  renameBoard: (id: string, name: string) => void
  /** 改画板：手动拖动 / 缩放会自动退出「跟随内容」 */
  updateBoard: (id: string, patch: Partial<Artboard>, opts?: { keepAuto?: boolean }) => void
  selectBoard: (id: string | null, additive?: boolean) => void
  selectAllBoards: () => void
  /** 右侧切到「画板」页（不改变当前选择） */
  focusBoards: () => void
  /** 批：把选中的画板改成同一比例（中心不动，只扩不裁） */
  setBoardPreset: (preset: string) => void
  /** 批：把选中的画板改成同一底色；undefined = 透明 */
  setBoardBg: (bg: string | undefined) => void
  /** 批：导出设置（格式 / DPI / 原分辨率），作用于选中的画板 */
  setBoardExport: (patch: { format?: ExportFormat; dpi?: number; dpiCustom?: boolean; native?: boolean }) => void
  /** 让选中的画板重新精确包住内容（平时画板只扩不缩） */
  fitBoardsToContent: () => void
  clearCanvas: () => void
  setInfo: (patch: Partial<ProjectInfo>) => void
  addInfoField: () => void
  updateInfoField: (id: string, patch: Partial<InfoField>) => void
  removeInfoField: (id: string) => void
  /** 拖动排序：把第 from 个栏目移动到第 to 个位置 */
  moveInfoField: (from: number, to: number) => void
  /** 「版本号」栏目 +0.1（导出成功后自动调用） */
  bumpInfoVersion: () => void
  // 栏目名预设（下拉可选回默认栏目名 / 自定义默认值）
  labelPresets: string[]      // 项目信息栏
  addLabelPreset: (label: string) => void
  removeLabelPreset: (label: string) => void
  cmfPresets: string[]        // 选中对象（标注栏目）
  addCmfPreset: (label: string) => void
  removeCmfPreset: (label: string) => void
  setTool: (t: Tool) => void
  addAnnotation: (a: CMFAnnotation) => void
  updateAnnotation: (id: string, patch: Partial<CMFAnnotation>) => void
  removeAnnotation: (id: string) => void
  /* ---- 标注形状（文本框 / 直线 / 折线 / 矩形 / 圆形） ---- */
  addShape: (sh: ShapeItem) => void
  updateShape: (id: string, patch: Partial<ShapeItem>) => void
  setShapeVisible: (id: string, v: boolean) => void
  removeShapes: (ids: string[]) => void
  /** 图层显隐（眼睛） */
  setAnnotationVisible: (id: string, v: boolean) => void
  /** 单条标注的引线颜色；传 null = 恢复「跟随全局」 */
  setAnnLineColor: (id: string, color: string | null) => void
  /* ---- 标注栏目行（右侧「选中对象」面板）：排序 / 改名 / 增删 / 隐藏 ---- */
  patchAnnRow: (
    id: string,
    key: string,
    patch: { label?: string; value?: string; hidden?: boolean; slash?: boolean }
  ) => void
  /** 拖动排序：把第 from 行移动到第 to 个位置 */
  moveAnnRow: (id: string, from: number, to: number) => void
  /** 增加一行自定义栏目 */
  addAnnRow: (id: string) => void
  /** 删除某一行（内置字段同时清空其值，避免图层副标题残留） */
  removeAnnRow: (id: string, key: string) => void
  /** 恢复默认五栏（顺序 / 名称 / 隐藏状态全部还原） */
  resetAnnRows: (id: string) => void
  /** 把某一行的内容提升为「名称」（标题），该行不再作为栏目，名称行回到顶部 */
  setAnnName: (id: string, fromKey: string) => void
  select: (id: string | null, additive?: boolean) => void
  selectAll: () => void
  // 复制 / 粘贴 / 复制副本 / 方向键微调
  copySelected: () => void
  pasteClipboard: () => void
  duplicateSelected: () => void
  nudgeSelected: (dx: number, dy: number) => void
  // 整组拖动：按拖动起始快照 + 位移量一次性更新（图片位置 / 标注文本块位置）
  moveSelectionBy: (base: DragBase, dx: number, dy: number) => void
  // 对齐 / 等距分布（作用于当前选中的图片与标注文本块）
  align: (dir: AlignDir) => void
  distribute: (axis: 'h' | 'v') => void
  // 全局样式：写入默认值并同步到所有已存在的标注
  applyGlobalStyle: (patch: { lineWidth?: number; anchorSize?: number; endStyle?: AnchorStyle; lineColor?: string }) => void
  setInfoScale: (s: number) => void
  setInfoVisible: (v: boolean) => void
  setInfoRule: (v: boolean) => void
  setInfoPos: (p: { x: number; y: number }) => void
  setLogo: (l: LogoMeta | null) => void
  patchWatermark: (patch: Partial<WatermarkMeta>) => void
  setExportName: (v: string) => void
  loadProject: (p: CMFProject) => void
  exportProject: () => CMFProject
  /* ---- 模板：保存 / 应用 / 导入一套全局 + 标注设置 ---- */
  templates: CMFTemplate[]
  /** 新建标注时套用的栏目结构（来自最近一次应用的模板） */
  annTemplate: AnnTemplate | null
  /** 把当前设置存成模板（引线取全局值，栏目结构取选中/第一条标注） */
  saveTemplate: (name: string) => CMFTemplate | null
  /** 套用模板：引线同步到已有标注，栏目结构用于以后新建的标注 */
  applyTemplate: (t: CMFTemplate) => void
  deleteTemplate: (id: string) => void
  renameTemplate: (id: string, name: string) => void
  /** 导入 .json 模板（会分配新 id，重名自动加序号） */
  importTemplate: (raw: unknown) => CMFTemplate | null
}

export const INFO_GROUP_ID = '__info__'
/** 画板框的 Konva 节点 id（Transformer 靠它找节点）放在 lib/artboard.ts 里统一生成 */
export const EXPORT_RECT_GROUP_ID = '__boards__'
export const BOARDS_BACK_GROUP_ID = '__boards_back__'

// 取信息栏用作文件名：优先「项目」栏目，其次首行标题
export function infoName(info: ProjectInfo): string {
  return (
    info.fields.find((f) => f.label === '项目')?.value?.trim() ||
    info.fields[0]?.value?.trim() ||
    '未命名项目'
  )
}

/** 把项目名写进信息栏的「项目」栏（没有这一栏就补一条），导入 / 新建时统一走这里 */
export function withProjectName(p: CMFProject, name: string): CMFProject {
  const info = toInfo(p)
  const fields = info.fields.length ? info.fields : [{ id: uid(), label: '项目', value: '' }]
  const at = Math.max(0, fields.findIndex((f) => f.label === '项目'))
  return { ...p, info: { fields: fields.map((f, i) => (i === at ? { ...f, value: name } : f)) } }
}

/**
 * 导入的工程里没写项目名时，用磁盘文件名补上。
 * 导出的文件名本来就跟着项目名走，所以「怒怒.json」导进来还叫「怒怒」，前后对得上。
 * 工程自己写了项目名（不是默认值）就尊重它，不改。
 */
export function nameProjectFromFile(p: CMFProject, fileName: string): CMFProject {
  const name = fileName.replace(/\.json$/i, '').trim().slice(0, 60)
  if (!name) return p
  const info = toInfo(p)
  const field = info.fields.find((f) => f.label === '项目')
  if (field?.value.trim()) return p
  // 没有「项目」这一栏、而首行标题已经有内容时也不硬塞，避免把公司名冲掉
  if (!field && info.fields[0]?.value.trim()) return p
  return withProjectName(p, name)
}

/**
 * 给默认名字排队：未命名项目-01、-02、-03……
 * 窗口之间互不通气，只能拿「库里已有的工程名」当已占用的坑位，
 * 这样「最近工程」列表里不会出现一长串一模一样的名字。
 */
export function nextProjectName(taken: string[], base = '未命名项目'): string {
  const used = new Set(taken.map((n) => (n || '').trim()))
  for (let i = 1; i < 999; i++) {
    const n = `${base}-${String(i).padStart(2, '0')}`
    if (!used.has(n)) return n
  }
  return `${base}-${Date.now().toString(36).slice(-4)}`
}

/** 导出文件名的出厂值：留空就是「跟项目名走」，不用维护第二份名字 */
export const DEFAULT_EXPORT_NAME = ''/** 老工程里存过的固定名，迁移时视为「没填过」 */
const LEGACY_EXPORT_NAME = 'CMF 总表'

// ---- 栏目名预设库：两套，各管各的
//      项目信息栏 → 公司 / 部门 / 项目 / 设计师 / 版本号 / 时间 / 颜色 / 材质 / 工艺 / 制作工序 / 特别说明
//      选中对象   → 颜色 / 材质 / 工艺 / 制作工序 / 特别说明
//      内置项始终可选（即使栏目被删掉也能从下拉里选回来），自定义项存 localStorage 跨工程复用
export const DEFAULT_LABEL_PRESETS = [
  '公司',
  '部门',
  '项目',
  '设计师',
  '版本号',
  '时间',
  '颜色',
  '材质',
  '工艺',
  '制作工序',
  '特别说明'
]
export const DEFAULT_CMF_PRESETS = ['名称', '颜色', '材质', '工艺', '制作工序', '特别说明']

const LABEL_PRESET_KEY = 'cmf-label-presets'
const CMF_PRESET_KEY = 'cmf-row-presets'

function loadPresets(key: string, defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(key)
    const arr = raw ? JSON.parse(raw) : []
    const custom = Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === 'string' && !defaults.includes(x))
      : []
    return [...defaults, ...custom]
  } catch {
    return [...defaults]
  }
}

// 只持久化自定义项，内置项由代码保证，避免升级后出现重复/丢项
function savePresets(key: string, list: string[], defaults: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list.filter((x) => !defaults.includes(x))))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

// 旧版单图存档兼容：转为单元素 images 数组
function toImages(p: CMFProject): ImageItem[] {
  if (Array.isArray(p.images) && p.images.length) return p.images
  const legacy = (p as unknown as { image?: string; imageName?: string }).image
  if (legacy) {
    return [{ id: uid(), dataUrl: legacy, name: (p as unknown as { imageName?: string }).imageName || 'image', x: 0, y: 0, w: 0, h: 0 }]
  }
  return []
}

// 旧存档的自定义引线/锚点尺寸保留；仍是老默认值（2.5 / 8）的跟随新默认尺寸放大
const LEGACY_LINE_W = [2.5, 3]
const LEGACY_ANCHOR_R = [8, 10]
function migrateAnns(list: CMFAnnotation[]): CMFAnnotation[] {
  return list.map((a) => {
    // 颜色栏现在以色号为主：老工程里存的 #RRGGBB 换成最接近的色号，
    // 原色值留在 colorPicked 里，色块与 ΔE 才有东西可比
    const c = toColorCode(a.cmf?.color ?? '')
    return {
      ...a,
      cmf: { ...a.cmf, color: c.color, colorPicked: a.cmf?.colorPicked ?? c.picked },
      lineWidth: a.lineWidth == null || LEGACY_LINE_W.includes(a.lineWidth) ? LINE_W : a.lineWidth,
      anchorSize: a.anchorSize == null || LEGACY_ANCHOR_R.includes(a.anchorSize) ? ANCHOR_R : a.anchorSize
    }
  })
}

// 选中对象的包围盒（content 坐标）：图片用自身 x/y/w/h，标注用文本块（含缩放）
interface SelBox {
  type: 'image' | 'annotation' | 'shape'
  id: string
  bx: number
  by: number
  bw: number
  bh: number
}

function collectBoxes(s: Pick<State, 'images' | 'annotations' | 'shapes' | 'selectedIds'>): SelBox[] {
  const boxes: SelBox[] = []
  for (const id of s.selectedIds) {
    const im = s.images.find((i) => i.id === id)
    if (im) {
      boxes.push({ type: 'image', id, bx: im.x, by: im.y, bw: im.w, bh: im.h })
      continue
    }
    const a = s.annotations.find((x) => x.id === id)
    if (a) {
      const sc = a.scale ?? 1
      boxes.push({ type: 'annotation', id, bx: a.label.x, by: a.label.y, bw: LABEL_W * sc, bh: labelBoxHeight(a) * sc })
      continue
    }
    const sh = s.shapes.find((x) => x.id === id)
    if (sh) boxes.push({ type: 'shape', id, bx: sh.x, by: sh.y, bw: sh.w, bh: sh.h })
  }
  return boxes
}

function applyMoves(
  s: Pick<State, 'images' | 'annotations' | 'shapes'>,
  moves: Record<string, { x?: number; y?: number }>
) {
  return {
    images: s.images.map((im) => {
      const m = moves[im.id]
      return m ? { ...im, x: m.x ?? im.x, y: m.y ?? im.y } : im
    }),
    annotations: s.annotations.map((a) => {
      const m = moves[a.id]
      return m ? { ...a, label: { x: m.x ?? a.label.x, y: m.y ?? a.label.y } } : a
    }),
    shapes: s.shapes.map((sh) => {
      const m = moves[sh.id]
      return m ? { ...sh, x: m.x ?? sh.x, y: m.y ?? sh.y } : sh
    })
  }
}

// 内部剪贴板（复制 / 粘贴用），深拷贝避免后续修改互相影响
let clipDoc: { images: ImageItem[]; annotations: CMFAnnotation[]; shapes: ShapeItem[] } | null = null

// ---- 图层层级：图片与标注共用一套 z 序号（越大越靠上） ----
// 之所以不用「数组顺序」当层级，是因为图片和标注存在两个数组里，
// 只有统一编号才能让「把一张图压到某条标注下面」这种事成立。
export interface LayerRef {
  kind: 'image' | 'annotation' | 'shape'
  id: string
  z: number
  groupId?: string
  hidden?: boolean
}

/** 扁平化后的图层序列（自下而上）；z 相同时保持「图片在前、标注在后」的老观感 */
export function layerOrder(s: {
  images: ImageItem[]
  annotations: CMFAnnotation[]
  shapes?: ShapeItem[]
}): LayerRef[] {
  const list: LayerRef[] = [
    ...s.images.map((im) => ({
      kind: 'image' as const,
      id: im.id,
      z: im.z ?? 0,
      groupId: im.groupId,
      hidden: !!im.hidden
    })),
    ...s.annotations.map((a) => ({
      kind: 'annotation' as const,
      id: a.id,
      z: a.z ?? 0,
      groupId: a.groupId,
      hidden: !!a.hidden
    })),
    ...(s.shapes ?? []).map((sh) => ({
      kind: 'shape' as const,
      id: sh.id,
      z: sh.z ?? 0,
      groupId: sh.groupId,
      hidden: !!sh.hidden
    }))
  ]
  return list.sort((a, b) => a.z - b.z)
}

/** 按给定 id 顺序重写 z（顺序即层级，自下而上） */
function applyLayerOrder<T extends { id: string; z?: number }>(list: T[], ids: string[]): T[] {
  const idx = new Map(ids.map((id, i) => [id, i]))
  return list.map((it) => (idx.has(it.id) ? { ...it, z: idx.get(it.id) } : it))
}

/** 老工程 / 老存档没有 z：按当前数组顺序补一套连续序号 */
function normalizeLayers(images: ImageItem[], annotations: CMFAnnotation[], shapes: ShapeItem[] = []) {
  const ids = layerOrder({ images, annotations, shapes }).map((r) => r.id)
  return {
    images: applyLayerOrder(images, ids),
    annotations: applyLayerOrder(annotations, ids),
    shapes: applyLayerOrder(shapes, ids)
  }
}

/** 删除对象后，把已经空掉的分组一起收走 */
function pruneGroups(groups: LayerGroup[], images: ImageItem[], annotations: CMFAnnotation[], shapes: ShapeItem[] = []): LayerGroup[] {
  if (!groups.length) return groups
  const used = new Set<string>()
  for (const im of images) if (im.groupId) used.add(im.groupId)
  for (const a of annotations) if (a.groupId) used.add(a.groupId)
  for (const sh of shapes) if (sh.groupId) used.add(sh.groupId)
  const kept = groups.filter((g) => used.has(g.id))
  return kept.length === groups.length ? groups : kept
}

/** 把一批对象整体挪到一层「顶」上（粘贴 / 复制副本用） */
function topZ(s: { images: ImageItem[]; annotations: CMFAnnotation[]; shapes?: ShapeItem[] }): number {
  const order = layerOrder(s)
  return order.length ? order[order.length - 1].z + 1 : 0
}

/** 图片的包围盒（不含标注与信息栏）：新建第一块画板时给个像样的初始取景 */
function imagesBox(images: ImageItem[]): ExportRect | null {
  const vis = images.filter((im) => !im.hidden)
  if (!vis.length) return null
  const x = Math.min(...vis.map((im) => im.x))
  const y = Math.min(...vis.map((im) => im.y))
  const r = Math.max(...vis.map((im) => im.x + im.w))
  const b = Math.max(...vis.map((im) => im.y + im.h))
  return { x, y, w: Math.max(1, r - x), h: Math.max(1, b - y) }
}

/** 画板取景框的容差：指针只挪了不到 0.5px 不算「手动调整」，避免拖一下就把「跟随内容」关掉 */


function cloneAnnotations(list: CMFAnnotation[], dx = 0, dy = 0): CMFAnnotation[] {
  return list.map((a) => ({
    ...a,
    id: uid(),
    anchor: { x: a.anchor.x + dx, y: a.anchor.y + dy },
    label: { x: a.label.x + dx, y: a.label.y + dy },
    cmf: { ...a.cmf, rows: a.cmf.rows ? a.cmf.rows.map((r) => ({ ...r })) : undefined }
  }))
}

function cloneImages(list: ImageItem[], dx = 0, dy = 0): ImageItem[] {
  return list.map((im) => ({ ...im, id: uid(), x: im.x + dx, y: im.y + dy }))
}

function cloneShapes(list: ShapeItem[] | undefined, dx = 0, dy = 0): ShapeItem[] {
  return (list ?? []).map((sh) => ({
    ...sh,
    id: uid(),
    x: sh.x + dx,
    y: sh.y + dy,
    points: sh.points ? sh.points.map((pt) => ({ ...pt })) : undefined
  }))
}

// 对某条标注的「栏目行」做一次变换，并把内置字段的值同步回 cmf
function withAnnRows(a: CMFAnnotation, fn: (rows: CMFRow[]) => CMFRow[]): CMFAnnotation {
  return { ...a, cmf: applyCmfRows(a.cmf, fn(cmfRows(a.cmf))) }
}

// ---- 模板相关 ----
// 套用模板时合并信息栏结构：同栏目名沿用当前内容（公司/项目/设计师不必重填），
// 模板新加的栏目留空；当前多出来、模板里没有的栏目会被去掉。
function mergeInfoFields(cur: ProjectInfo, tpl: { label: string; hidden?: boolean }[]): ProjectInfo {
  if (!tpl.length) return cur
  const pool = cur.fields.map((f) => ({ ...f }))
  const fields: InfoField[] = tpl.map((t) => {
    const i = pool.findIndex((f) => f.label.trim() === t.label.trim())
    if (i >= 0) {
      const [hit] = pool.splice(i, 1)
      return { ...hit, hidden: t.hidden }
    }
    return { id: uid(), label: t.label, value: '', hidden: t.hidden }
  })
  return { fields: fields.length ? fields : cur.fields }
}

// 模板 → 新建标注的 cmf：只带栏目结构，值一律为空
export function cmfFromTemplate(t: AnnTemplate | null | undefined): CMFMeta {
  const base = emptyCMF()
  if (!t || !t.rows.length) return t?.noName ? { ...base, noName: true } : base
  return { ...base, rows: t.rows.map((r) => ({ ...r, value: '' })), noName: t.noName || undefined }
}

function uniqueTemplateName(base: string, list: CMFTemplate[]): string {
  if (!list.some((t) => t.name === base)) return base
  let i = 2
  while (list.some((t) => t.name === `${base} (${i})`)) i += 1
  return `${base} (${i})`
}

/** 当前画板：多选时取第一个。导出设置、模板、右侧单板设置都以它为基准 */
export function activeBoard(s: { artboards: Artboard[]; selectedBoardIds: string[] }): Artboard | null {
  const id = s.selectedBoardIds[0]
  return s.artboards.find((b) => b.id === id) ?? s.artboards[0] ?? null
}

// 老工程 → 画板：v0.2 里唯一的那块「导出区域」变成第一块画板，当时的比例 / DPI / 格式一并带过来。
// 有显式 exportRect 的按「手动画板」处理（auto=false）—— 那是用户亲手框的，不能一打开就被内容重贴掉；
// 没有的话才交给「自动画布」去贴合内容。
function boardsFromLegacy(p: CMFProject, images: ImageItem[]): Artboard[] {
  const preset = safePreset(p.exportPreset === 'native' ? DEFAULT_BOARD_PRESET : p.exportPreset)
  const box = p.exportRect ?? null
  const b = box ? makeBoard('画板 1', preset, box, false) : boardFromContent('画板 1', preset, imagesBox(images))
  b.format = p.exportFormat ?? DEFAULT_BOARD_FORMAT
  b.dpi = clampDpi(p.exportDpi ?? DEFAULT_BOARD_DPI)
  b.dpiCustom = p.exportDpiCustom ?? !DPI_OPTIONS.includes(p.exportDpi ?? DEFAULT_BOARD_DPI)
  b.native = p.exportNative ?? p.exportPreset === 'native'
  return [b]
}

// 读进来的画板也要过一遍校验：比例 key 可能来自更新的版本，尺寸不能是 0 / NaN
function normalizeBoards(list: Artboard[], images: ImageItem[]): Artboard[] {
  const safe = (Array.isArray(list) ? list : [])
    .filter((b) => b && typeof b.id === 'string')
    .map((b) => ({
      ...b,
      preset: safePreset(b.preset),
      x: Number.isFinite(b.x) ? b.x : 0,
      y: Number.isFinite(b.y) ? b.y : 0,
      w: Math.max(20, Number.isFinite(b.w) ? b.w : 1123),
      h: Math.max(20, Number.isFinite(b.h) ? b.h : 794),
      dpi: b.dpi ? clampDpi(b.dpi) : undefined,
      format: b.format ?? DEFAULT_BOARD_FORMAT,
      name: (b.name || '').trim() || '画板'
    }))
  return safe.length ? safe : [boardFromContent('画板 1', DEFAULT_BOARD_PRESET, imagesBox(images))]
}

export const useStore = create<State>((set, get) => ({
  images: [],
  info: emptyInfo(),
  tool: 'select',
  annotations: [],
  shapes: [],
  groups: [],
  selectedIds: [],
  globalLineWidth: LINE_W,
  globalAnchorSize: ANCHOR_R,
  globalEndStyle: 'dot',
  globalLineColor: LINE_COLOR,
  infoScale: 1,
  infoScaleAuto: true,
  infoVisible: true,
  infoRule: true,
  infoPos: null,
  logo: null,
  watermark: emptyWatermark(),
  artboards: [],
  selectedBoardIds: [],
  boardFocus: false,
  boardFitTick: 0,
  exportName: DEFAULT_EXPORT_NAME,
  templates: loadTemplates(),
  annTemplate: loadAnnTemplate(),
  zoom: 1,
  histTick: 0,
  setZoom: (v) => set({ zoom: v }),
  bumpHist: () => set((s) => ({ histTick: s.histTick + 1 })),
  // 导入图片后：信息栏默认高度至少与图片等高（用户手动缩放过就不再自动改）
  addImages: (items) =>
    set((s) => {
      // 新图放最上层：层级序号接着现有最大值往下排
      const base = topZ(s)
      const added = items.map((im, i) => ({ ...im, z: im.z ?? base + i }))
      const images = [...s.images, ...added]
      // 第一次导入图片时顺手立一块画板：不立的话「导出」无处可导，
      // 用户还得先学会「新建画板」——默认这一步不该由用户承担
      const first = !s.artboards.length
      const boards = first ? [boardFromContent('画板 1', DEFAULT_BOARD_PRESET, imagesBox(images))] : s.artboards
      return {
        images,
        artboards: boards,
        selectedBoardIds: first ? [boards[0].id] : s.selectedBoardIds,
        selectedIds: [],
        infoScale: s.infoScaleAuto
          ? infoScaleForImages(images, s.info.fields, s.logo, s.infoScale)
          : s.infoScale
      }
    }),
  updateImage: (id, patch) =>
    set((s) => ({ images: s.images.map((im) => (im.id === id ? { ...im, ...patch } : im)) })),
  removeImage: (id) =>
    set((s) => {
      const images = s.images.filter((im) => im.id !== id)
      return {
        images,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        groups: pruneGroups(s.groups, images, s.annotations, s.shapes)
      }
    }),
  setImageVisible: (id, v) =>
    set((s) => ({
      images: s.images.map((im) => (im.id === id ? { ...im, hidden: !v } : im)),
      selectedIds: v ? s.selectedIds : s.selectedIds.filter((x) => x !== id)
    })),

  // ---- 图层层级 / 分组 ----
  // place 以「拖动目标」为准：before = 插到目标下方（z 更小），after = 插到目标上方。
  // 拖分组时整块成员一起走；目标也是分组时按整组边界算。
  // 单个图层拖到分组头上 = 直接归进这个分组（不做嵌套分组）。
  reorderLayers: (dragId, targetId, place) =>
    set((s) => {
      if (dragId === targetId) return {}
      const order = layerOrder(s).map((r) => r.id)
      const groupOf = (id: string) => layerOrder(s).find((r) => r.id === id)?.groupId
      const isGroup = (id: string) => s.groups.some((g) => g.id === id)

      const dragIds = isGroup(dragId) ? order.filter((id) => groupOf(id) === dragId) : [dragId]
      if (!dragIds.length) return {}
      const targetIds = isGroup(targetId) ? order.filter((id) => groupOf(id) === targetId) : [targetId]
      if (!targetIds.length || dragIds.some((id) => targetIds.includes(id))) return {}

      const rest = order.filter((id) => !dragIds.includes(id))
      const anchor = place === 'before' ? targetIds[0] : targetIds[targetIds.length - 1]
      let at = rest.indexOf(anchor)
      if (at < 0) return {}
      if (place === 'after') at += 1
      const next = [...rest.slice(0, at), ...dragIds, ...rest.slice(at)]
      const layers = normalizeLayers(
        applyLayerOrder(s.images, next),
        applyLayerOrder(s.annotations, next),
        applyLayerOrder(s.shapes, next)
      )

      // 单层拖到分组上 → 归组（保持落在组内的位置）
      if (isGroup(targetId) && !isGroup(dragId)) {
        return {
          ...layers,
          images: layers.images.map((im) => (im.id === dragId ? { ...im, groupId: targetId } : im)),
          annotations: layers.annotations.map((a) => (a.id === dragId ? { ...a, groupId: targetId } : a)),
          shapes: layers.shapes.map((sh) => (sh.id === dragId ? { ...sh, groupId: targetId } : sh))
        }
      }
      return layers
    }),

  groupSelectedLayers: () =>
    set((s) => {
      const order = layerOrder(s)
      const picked = order.filter((r) => s.selectedIds.includes(r.id)).map((r) => r.id)
      if (picked.length < 2) return {}
      const gid = uid()
      // 新分组放在被选对象里最靠上那个的位置，组内保持原有先后
      const top = Math.max(...picked.map((id) => order.findIndex((r) => r.id === id)))
      const rest = order.map((r) => r.id).filter((id) => !picked.includes(id))
      const insertAt = rest.filter((id) => order.findIndex((r) => r.id === id) < top).length
      const next = [...rest.slice(0, insertAt), ...picked, ...rest.slice(insertAt)]
      const group: LayerGroup = { id: gid, name: `分组 ${s.groups.length + 1}` }
      return {
        groups: [...s.groups, group],
        images: applyLayerOrder(
          s.images.map((im) => (picked.includes(im.id) ? { ...im, groupId: gid } : im)),
          next
        ),
        annotations: applyLayerOrder(
          s.annotations.map((a) => (picked.includes(a.id) ? { ...a, groupId: gid } : a)),
          next
        ),
        shapes: applyLayerOrder(
          s.shapes.map((sh) => (picked.includes(sh.id) ? { ...sh, groupId: gid } : sh)),
          next
        )
      }
    }),

  ungroupLayer: (groupId) =>
    set((s) => ({
      groups: s.groups.filter((g) => g.id !== groupId),
      images: s.images.map((im) => (im.groupId === groupId ? { ...im, groupId: undefined } : im)),
      annotations: s.annotations.map((a) => (a.groupId === groupId ? { ...a, groupId: undefined } : a)),
      shapes: s.shapes.map((sh) => (sh.groupId === groupId ? { ...sh, groupId: undefined } : sh))
    })),

  renameLayerGroup: (groupId, name) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim() || g.name } : g))
    })),

  setGroupVisible: (groupId, v) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, hidden: !v } : g)),
      selectedIds: v
        ? s.selectedIds
        : s.selectedIds.filter((id) => {
            const im = s.images.find((i) => i.id === id)
            if (im) return im.groupId !== groupId
            const a = s.annotations.find((x) => x.id === id)
            if (a) return a.groupId !== groupId
            const sh = s.shapes.find((x) => x.id === id)
            return sh ? sh.groupId !== groupId : true
          })
    })),

  toggleGroupCollapsed: (groupId) =>
    set((s) => ({
      groups: s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g))
    })),

  // ---- 画板 ----
  // 「新建画板」默认排在现有画板右侧、留一点间距，这样一眼能看出是新的一块而不是原地替换
  addBoard: (preset, rect) => {
    const s = get()
    const p = safePreset(preset)
    let r = rect
    if (!r) {
      const base = { ...makeBoard('', p) }
      const right = s.artboards.length ? Math.max(...s.artboards.map((b) => b.x + b.w)) + BOARD_GAP : 0
      const top = s.artboards.length ? Math.min(...s.artboards.map((b) => b.y)) : 0
      r = { x: right, y: top, w: base.w, h: base.h }
    }
    const board = makeBoard(nextBoardName(s.artboards), p, r, !rect)
    set({
      artboards: [...s.artboards, board],
      selectedBoardIds: [board.id],
      boardFocus: true,
      selectedIds: []
    })
    return board
  },

  addBoardFromContent: (preset) => {
    const s = get()
    const p = safePreset(preset)
    const box = imagesBox(s.images)
    // 尺寸照内容来，但位置放到所有画板右侧的空白处：直接用内容框会和已有的那块
    // 严丝合缝地重叠（新板压在上面，拖它时看着像两块一起动）。
    // 同时关掉「自动画布」——不在内容上的板子会被自动外扩逻辑立刻拉回内容处
    const draft = boardFromContent(nextBoardName(s.artboards), p, box)
    const right = s.artboards.length ? Math.max(...s.artboards.map((b) => b.x + b.w)) + BOARD_GAP : draft.x
    const top = s.artboards.length ? Math.min(...s.artboards.map((b) => b.y)) : draft.y
    const board = { ...draft, x: right, y: top, auto: false }
    set({
      artboards: [...s.artboards, board],
      selectedBoardIds: [board.id],
      boardFocus: true,
      selectedIds: []
    })
    return board
  },

  // 至少留一块：全删掉之后没有取景框，导出按钮就无处可导。
  // 全选删除时保留第一块 —— 静默什么都不做会让人以为按钮坏了
  removeBoards: (ids) =>
    set((s) => {
      const left = s.artboards.filter((b) => !ids.includes(b.id))
      if (!left.length) {
        const keep = s.artboards[0]
        return { artboards: [keep], selectedBoardIds: [keep.id] }
      }
      const sel = s.selectedBoardIds.filter((id) => !ids.includes(id))
      return {
        artboards: left,
        selectedBoardIds: sel.length ? sel : [left[0].id]
      }
    }),

  duplicateBoard: (id) =>
    set((s) => {
      const src = s.artboards.find((b) => b.id === id)
      if (!src) return {}
      const copy: Artboard = { ...src, id: uid(), name: nextBoardName(s.artboards), auto: false }
      copy.x = src.x + src.w + 80
      return { artboards: [...s.artboards, copy], selectedBoardIds: [copy.id], boardFocus: true }
    }),

  renameBoard: (id, name) =>
    set((s) => ({
      artboards: s.artboards.map((b) => (b.id === id ? { ...b, name: name.trim() || b.name } : b))
    })),

  // 手动移动 / 缩放画板 = 不再跟随内容（keepAuto 用于「贴合内容」这类本来就要自动的写入）
  updateBoard: (id, patch, opts) =>
    set((s) => {
      const touch = patch.x !== undefined || patch.y !== undefined || patch.w !== undefined || patch.h !== undefined
      return {
        artboards: s.artboards.map((b) =>
          b.id === id ? { ...b, ...patch, auto: touch && !opts?.keepAuto ? false : (patch.auto ?? b.auto) } : b
        )
      }
    }),

  selectBoard: (id, additive = false) =>
    set((s) => {
      if (id == null) return { selectedBoardIds: [], boardFocus: false }
      if (!additive) return { selectedBoardIds: [id], boardFocus: true, selectedIds: [] }
      const has = s.selectedBoardIds.includes(id)
      // 多选时至少留一块：取消最后一块没有意义
      if (has && s.selectedBoardIds.length === 1) return { boardFocus: true }
      return {
        selectedBoardIds: has ? s.selectedBoardIds.filter((x) => x !== id) : [...s.selectedBoardIds, id],
        boardFocus: true,
        selectedIds: []
      }
    }),

  selectAllBoards: () =>
    set((s) => ({ selectedBoardIds: s.artboards.map((b) => b.id), boardFocus: true, selectedIds: [] })),

  focusBoards: () =>
    set((s) => ({
      boardFocus: true,
      selectedIds: [],
      selectedBoardIds: s.selectedBoardIds.length ? s.selectedBoardIds : s.artboards.slice(0, 1).map((b) => b.id)
    })),

  // 批量换比例：中心不动，只扩不裁（和单块换比例同一套逻辑）
  setBoardPreset: (preset) =>
    set((s) => ({
      artboards: s.artboards.map((b) =>
        s.selectedBoardIds.includes(b.id) ? { ...refitBoard(b, safePreset(preset)), auto: false } : b
      )
    })),

  setBoardBg: (bg) =>
    set((s) => ({
      artboards: s.artboards.map((b) => (s.selectedBoardIds.includes(b.id) ? { ...b, bg } : b))
    })),

  setBoardExport: (patch) =>
    set((s) => ({
      artboards: s.artboards.map((b) => {
        if (!s.selectedBoardIds.includes(b.id)) return b
        const next = { ...b, ...patch }
        // 选具体 DPI 就等于退出「原分辨率」：两者是同一组单选
        if (patch.dpi !== undefined || patch.dpiCustom !== undefined) next.native = false
        return next
      })
    })),

  fitBoardsToContent: () =>
    set((s) => ({
      boardFitTick: s.boardFitTick + 1,
      artboards: s.artboards.map((b) => (s.selectedBoardIds.includes(b.id) ? { ...b, auto: true } : b))
    })),

  setInfo: (patch) => set((s) => ({ info: { ...s.info, ...patch } })),
  addInfoField: () =>
    set((s) => ({
      info: { fields: [...s.info.fields, { id: uid(), label: '新栏目', value: '' }] }
    })),
  updateInfoField: (id, patch) =>
    set((s) => ({
      info: { fields: s.info.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)) }
    })),
  removeInfoField: (id) =>
    set((s) => {
      if (s.info.fields.length <= 1) return s // 至少保留一行（标题）
      return { info: { fields: s.info.fields.filter((f) => f.id !== id) } }
    }),
  moveInfoField: (from, to) =>
    set((s) => {
      const arr = [...s.info.fields]
      if (from === to || from < 0 || from >= arr.length) return s
      const [item] = arr.splice(from, 1)
      arr.splice(Math.max(0, Math.min(to, arr.length)), 0, item)
      return { info: { ...s.info, fields: arr } }
    }),
  bumpInfoVersion: () =>
    set((s) => {
      let changed = false
      const fields = s.info.fields.map((f) => {
        if (!isAutoVersionLabel(f.label)) return f
        const next = bumpVersionValue(f.value)
        if (next === f.value) return f
        changed = true
        return { ...f, value: next }
      })
      return changed ? { info: { ...s.info, fields } } : {}
    }),
  labelPresets: loadPresets(LABEL_PRESET_KEY, DEFAULT_LABEL_PRESETS),
  addLabelPreset: (label) =>
    set((s) => {
      const v = label.trim()
      if (!v || s.labelPresets.includes(v)) return {}
      const next = [...s.labelPresets, v]
      savePresets(LABEL_PRESET_KEY, next, DEFAULT_LABEL_PRESETS)
      return { labelPresets: next }
    }),
  removeLabelPreset: (label) =>
    set((s) => {
      // 内置项不参与删除，始终可从下拉里选回来
      if (DEFAULT_LABEL_PRESETS.includes(label)) return {}
      const next = s.labelPresets.filter((x) => x !== label)
      savePresets(LABEL_PRESET_KEY, next, DEFAULT_LABEL_PRESETS)
      return { labelPresets: next }
    }),
  cmfPresets: loadPresets(CMF_PRESET_KEY, DEFAULT_CMF_PRESETS),
  addCmfPreset: (label) =>
    set((s) => {
      const v = label.trim()
      if (!v || s.cmfPresets.includes(v)) return {}
      const next = [...s.cmfPresets, v]
      savePresets(CMF_PRESET_KEY, next, DEFAULT_CMF_PRESETS)
      return { cmfPresets: next }
    }),
  removeCmfPreset: (label) =>
    set((s) => {
      if (DEFAULT_CMF_PRESETS.includes(label)) return {}
      const next = s.cmfPresets.filter((x) => x !== label)
      savePresets(CMF_PRESET_KEY, next, DEFAULT_CMF_PRESETS)
      return { cmfPresets: next }
    }),
  setTool: (t) => set({ tool: t, selectedIds: [] }),
  addAnnotation: (a) => {
    const s = get()
    // 新标注继承当前全局样式，并压在现有图层最上面
    const na: CMFAnnotation = {
      ...a,
      lineWidth: a.lineWidth ?? s.globalLineWidth,
      anchorSize: a.anchorSize ?? s.globalAnchorSize,
      // 没指定颜色就沿用全局色：新建标注和「全局引线样式」里显示的颜色一致
      lineColor: a.lineColor ?? s.globalLineColor,
      z: a.z ?? topZ(s)
    }
    set({ annotations: [...s.annotations, na], selectedIds: [na.id] })
  },
  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a))
    })),
  setAnnotationVisible: (id, v) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? { ...a, hidden: !v } : a)),
      selectedIds: v ? s.selectedIds : s.selectedIds.filter((x) => x !== id)
    })),
  // 单条改色：打上「已锁」标记，之后全局换色不会把它覆盖掉
  setAnnLineColor: (id, color) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id
          ? color
            ? { ...a, lineColor: color, lineColorLocked: true }
            : { ...a, lineColor: s.globalLineColor, lineColorLocked: false }
          : a
      )
    })),
  patchAnnRow: (id, key, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? withAnnRows(a, (rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r))) : a
      )
    })),
  moveAnnRow: (id, from, to) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        return withAnnRows(a, (rows) => {
          if (from === to || from < 0 || from >= rows.length) return rows
          const arr = [...rows]
          const [item] = arr.splice(from, 1)
          arr.splice(Math.max(0, Math.min(to, arr.length)), 0, item)
          return arr
        })
      })
    })),
  addAnnRow: (id) =>
    set((s) => ({
      annotations: s.annotations.map((a) => (a.id === id ? withAnnRows(a, (rows) => [...rows, newCmfRow()]) : a))
    })),
  removeAnnRow: (id, key) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        const next = withAnnRows(a, (rows) => rows.filter((r) => r.key !== key))
        // 删掉内置行时把值一并清掉，否则左侧图层的副标题 / 色块还会留着旧值
        if (isBuiltinCmfKey(key)) next.cmf[key] = ''
        return next
      })
    })),
  resetAnnRows: (id) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        const cmf = { ...a.cmf }
        delete cmf.rows
        delete cmf.noName
        delete cmf.nameHidden
        return { ...a, cmf }
      })
    })),
  setAnnName: (id, fromKey) =>
    set((s) => ({
      annotations: s.annotations.map((a) => {
        if (a.id !== id) return a
        const rows = cmfRows(a.cmf)
        const src = rows.find((r) => r.key === fromKey)
        if (!src || fromKey === 'name') return a
        // 该行的内容成为标题；这一行随之从栏目里移除，名称行自动回到最上面
        const name = src.value.trim() ? src.value : a.cmf.name
        const rest = rows.filter((r) => r.key !== fromKey)
        const next = applyCmfRows({ ...a.cmf, name, noName: false, nameHidden: false }, rest)
        // 被提升的若是内置字段，原字段一并清空，避免图层副标题还挂着旧值
        if (isBuiltinCmfKey(fromKey)) next[fromKey] = ''
        return { ...a, cmf: next }
      })
    })),
  removeAnnotation: (id) =>
    set((s) => {
      const annotations = s.annotations.filter((a) => a.id !== id)
      return {
        annotations,
        selectedIds: s.selectedIds.filter((x) => x !== id),
        groups: pruneGroups(s.groups, s.images, annotations, s.shapes)
      }
    }),

  /* ---- 标注形状 ---- */
  addShape: (sh) =>
    set((s) => {
      // 新形状压在现有图层最上面，并立刻选中 —— 建完就能调颜色 / 改文字
      const next = normalizeShape({ ...sh, z: sh.z ?? topZ(s) })
      return { shapes: [...s.shapes, next], selectedIds: [next.id], boardFocus: false }
    }),
  updateShape: (id, patch) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? normalizeShape({ ...sh, ...patch }) : sh))
    })),
  setShapeVisible: (id, v) =>
    set((s) => ({
      shapes: s.shapes.map((sh) => (sh.id === id ? { ...sh, hidden: !v } : sh)),
      selectedIds: v ? s.selectedIds : s.selectedIds.filter((x) => x !== id)
    })),
  removeShapes: (ids) =>
    set((s) => {
      const shapes = s.shapes.filter((sh) => !ids.includes(sh.id))
      return {
        shapes,
        selectedIds: s.selectedIds.filter((x) => !ids.includes(x)),
        groups: pruneGroups(s.groups, s.images, s.annotations, shapes)
      }
    }),
  // 一键清空「画面」：只清掉内容（渲染图 / 标注 / 选中），
  // 项目信息栏、引线样式、水印、模板、画板这些设置全部保留，换一组图不用重新摆版。
  // 走一次 set，撤销里就是干净的一步。
  clearCanvas: () =>
    set({
      images: [],
      annotations: [],
      shapes: [],
      groups: [],
      selectedIds: [],
    }),
  // additive=true 时切换该对象是否在选中集合中（Shift 点选）
  // 选中对象即离开「画板」页：右栏跟着选择走，不用再手动点页签
  select: (id, additive = false) =>
    set((s) => {
      if (id == null) return { selectedIds: [], boardFocus: false }
      if (!additive) return { selectedIds: [id], boardFocus: false }
      return s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id), boardFocus: false }
        : { selectedIds: [...s.selectedIds, id], boardFocus: false }
    }),
  selectAll: () =>
    set((s) => ({
      selectedIds: [
        ...s.images.map((i) => i.id),
        ...s.annotations.map((a) => a.id),
        ...s.shapes.map((sh) => sh.id)
      ],
      boardFocus: false
    })),
  copySelected: () => {
    const s = get()
    clipDoc = {
      images: s.images.filter((im) => s.selectedIds.includes(im.id)).map((im) => ({ ...im })),
      shapes: s.shapes
        .filter((sh) => s.selectedIds.includes(sh.id))
        .map((sh) => ({ ...sh, points: sh.points ? sh.points.map((pt) => ({ ...pt })) : undefined })),
      annotations: s.annotations
        .filter((a) => s.selectedIds.includes(a.id))
        .map((a) => ({
          ...a,
          anchor: { ...a.anchor },
          label: { ...a.label },
          cmf: { ...a.cmf, rows: a.cmf.rows ? a.cmf.rows.map((r) => ({ ...r })) : undefined }
        }))
    }
  },
  pasteClipboard: () => {
    const c = clipDoc
    if (!c || (!c.images.length && !c.annotations.length && !(c.shapes ?? []).length)) return
    const s = get()
    const base = topZ(s)
    const imgs = cloneImages(c.images, 20, 20).map((im, i) => ({ ...im, z: base + i }))
    const anns = cloneAnnotations(c.annotations, 20, 20).map((a, i) => ({ ...a, z: base + imgs.length + i }))
    const shs = cloneShapes(c.shapes ?? [], 20, 20).map((sh, i) => ({ ...sh, z: base + imgs.length + anns.length + i }))
    set({
      images: [...s.images, ...imgs],
      annotations: [...s.annotations, ...anns],
      shapes: [...s.shapes, ...shs],
      selectedIds: [...imgs, ...anns, ...shs].map((x) => x.id)
    })
  },
  duplicateSelected: () => {
    const s = get()
    const base = topZ(s)
    const imgs = cloneImages(
      s.images.filter((im) => s.selectedIds.includes(im.id)),
      20,
      20
    ).map((im, i) => ({ ...im, z: base + i }))
    const anns = cloneAnnotations(
      s.annotations.filter((a) => s.selectedIds.includes(a.id)),
      20,
      20
    ).map((a, i) => ({ ...a, z: base + imgs.length + i }))
    const shs = cloneShapes(
      s.shapes.filter((sh) => s.selectedIds.includes(sh.id)),
      20,
      20
    ).map((sh, i) => ({ ...sh, z: base + imgs.length + anns.length + i }))
    if (!imgs.length && !anns.length && !shs.length) return
    set({
      images: [...s.images, ...imgs],
      annotations: [...s.annotations, ...anns],
      shapes: [...s.shapes, ...shs],
      selectedIds: [...imgs, ...anns, ...shs].map((x) => x.id)
    })
  },
  // 方向键微调：选中的标注整体挪（文本框 + 锚点），否则引线会被拉长拉歪
  nudgeSelected: (dx, dy) =>
    set((s) => {
      const ids = new Set(s.selectedIds)
      const images = s.images.map((im) => (ids.has(im.id) ? { ...im, x: im.x + dx, y: im.y + dy } : im))
      const annotations = s.annotations.map((a) =>
        ids.has(a.id)
          ? {
              ...a,
              label: { x: a.label.x + dx, y: a.label.y + dy },
              anchor: { x: a.anchor.x + dx, y: a.anchor.y + dy }
            }
          : a
      )
      const shapes = s.shapes.map((sh) => (ids.has(sh.id) ? { ...sh, x: sh.x + dx, y: sh.y + dy } : sh))
      const changed =
        images.some((im, i) => im !== s.images[i]) ||
        annotations.some((a, i) => a !== s.annotations[i]) ||
        shapes.some((sh, i) => sh !== s.shapes[i])
      return changed ? { images, annotations, shapes } : {}
    }),
  moveSelectionBy: (base, dx, dy) =>
    set((s) => {
      const im = new Map(base.images.map((v) => [v.id, v]))
      const an = new Map(base.annotations.map((v) => [v.id, v]))
      const sp = new Map((base.shapes ?? []).map((v) => [v.id, v]))
      if (!im.size && !an.size && !sp.size) return {}
      return {
        images: im.size
          ? s.images.map((x) => {
              const b = im.get(x.id)
              return b ? { ...x, x: b.x + dx, y: b.y + dy } : x
            })
          : s.images,
        annotations: an.size
          ? s.annotations.map((a) => {
              const b = an.get(a.id)
              if (!b) return a
              // 文本框与锚点各自判断：整组拖动时都跟；单拖某一个部件时只动另一个
              return {
                ...a,
                label: b.x === undefined ? a.label : { x: b.x + dx, y: (b.y ?? a.label.y) + dy },
                anchor: b.ax === undefined ? a.anchor : { x: b.ax + dx, y: (b.ay ?? a.anchor.y) + dy }
              }
            })
          : s.annotations,
        shapes: sp.size
          ? s.shapes.map((sh) => {
              const b = sp.get(sh.id)
              return b ? { ...sh, x: b.x + dx, y: b.y + dy } : sh
            })
          : s.shapes
      }
    }),
  // 对齐：先取选中对象的包围盒并集，再把每个对象贴到对应边 / 中心
  align: (dir) =>
    set((s) => {
      const boxes = collectBoxes(s)
      if (boxes.length < 2) return {}
      const minX = Math.min(...boxes.map((b) => b.bx))
      const minY = Math.min(...boxes.map((b) => b.by))
      const maxX = Math.max(...boxes.map((b) => b.bx + b.bw))
      const maxY = Math.max(...boxes.map((b) => b.by + b.bh))
      const uW = maxX - minX
      const uH = maxY - minY
      const moves: Record<string, { x?: number; y?: number }> = {}
      for (const b of boxes) {
        let x = b.bx
        let y = b.by
        if (dir === 'left') x = minX
        else if (dir === 'hcenter') x = minX + (uW - b.bw) / 2
        else if (dir === 'right') x = maxX - b.bw
        else if (dir === 'top') y = minY
        else if (dir === 'vcenter') y = minY + (uH - b.bh) / 2
        else if (dir === 'bottom') y = maxY - b.bh
        moves[b.id] = { x, y }
      }
      return applyMoves(s, moves)
    }),
  // 等距分布：首尾不动，中间对象按相等间距排布
  distribute: (axis) =>
    set((s) => {
      const boxes = collectBoxes(s)
      if (boxes.length < 3) return {}
      const sorted = [...boxes].sort((a, b) => (axis === 'h' ? a.bx - b.bx : a.by - b.by))
      const first = sorted[0]
      const last = sorted[sorted.length - 1]
      const start = axis === 'h' ? first.bx : first.by
      const end = axis === 'h' ? last.bx + last.bw : last.by + last.bh
      const total = sorted.reduce((sum, b) => sum + (axis === 'h' ? b.bw : b.bh), 0)
      const gap = (end - start - total) / (sorted.length - 1)
      const moves: Record<string, { x?: number; y?: number }> = {}
      let cursor = start
      for (const b of sorted) {
        moves[b.id] = axis === 'h' ? { x: cursor } : { y: cursor }
        cursor += (axis === 'h' ? b.bw : b.bh) + gap
      }
      return applyMoves(s, moves)
    }),
  // 全局样式：同时写入默认值并应用到所有已存在标注（一次调整全部）
  applyGlobalStyle: (patch) =>
    set((s) => {
      const next = { ...s }
      if (patch.lineWidth !== undefined) next.globalLineWidth = patch.lineWidth
      if (patch.anchorSize !== undefined) next.globalAnchorSize = patch.anchorSize
      if (patch.endStyle !== undefined) next.globalEndStyle = patch.endStyle
      if (patch.lineColor !== undefined) next.globalLineColor = patch.lineColor
      // 单独调过颜色的标注不被全局换色覆盖（面板里点「跟随全局」才会重新跟上）
      next.annotations = s.annotations.map((a) =>
        patch.lineColor !== undefined && a.lineColorLocked
          ? { ...a, ...patch, lineColor: a.lineColor }
          : { ...a, ...patch }
      )
      return next
    }),
  setInfoScale: (v) => set({ infoScale: v, infoScaleAuto: false }),
  setInfoVisible: (v) => set({ infoVisible: v }),
  setInfoRule: (v) => set({ infoRule: v }),
  setInfoPos: (p) => set({ infoPos: p }),
  setLogo: (l) => set({ logo: l }),
  patchWatermark: (patch) => set((s) => ({ watermark: { ...s.watermark, ...patch } })),
  setExportName: (v) => set({ exportName: v }),
  loadProject: (p) => {
    // 老工程的密度是 1~10 刻度：先不要继承 emptyWatermark 里的版本号，交给 upgradeWatermark 判断
    const wmRaw = (p.watermark ?? {}) as Partial<WatermarkMeta>
    // 老工程没有图层序号：按「图片 → 标注」的原有观感补一套
    const images = toImages(p)
    const layers = normalizeLayers(images, migrateAnns(p.annotations || []), p.shapes || [])
    // 画板：新工程直接读；老工程把唯一的导出区域迁成第一块
    const boards = Array.isArray(p.artboards) && p.artboards.length
      ? normalizeBoards(p.artboards, layers.images)
      : boardsFromLegacy(p, layers.images)
    set({
      images: layers.images,
      // 时间栏目跟着「打开工程」刷新为当天，避免拿旧日期的图纸去评审
      info: refreshInfoDate(toInfo(p)),
      annotations: layers.annotations,
      shapes: layers.shapes,
      groups: p.groups ?? [],
      selectedIds: [],
      tool: 'select',
      globalLineWidth: LINE_W,
      globalAnchorSize: ANCHOR_R,
      globalEndStyle: 'dot',
      // 老工程没有这个字段：取第一条标注上已存的颜色，再退回默认红
      globalLineColor: p.lineColor ?? p.annotations?.find((a) => a.lineColor)?.lineColor ?? LINE_COLOR,
      infoScale: p.infoScale ?? 1,
      // 老工程没有这个标记：手动缩放过（非 1）就视为用户已定尺寸，不再自动改
      infoScaleAuto: p.infoScaleAuto ?? ((p.infoScale ?? 1) === 1),
      infoVisible: p.infoVisible !== false,
      infoRule: p.infoRule !== false,
      infoPos: p.infoPos ?? null,
      logo: p.logo ?? null,
      watermark: upgradeWatermark({ ...emptyWatermark(), ...wmRaw, densityV: wmRaw.densityV }),
      artboards: boards,
      selectedBoardIds: [boards[0].id],
      boardFocus: false,
      // 老工程里写死的「CMF 总表」当作没填，让文件名回到「跟项目名一致」
      exportName:
        (p.exportName ?? '') === LEGACY_EXPORT_NAME ? '' : (p.exportName ?? '')
    })
  },
  exportProject: () => {
    const s = get()
    return {
      version: 2,
      info: s.info,
      name: infoName(s.info),
      images: s.images,
      annotations: s.annotations,
      shapes: s.shapes,
      groups: s.groups,
      artboards: s.artboards,
      updatedAt: Date.now(),
      infoScale: s.infoScale,
      infoScaleAuto: s.infoScaleAuto,
      lineColor: s.globalLineColor,
      infoVisible: s.infoVisible,
      infoRule: s.infoRule,
      infoPos: s.infoPos,
      logo: s.logo,
      watermark: s.watermark,
      // 导出到磁盘时补上最终名字：没单独填过就用项目名
      exportName: s.exportName.trim() || infoName(s.info)
    } as unknown as CMFProject
  },

  // ---- 模板 ----
  saveTemplate: (name) => {
    const s = get()
    // 栏目结构优先取「当前选中的标注」，没选就用第一条，都没有就用内置五栏
    const src = s.annotations.find((a) => s.selectedIds.includes(a.id)) ?? s.annotations[0]
    const rows = cmfRows(src ? src.cmf : emptyCMF()).map((r) => ({ ...r, value: '' }))
    const t: CMFTemplate = {
      kind: 'cmf-template',
      version: 1,
      id: uid(),
      name: name.trim() || '未命名模板',
      createdAt: Date.now(),
      lineWidth: s.globalLineWidth,
      anchorSize: s.globalAnchorSize,
      endStyle: s.globalEndStyle,
      lineColor: s.globalLineColor,
      annRows: rows,
      annNoName: src?.cmf.noName || undefined,
      infoFields: s.info.fields.map((f) => ({ label: f.label, hidden: f.hidden || undefined })),
      infoScale: s.infoScale,
      infoVisible: s.infoVisible,
      infoRule: s.infoRule,
      logo: s.logo ? { ...s.logo } : null,
      watermark: { ...s.watermark },
      // 模板存「当前画板」的导出参数：套用时就作用在选中的画板上
      exportPreset: activeBoard(s)?.preset ?? DEFAULT_BOARD_PRESET,
      exportDpi: activeBoard(s)?.dpi ?? DEFAULT_BOARD_DPI,
      exportDpiCustom: activeBoard(s)?.dpiCustom ?? false,
      exportFormat: activeBoard(s)?.format ?? DEFAULT_BOARD_FORMAT,
      labelPresets: [...s.labelPresets],
      cmfPresets: [...s.cmfPresets]
    }
    const next = [t, ...s.templates]
    saveTemplates(next)
    set({ templates: next })
    return t
  },

  applyTemplate: (t) => {
    const s = get()
    const annTemplate: AnnTemplate | null = t.annRows.length
      ? { rows: t.annRows.map((r) => ({ ...r, value: '' })), noName: t.annNoName }
      : null
    // 栏目名自带的自定义项并入本地库，方便下次直接在下拉里选
    const labelPresets = Array.from(new Set([...s.labelPresets, ...(t.labelPresets ?? [])]))
    const cmfPresets = Array.from(new Set([...s.cmfPresets, ...(t.cmfPresets ?? [])]))
    if (labelPresets.length !== s.labelPresets.length) savePresets(LABEL_PRESET_KEY, labelPresets, DEFAULT_LABEL_PRESETS)
    if (cmfPresets.length !== s.cmfPresets.length) savePresets(CMF_PRESET_KEY, cmfPresets, DEFAULT_CMF_PRESETS)
    saveAnnTemplate(annTemplate)

    const aspect = pageAspect(t.exportPreset)
    set({
      globalLineWidth: t.lineWidth,
      globalAnchorSize: t.anchorSize,
      globalEndStyle: t.endStyle,
      globalLineColor: t.lineColor ?? LINE_COLOR,
      // 与面板滑块一致：引线样式立刻同步到已有标注（栏目结构只作用于新建的标注）
      // 单条锁过颜色的标注保持自己的颜色，不被模板覆盖
      annotations: s.annotations.map((a) => ({
        ...a,
        lineWidth: t.lineWidth,
        anchorSize: t.anchorSize,
        endStyle: t.endStyle,
        lineColor: a.lineColorLocked ? a.lineColor : t.lineColor ?? LINE_COLOR
      })),
      annTemplate,
      info: refreshInfoDate(mergeInfoFields(s.info, t.infoFields)),
      infoScale: t.infoScale,
      // 模板里存的是用户选好的尺寸，套用后不再跟随图片自动改
      infoScaleAuto: false,
      infoVisible: t.infoVisible,
      infoRule: t.infoRule !== false,
      logo: t.logo ? { ...t.logo } : null,
      watermark: { ...emptyWatermark(), ...(t.watermark ?? {}) },
      // 导出参数落到选中的画板上（比例变了就把框按新比例重贴，避免变形）
      artboards: s.artboards.map((b) =>
        s.selectedBoardIds.includes(b.id)
          ? {
              ...(aspect ? refitBoard(b, safePreset(t.exportPreset)) : { ...b, preset: safePreset(t.exportPreset) }),
              dpi: clampDpi(t.exportDpi),
              dpiCustom: t.exportDpiCustom,
              format: t.exportFormat,
              native: false
            }
          : b
      ),
      labelPresets,
      cmfPresets
    })
  },

  deleteTemplate: (id) =>
    set((s) => {
      const next = s.templates.filter((t) => t.id !== id)
      saveTemplates(next)
      return { templates: next }
    }),

  renameTemplate: (id, name) =>
    set((s) => {
      const v = name.trim()
      if (!v) return {}
      const next = s.templates.map((t) => (t.id === id ? { ...t, name: v } : t))
      saveTemplates(next)
      return { templates: next }
    }),

  importTemplate: (raw) => {
    const t = normalizeTemplate(raw)
    if (!t) return null
    const s = get()
    const next: CMFTemplate = { ...t, id: uid(), name: uniqueTemplateName(t.name, s.templates), createdAt: Date.now() }
    const list = [next, ...s.templates]
    saveTemplates(list)
    set({ templates: list })
    return next
  }
}))
