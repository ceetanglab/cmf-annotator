// 字体：CMF 表统一用思源黑体（Source Han Sans / Noto Sans CJK 同一套字形）
// 名字写全：思源黑体在不同系统里有 SC / CN / 中文名几种注册名，逐级回退
// 最后两级兜底到系统自带黑体，保证没装思源黑体的同事打开也不会掉成宋体
export const FONT_STACK =
  '"Source Han Sans SC", "Source Han Sans CN", "Source Han Sans", ' +
  '"Noto Sans SC", "Noto Sans CJK SC", "思源黑体", "思源黑体 CN", ' +
  '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif'

// Konva 的 fontStyle 会原样拼进 canvas 的 font 简写，所以直接用 CSS 的字重写法
export const WEIGHT_REGULAR = 'normal' // 400
export const WEIGHT_BOLD = 'bold' // 700
