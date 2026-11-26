// 把 assets/icons 里的 PNG 拼成一张对照图（开发工具，不参与构建）
//   node scripts/icon-sheet.mjs
// 依赖：一个开着远程调试的 Chrome（--remote-debugging-port=9226）
import fs from 'node:fs'

const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const OUT = 'assets/icons/preview.png'
const ROWS = [
  { title: '原生尺寸（不缩放，就是文件里的真实像素）', mode: 'real', files: ['icon-64.png', 'icon-48.png', 'icon-32.png', 'icon-16.png'] },
  { title: '小尺寸放大 3×（最近邻，看边缘有没有糊）', mode: 'zoom3', files: ['icon-64.png', 'icon-48.png', 'icon-32.png', 'icon-16.png'] },
  { title: '圆角版 · 常用尺寸（等比缩到 176px 展示）', mode: 'fit', files: ['icon-1024.png', 'icon-512.png', 'icon-256.png', 'icon-128.png'] },
  { title: 'iOS / Android 方形（系统自己加圆角）', mode: 'fit', files: ['icon-square-1024.png', 'apple-touch-icon-180.png'] }
]

const dataUrl = (f) => `data:image/png;base64,${fs.readFileSync(`assets/icons/${f}`).toString('base64')}`

const cell = (f, zoom = 0) => {
  const size = Number(f.match(/(\d+)\.png$/)[1])
  // zoom=0 表示「真实像素」；否则按给定倍数放大（最近邻，好看清像素边缘）
  const box = zoom ? size * zoom : size
  return `<figure>
    <img src="${dataUrl(f)}" style="width:${box}px;height:${box}px;image-rendering:${zoom ? 'pixelated' : 'auto'}">
    <figcaption>${size}×${size}${zoom ? ` · ${zoom}×` : ' · 实际大小'}</figcaption>
  </figure>`
}

const big = (f) => {
  const size = Number(f.match(/(\d+)\.png$/)[1])
  return `<figure>
    <img src="${dataUrl(f)}" style="width:176px;height:176px">
    <figcaption>${size}×${size}</figcaption>
  </figure>`
}

const render = (r) =>
  r.files.map((f) => (r.mode === 'real' ? cell(f, 0) : r.mode === 'zoom3' ? cell(f, 3) : big(f))).join('')

const html = `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;padding:28px 30px;background:#f4f3f8;font:13px/1.5 -apple-system,"Segoe UI","PingFang SC",sans-serif;color:#2b2840}
  h2{margin:0 0 14px;font-size:14px;letter-spacing:.4px;color:#6b6683;font-weight:600}
  section{margin-bottom:26px}
  .row{display:flex;align-items:flex-end;gap:26px}
  figure{margin:0;text-align:center}
  img{display:block;border-radius:0;box-shadow:0 1px 4px rgba(60,50,110,.13)}
  figcaption{margin-top:8px;font-size:11px;color:#8b869c;white-space:nowrap}
</style>
${ROWS.map((r) => `<section><h2>${r.title}</h2><div class="row">${render(r)}</div></section>`).join('')}`

const list = await (await fetch(`${CDP}/json/list`)).json()
const target = list.find((t) => t.type === 'page')
if (!target) throw new Error('没有可用的页面目标')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
let id = 0
const waiting = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id)
    waiting.delete(m.id)
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = ++id
    waiting.set(n, { resolve, reject })
    ws.send(JSON.stringify({ id: n, method, params }))
  })

await send('Emulation.setDeviceMetricsOverride', { width: 780, height: 760, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` })
await new Promise((r) => setTimeout(r, 320))
const { result } = await send('Runtime.evaluate', {
  expression: 'JSON.stringify({w:document.body.scrollWidth,h:document.body.scrollHeight})',
  returnByValue: true
})
const { w, h } = JSON.parse(result.value)
await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false })
await new Promise((r) => setTimeout(r, 160))
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(`${OUT}  ${w}×${h} @2x`)
ws.close()
process.exit(0)
