// 演示截图（开发自查用）：造一个「两张渲染图 + 四条标注 + 一个分组」的工程并截图
//   node scripts/demo-shot.mjs [url] [输出.png]
import fs from 'node:fs'

const APP = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || 'shots/demo.png'
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
await sleep(2400)

await evaluate(`(() => {
  const S = window.__cmf.store
  const mk = (t, c, w = 760, h = 520) => {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h
    const g = cv.getContext('2d')
    const grd = g.createLinearGradient(0, 0, w, h); grd.addColorStop(0, c); grd.addColorStop(1, '#f2f3f5')
    g.fillStyle = grd; g.fillRect(0, 0, w, h)
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '700 40px sans-serif'; g.fillText(t, 40, 90)
    return cv.toDataURL('image/png')
  }
  const st = S.getState()
  st.clearCanvas()
  st.addImages([
    { id: 'd1', dataUrl: mk('Front', '#b9c2cc'), name: '正面.png', x: 0, y: 0, w: 760, h: 520 },
    { id: 'd2', dataUrl: mk('Side', '#cbb9a3'), name: '侧面.png', x: 800, y: 0, w: 760, h: 520 }
  ])
  const mkAnn = (id, name, color, mat, ax, ay, lx, ly) =>
    S.getState().addAnnotation({
      id, anchor: { x: ax, y: ay }, label: { x: lx, y: ly },
      cmf: { name, color, material: mat, finish: '喷涂', process: '注塑→喷涂', note: '' }, createdAt: 1
    })
  mkAnn('a1', '前壳', '#e60012', 'PC+ABS', 220, 200, 0, -520)
  mkAnn('a2', '装饰圈', '#8b8f96', '铝合金', 520, 320, 340, 560)
  mkAnn('a3', '按键', '#e60012', 'TPU', 1000, 220, 780, -520)
  mkAnn('a4', 'logo', '#5b6270', '丝印', 1250, 380, 1120, 560)
  S.setState({ selectedIds: ['d1', 'a1'] })
  S.getState().groupSelectedLayers()
  S.setState({ selectedIds: [] })
  // 一条标注单独锁深灰，其余跟随全局红
  S.getState().setAnnLineColor('a4', '#1f2329')
  S.getState().applyGlobalStyle({ lineColor: '#e60012' })
  return true
})()`)
await sleep(900)

// 重新载入：让「适应视图」按新内容重新贴合（顺便验证存档能完整恢复）
await send('Page.navigate', { url: APP })
await sleep(2600)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
ws.close()
process.exit(0)
