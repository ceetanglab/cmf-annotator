// 轻量图标集（stroke 跟随 currentColor）
export type IconName =
  | 'undo'
  | 'redo'
  | 'cursor'
  | 'tag'
  | 'fit'
  | 'actual'
  | 'upload'
  | 'download'
  | 'json'
  | 'image'
  | 'layers'
  | 'minus'
  | 'plus'
  | 'chevron'
  | 'trash'
  | 'eye'
  | 'eye-off'
  | 'grip'
  | 'settings'
  | 'frame'
  | 'close'
  | 'info'
  | 'text'
  | 'line'
  | 'polyline'
  | 'rect'
  | 'circle'
  | 'lock'
  | 'unlock'
  | 'swap'

const paths: Record<IconName, JSX.Element> = {
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h9a6 6 0 0 1 0 12H8" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9h-9a6 6 0 0 0 0 12h5" />
    </>
  ),
  cursor: <path d="M5 3.5 19 12l-6.4 1.6L10 20z" />,
  tag: (
    <>
      <path d="M4 5v6.2c0 .5.2 1 .6 1.4l7.8 7.8c.8.8 2 .8 2.8 0l5-5c.8-.8.8-2 0-2.8L12.4 4.8a2 2 0 0 0-1.4-.6H5.8A1.8 1.8 0 0 0 4 5z" />
      <circle cx="8.4" cy="8.4" r="1.3" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9" />
      <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </>
  ),
  actual: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M8 12h8M12 8v8" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4M8 8l4-4 4 4" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12M8 12l4 4 4-4" />
      <path d="M4 18v1.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V18" />
    </>
  ),
  json: (
    <>
      <path d="M9.5 4H8a2 2 0 0 0-2 2v3.2c0 1-.5 1.8-1.5 1.8 1 0 1.5.8 1.5 1.8V19a2 2 0 0 0 2 2h1.5" />
      <path d="M14.5 4H16a2 2 0 0 1 2 2v3.2c0 1 .5 1.8 1.5 1.8-1 0-1.5.8-1.5 1.8V19a2 2 0 0 1-2 2h-1.5" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="8.8" cy="9.8" r="1.5" />
      <path d="m4.5 17 4.6-4.2a1.6 1.6 0 0 1 2.1 0l3 2.7 1.9-1.7a1.6 1.6 0 0 1 2.1 0l2.3 2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.6L12 12.7 3.5 8.1z" />
      <path d="m4 12.4 8 4.3 8-4.3" />
      <path d="m4 16.6 8 4.3 8-4.3" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  plus: <path d="M12 5v14M5 12h14" />,
  chevron: <path d="m9 5.5 6.5 6.5L9 18.5" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3V7" />
      <path d="M6.5 7l.9 12.1c0 .9.8 1.6 1.7 1.6h5.8c.9 0 1.7-.7 1.7-1.6L17.5 7" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.6 3.3" />
      <path d="M6.2 7.9A17 17 0 0 0 2.5 12S6 18.2 12 18.2c1.4 0 2.7-.3 3.8-.9" />
      <path d="M9.9 9.9a3.1 3.1 0 0 0 4.2 4.2" />
      <path d="M3.5 20.5 20.5 3.5" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),
  // 导出设置：三档滑杆（比齿轮更贴「页面比例 / 分辨率 / 格式」这类参数）
  settings: (
    <>
      <path d="M4 7h7M15 7h5" />
      <circle cx="13" cy="7" r="2.1" />
      <path d="M4 12h4M12 12h8" />
      <circle cx="10" cy="12" r="2.1" />
      <path d="M4 17h9M17 17h3" />
      <circle cx="15" cy="17" r="2.1" />
    </>
  ),
  // 原分辨率：取景框四角——按这块区域的原像素取图，不是「一张纸」
  frame: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>
  ),
  close: (
    <>
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </>
  ),
  // 提示：圆圈 + i（「关于」里的数据保存说明用）
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11.2v5" />
      <circle cx="12" cy="7.9" r="0.95" fill="currentColor" stroke="none" />
    </>
  ),
  // 形状标注工具：五种笔画都画在 24×24 里，缩到 15px 也能分辨
  text: (
    <>
      <path d="M5 6h14M12 6v13M9 19h6" />
    </>
  ),
  line: <path d="M5 18.5 19 5.5" />,
  polyline: (
    <>
      <path d="M4 17.5 9 7l5.5 10L20 6" />
      <circle cx="9" cy="7" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="17" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  rect: <rect x="4" y="6" width="16" height="12" rx="1" />,
  circle: <circle cx="12" cy="12" r="7.5" />,
  // 尺寸栏：锁 / 开锁 / 互换长宽
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.2" rx="2" />
      <path d="M8.4 10.5V7.9a3.6 3.6 0 0 1 7.2 0v2.6" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.2" rx="2" />
      <path d="M8.4 10.5V7.9a3.6 3.6 0 0 1 6.7-1.8" />
    </>
  ),
  swap: (
    <>
      <path d="M4 8.6h11.6l-2.5-2.5" />
      <path d="M20 15.4H8.4l2.5 2.5" />
    </>
  )
}

export default function Icon({ name, size = 15 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {paths[name]}
    </svg>
  )
}
