// 画板功能的演示截图（开发自查用）
//   node scripts/board-shot.mjs [url] [输出.png]
import fs from 'node:fs'

const APP = process.argv[2] || 'http://localhost:5173/'
const OUT = process.argv[3] || 'shots/boards.png'
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

const errors = []
await send('Runtime.enable')
await send('Log.enable')
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text)
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(m.params.entry.text)
})

await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: APP })
await sleep(2400)

const setup = await evaluate(`(() => {
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
  // 清空画面会保留画板（换一组图不用重摆版），演示前先收回到一块
  S.setState({ artboards: S.getState().artboards.slice(0, 1), selectedBoardIds: [S.getState().artboards[0].id] })
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
  S.getState().setAnnLineColor('a4', '#1f2329')
  S.getState().applyGlobalStyle({ lineColor: '#e60012' })
  // 第二块画板：1:1，带底色，放在右侧
  const b2 = S.getState().addBoard('square', { x: 760, y: -120, w: 760, h: 760 })
  S.getState().updateBoard(b2.id, { bg: '#eef0f4', name: '细节图' }, { keepAuto: true })
  S.getState().renameBoard(b2.id, '细节图')
  S.getState().selectBoard(b2.id)
  return { boards: S.getState().artboards.map((b) => ({ id: b.id, name: b.name, preset: b.preset, w: Math.round(b.w), h: Math.round(b.h), auto: !!b.auto, bg: b.bg })) }
})()`)
await sleep(900)

await send('Page.navigate', { url: APP })
await sleep(2600)
// 第二块画板在很右边：先定位过去，再进「画板」页把右侧面板亮出来
const after = await evaluate(`(async () => {
  const S = window.__cmf.store
  const b = S.getState().artboards[1]
  S.getState().selectBoard(b.id)
  window.__cmf.controls.current.showBoard(b.id)
  // 展开左侧「导出设置」，让截图同时看到画板列表与导出参数
  const heads = [...document.querySelectorAll('.left .sect-head')]
  const exp = heads.find((h) => h.textContent.includes('导出设置'))
  if (exp && !exp.parentElement.classList.contains('is-open')) exp.click()
  await new Promise((r) => setTimeout(r, 500))
  return { scale: +(window.__cmf.stage.scaleX() || 0).toFixed(3), focused: S.getState().boardFocus,
           tab: document.querySelector('.right-tab.on')?.textContent?.trim() }
})()`)
await sleep(600)
// 第四个参数写 fit：出图前先「适应视图」，用来看整窗布局而不是单块画板
if (process.argv[4] === 'fit') {
  await evaluate(`window.__cmf.controls.current.fit()`)
  await sleep(800)
}
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
console.log(JSON.stringify({ boards: setup.boards, after, errors }, null, 2))
ws.close()
process.exit(0)
