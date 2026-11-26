// 把 assets/icon*.svg 导出成各尺寸 PNG（开发工具，不参与构建）
//   node scripts/make-icons.mjs [尺寸...]
// 依赖：一个开着远程调试的 Chrome（--remote-debugging-port=9226）
// 说明：用 Chrome 渲染而不是引第三方库，几何/描边与站点 favicon 完全同源，
//       边缘是逐尺寸矢量重绘（不是缩图），所以 16px 也不糊。
import fs from 'node:fs'
import path from 'node:path'

const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const OUT_DIR = 'assets/icons'
const SIZES = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : [1024, 512, 256, 128, 64, 48, 32, 16]

const read = (p) => fs.readFileSync(p, 'utf8')
const inner = (svg) => svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// 页面只做一件事：把母版 svg 铺满视口，背景保持透明
const page = (body) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:transparent;overflow:hidden}
      svg{display:block;width:100vw;height:100vh}
    </style><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>`
  )}`

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

fs.mkdirSync(OUT_DIR, { recursive: true })

const shoot = async (body, size, out) => {
  await send('Emulation.setDeviceMetricsOverride', {
    width: size,
    height: size,
    deviceScaleFactor: 1,
    mobile: false
  })
  await send('Page.navigate', { url: page(body) })
  await new Promise((r) => setTimeout(r, 260))
  const shot = await send('Page.captureScreenshot', { format: 'png', omitBackground: true, captureBeyondViewport: false })
  const buf = Buffer.from(shot.data, 'base64')
  fs.writeFileSync(out, buf)
  // PNG 的宽高就写在 IHDR 里，顺手校验一下别导出成别的尺寸
  const w = buf.readUInt32BE(16)
  const h = buf.readUInt32BE(20)
  if (w !== size || h !== size) throw new Error(`${out} 实际 ${w}×${h}，期望 ${size}×${size}`)
  return `${path.basename(out)}  ${w}×${h}  ${(buf.length / 1024).toFixed(1)} KB`
}

const round = inner(read('assets/icon.svg'))
const square = inner(read('assets/icon-square.svg'))
const lines = []

for (const size of SIZES) {
  lines.push(await shoot(round, size, path.join(OUT_DIR, `icon-${size}.png`)))
}
// 方形版：iOS/Android 会自己加圆角，给它们留满幅底色
lines.push(await shoot(square, 1024, path.join(OUT_DIR, 'icon-square-1024.png')))
lines.push(await shoot(square, 180, path.join(OUT_DIR, 'apple-touch-icon-180.png')))

console.log(lines.join('\n'))
ws.close()
process.exit(0)
