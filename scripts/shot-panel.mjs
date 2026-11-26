// 局部截图：先按选择器滚动 / 选中，再截某个面板（开发自查用，不参与构建）
//   node scripts/shot-panel.mjs <url> <输出.png> <CSS选择器> [滚动到底部?] [额外 JS]
import fs from 'node:fs'

const [APP, OUT = 'tmp-panel.png', SEL = '.right', SCROLL = '', EXTRA = ''] = process.argv.slice(2)
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const list = await (await fetch(`${CDP}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) throw new Error('没有可用的页面目标')
const ws = new WebSocket(page.webSocketDebuggerUrl)
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
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval error')
  return r.result.value
}

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: APP })
await sleep(2500)
if (EXTRA) {
  await evaluate(EXTRA)
  await sleep(500)
}
if (SCROLL) {
  await evaluate(`(() => { const el = document.querySelector('${SEL}'); el.scrollTop = el.scrollHeight; return el.scrollTop })()`)
  await sleep(400)
}
const box = await evaluate(
  `(() => { const el = document.querySelector('${SEL}'); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`
)
const shot = await send('Page.captureScreenshot', {
  format: 'png',
  clip: { ...box, scale: 2 }
})
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
ws.close()
process.exit(0)
