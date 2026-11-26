import { useEffect, useRef } from 'react'
import Icon from './Icon'
// 图片靠 vite.config 的 assetsInlineLimit 内联成 base64：单文件产物（dist/cmf-annotator.html）
// 不能有外挂图片，否则离线双击打开时二维码是一片空白
import qrSrc from '../../assets/wechat-qr.jpg'

/**
 * 公众号二维码弹窗：点「关于」卡里的「造型食堂」即可弹出。
 * 只在需要时才挂载（open 为假直接返回 null），省得图片白白占一次解码。
 */
export default function QrDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    // 捕获阶段拦 Esc：画布的「取消选择 / 退出框选」也在监听 Esc
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="qr-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="qr-x" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <Icon name="close" size={13} />
        </button>
        <p className="qr-title" id="qr-title">
          造型食堂
        </p>
        <p className="qr-sub">微信扫码关注 · 留言反馈</p>
        <img className="qr-img" src={qrSrc} alt="造型食堂 公众号二维码" />
        <p className="qr-hint">关注后在公众号留言，看到会尽快回。</p>
      </div>
    </div>
  )
}
