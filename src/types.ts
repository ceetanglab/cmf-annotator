// 标注里的一个栏目行：可拖动排序、改栏目名、删除、隐藏
export interface CMFRow {
  key: string       // 内置字段 key（color/material/finish/process/note）或自定义行 'c_xxx'
  label: string     // 栏目名（可改，画布上显示的就是它）
  value: string     // 内容（内置行以 cmf 对应字段为准，自定义行存在这里）
  hidden?: boolean  // 隐藏：面板里保留可随时打开，画布上不显示
  slash?: boolean   // 空值时是否在文本框/画布上显示占位斜杠 `/`（false = 真空白）
}

export interface CMFMeta {
  name: string      // 部件名称（标注框标题）
  color: string     // 颜色：现在以 Pantone 色号为主（如「186 C」），老工程里的 #RRGGBB 会迁成色号
  colorPicked?: string // 用户最近一次手选的具体色值，用来显示色块与 ΔE；缺省=色号自己的近似色
  material: string  // 材质
  finish: string    // 工艺
  process: string   // 制作工序
  note: string      // 特别说明
  rows?: CMFRow[]   // 行式编辑数据（顺序 / 栏目名 / 增删 / 隐藏）；缺省=内置五行
  noName?: boolean  // 名称行已删除（画布不画标题与粗线）
  nameHidden?: boolean // 名称行被眼睛隐藏（同上，但保留内容可随时打开）
}

export type AnchorStyle = 'dot' | 'arrow'

export interface CMFAnnotation {
  id: string
  anchor: { x: number; y: number } // 引线在渲染图上的锚点（content 坐标）
  label: { x: number; y: number }  // 文本块位置
  scale?: number                   // 文本块缩放比例（自由放大缩小）
  lineWidth?: number               // 引线（引导线）粗细
  anchorSize?: number              // 锚点（圆点）半径；箭头端点的尺寸也以它为基准等比缩放
  endStyle?: AnchorStyle           // 引线端点：圆点 / 箭头（缺省圆点）
  lineColor?: string               // 引线与锚点颜色（缺省 CMF 红）
  /** 颜色被单独调整过：全局改色不再覆盖它（点「跟随全局」清掉此标记） */
  lineColorLocked?: boolean
  hidden?: boolean                 // 图层隐藏（不渲染、不参与导出包围盒）
  z?: number                       // 图层层级（越大越靠上），与图片共用一套序号
  groupId?: string                 // 所属图层分组（缺省 = 未分组）
  cmf: CMFMeta
  createdAt: number
}

export interface InfoField {
  id: string           // 唯一 id（用于增删与稳定渲染）
  label: string        // 栏目名（标签）
  value: string        // 栏目内容
  hidden?: boolean     // 隐藏：面板里保留可随时打开，画布上不显示该行
}

export interface ProjectInfo {
  fields: InfoField[]  // 可自由增删的栏目；首行为标题（大字），其余为「标签：内容」
}

export interface ImageItem {
  id: string
  dataUrl: string
  name: string
  x: number           // 画布 content 坐标
  y: number
  w: number           // 自然宽高
  h: number
  hidden?: boolean    // 图层隐藏（不渲染、不参与导出包围盒）
  z?: number          // 图层层级（与标注共用一套序号）
  groupId?: string    // 所属图层分组
}

// 标注形状：文本框 / 直线 / 折线 / 矩形 / 圆形。
// 和图片、标注共用一套 z 序号，所以能互相压盖；坐标同样在 content 空间。
export type ShapeKind = 'text' | 'line' | 'polyline' | 'rect' | 'circle'

export interface ShapeItem {
  id: string
  kind: ShapeKind
  x: number               // 包围盒（content 坐标）：所有形状都按「框 + 内部几何」存
  y: number
  w: number
  h: number
  color: string           // 线条色 / 文字色
  strokeWidth: number     // 线宽（文本不用）
  opacity: number         // 0.05 ~ 1
  fill?: string | null    // 矩形 / 圆形内部填充；null 或缺省 = 不填充
  text?: string           // 文本框内容
  fontSize?: number       // 文本框字号
  /** 直线 / 折线：归一化折点（0~1，相对自身包围盒），改包围盒即等比变形 */
  points?: { x: number; y: number }[]
  /** 拖角缩放时锁定长宽比例（默认不锁，矩形 / 圆形可以自由拉成任意比例） */
  lockRatio?: boolean
  hidden?: boolean
  z?: number
  groupId?: string
}

// 图层分组：只负责「归堆 + 一起显隐 / 一起改层级」，不改变对象自身坐标
export interface LayerGroup {
  id: string
  name: string
  hidden?: boolean    // 整组隐藏（组内成员跟着不渲染，但各自的 hidden 状态保留）
  collapsed?: boolean // 图层列表里折叠
}

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf' | 'svg'

// 品牌标识（信息栏卡片内的 logo）：图片以 dataURL 随工程保存，宽度按信息栏内宽的比例
export interface LogoMeta {
  dataUrl: string
  w: number            // 原始像素宽
  h: number            // 原始像素高
  ratio: number        // 显示宽度占信息栏内宽的比例（0.2 ~ 1）
  place?: 'top' | 'bottom' // 放在标题上方（默认）还是信息栏底部
}

// 水印：单个可拖动文字 / 平铺重复文字
export interface WatermarkMeta {
  on: boolean
  mode: 'single' | 'tile'
  text: string
  size: number         // 字号（content 像素，1~100）
  density: number      // 1~100，越大越密（平铺时行列间距随之收缩）
  densityV?: number    // 密度刻度版本（2 = 1~100；缺省视为旧的 1~10，加载时自动换算）
  opacity: number      // 0.01 ~ 1（面板按 1%~100% 调）
  x?: number           // 单水印位置（content 坐标，缺省 = 内容中心）
  y?: number
}

export interface ExportRect {
  x: number
  y: number
  w: number
  h: number
}

// 画板 = 一块独立的导出区域（相当于设计工具里的「画板 / 页面」）。
// 一个工程可以有多块，各自有自己的比例、底色和导出设置，一次可以只出其中一块，也可以全部出。
// 坐标与标注同在 content 空间，所以移动图片时画板不会跟着跑——画板是「取景框」，不是内容。
export interface Artboard extends ExportRect {
  id: string
  name: string
  preset: string             // 画板比例（PAGE_PRESETS 的 key）
  bg?: string                // 底色；缺省 = 透明（PNG / SVG 出图不带底）
  /** 跟随内容自动外扩（新建时为 true；手动拖动或缩放后自动关掉，「贴合内容」可再打开） */
  auto?: boolean
  // ---- 这块画板自己的导出设置（缺省时回落到全局默认值） ----
  format?: ExportFormat
  dpi?: number
  dpiCustom?: boolean
  /** 导出原分辨率：不按 DPI 缩放，输出 = 画板像素 1:1 */
  native?: boolean
}

// ---- 模板：一套可复用的「全局 + 标注」设置 ----
// 新建标注时套用的栏目结构（rows 里的 value 一律为空，模板只存结构不存内容）
export interface AnnTemplate {
  rows: CMFRow[]
  noName?: boolean   // 模板不要标题（纯参数表样式）
}

export interface CMFTemplate {
  kind: 'cmf-template'   // 与工程文件区分：拖入 / 导入时靠它分流
  version: 1
  id: string
  name: string
  createdAt: number
  // 引线样式（应用到已有标注 + 作为以后新建的默认值）
  lineWidth: number
  anchorSize: number
  endStyle: AnchorStyle
  lineColor?: string
  // 新建标注的默认栏目
  annRows: CMFRow[]
  annNoName?: boolean
  // 信息栏结构：只存栏目名与显隐，内容值留在当前工程里
  infoFields: { label: string; hidden?: boolean }[]
  infoScale: number
  infoVisible: boolean
  infoRule?: boolean     // 标题下横线开关
  logo: LogoMeta | null
  watermark: WatermarkMeta | null
  // 导出设置
  exportPreset: string
  exportDpi: number
  exportDpiCustom: boolean
  exportFormat: ExportFormat
  // 栏目名下拉里的自定义项（应用模板时并入本地库）
  labelPresets?: string[]
  cmfPresets?: string[]
}

export interface CMFProject {
  version: 2
  info: ProjectInfo
  name?: string        // 导出文件名（默认取 info.project）
  images: ImageItem[]  // 多张渲染图（同画布拼接）
  annotations: CMFAnnotation[]
  /** 标注形状（文本框 / 直线 / 折线 / 矩形 / 圆形） */
  shapes?: ShapeItem[]
  groups?: LayerGroup[] // 图层分组
  /** 画板列表（≥1 块）；老工程没有这个字段，加载时用下面的 export* 字段迁移成一块 */
  artboards?: Artboard[]
  updatedAt: number
  infoScale?: number                              // 信息栏整体缩放（默认 1）
  lineColor?: string                              // 全局引线颜色（缺省 CMF 红）
  infoScaleAuto?: boolean                         // 尺寸是否仍跟随图片自动定（缺省按 infoScale===1 推断）
  infoPos?: { x: number; y: number } | null       // 信息栏位置（null = 自动贴右）
  infoVisible?: boolean                           // 信息栏是否显示（默认 true）
  infoRule?: boolean                              // 标题下横线是否显示（默认 true）
  logo?: LogoMeta | null                          // 信息栏里的品牌标识
  watermark?: WatermarkMeta | null                // 水印
  // 导出设置：v0.3 起「区域 / 比例 / DPI / 格式」都搬到了每块画板上（artboards），
  // 下面这几个只用于读老工程做迁移，新工程不再写
  exportRect?: ExportRect                         // 老字段：唯一的导出区域
  exportScale?: number                            // 旧版分辨率倍率（保留兼容）
  exportPreset?: string                           // 老字段：页面比例预设 key
  exportDpi?: number                              // 老字段：输出 DPI
  exportDpiCustom?: boolean                       // 老字段：自定义 DPI 模式
  exportNative?: boolean                          // 老字段：原分辨率
  exportFormat?: ExportFormat                     // 老字段：导出格式
  exportName?: string                             // 导出文件名（不含扩展名，默认「CMF 总表」）
}
