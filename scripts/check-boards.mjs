// 画板（多画板导出）的交互自测（开发期工具，不参与构建）
//   node scripts/check-boards.mjs [url]
// 依赖：一个开着远程调试的 Chrome（--remote-debugging-port=9226）
import fs from 'node:fs'
import path from 'node:path'

const APP = process.argv[2] || 'http://localhost:5173/'
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const DL = path.resolve('shots/dl')
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

const log = []
const check = (name, ok, extra = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)

console.error('[1] connected')
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
// 导出会触发下载：落到 shots/dl，测试自己数文件
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await send('Page.navigate', { url: APP })
// 页面不在前台时 renderer 会丢掉 Input 事件（点了没反应），先置前
await send('Page.bringToFront')
await sleep(2200)
console.error('[2] navigated')

// ---- 造工程：两张图 + 两块画板（一块自动、一块手动） ----
const setup = await evaluate(`(async () => {
  const S = window.__cmf.store
  const mk = (txt, color, w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h)
    g.fillStyle = '#fff'; g.font = '700 40px sans-serif'; g.fillText(txt, 24, 70)
    return c.toDataURL('image/png')
  }
  const st = S.getState()
  st.clearCanvas()
  // 清空会保留画板：先收回到一块空的，再走正常导入流程
  S.setState({ artboards: S.getState().artboards.slice(0, 1) })
  S.getState().addImages([
    { id: 'img-a', dataUrl: mk('A', '#8f9aa8', 640, 420), name: 'a.png', x: 0, y: 0, w: 640, h: 420 },
    { id: 'img-b', dataUrl: mk('B', '#c8b49a', 640, 420), name: 'b.png', x: 700, y: 0, w: 640, h: 420 }
  ])
  await new Promise((r) => setTimeout(r, 300))
  const first = S.getState().artboards[0]
  // 第一块：手动框住左侧那张图
  S.getState().updateBoard(first.id, { x: 0, y: 0, w: 640, h: 420, preset: 'free' })
  // 第二块：手动框住右侧那张图，1:1
  const b2 = S.getState().addBoard('square', { x: 700, y: 0, w: 640, h: 640 })
  S.getState().selectBoard(first.id)
  return { n: S.getState().artboards.length, ids: S.getState().artboards.map((b) => b.id) }
})()`)
await sleep(600)
console.error('[3] project built', JSON.stringify(setup))

// ---- 1. 左栏画板列表 ----
let r = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.board-list .board-row')]
  return { n: rows.length, idx: rows.map((x) => x.querySelector('.board-idx')?.textContent),
           names: rows.map((x) => x.querySelector('.board-txt strong')?.textContent) }
})()`)
check('左栏画板列表列出 2 块并带序号', r.n === 2 && r.idx[0] === '01' && r.idx[1] === '02', JSON.stringify(r))

// ---- 2. 画布上真的画了 2 个画板框 ----
r = await evaluate(`(() => {
  const stage = window.__cmf.stage
  const nodes = stage.find('Rect').filter((n) => (n.id() || '').startsWith('board-'))
  return { n: nodes.length, w: nodes.map((n) => Math.round(n.width())), h: nodes.map((n) => Math.round(n.height())) }
})()`)
check('画布上有 2 个画板框', r.n === 2, JSON.stringify(r))

// ---- 3. 多选后批量改比例 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  S.getState().selectAllBoards()
  S.getState().setBoardPreset('square')
  await new Promise((r) => setTimeout(r, 200))
  const bs = S.getState().artboards
  return { n: S.getState().selectedBoardIds.length, ratios: bs.map((b) => +(b.w / b.h).toFixed(3)), preset: bs.map((b) => b.preset) }
})()`)
check('多选批量改比例：两块都变成 1:1', r.n === 2 && r.ratios.every((x) => Math.abs(x - 1) < 0.01) && r.preset.every((p) => p === 'square'), JSON.stringify(r))

// ---- 4. 批量改底色 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  S.getState().setBoardBg('#1f2329')
  return S.getState().artboards.map((b) => b.bg)
})()`)
check('多选批量改底色', r.every((c) => c === '#1f2329'), JSON.stringify(r))

// ---- 5. 单选改比例只影响一块 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  const [a, b] = S.getState().artboards
  S.getState().selectBoard(a.id)
  S.getState().setBoardPreset('a4l')
  const bs = S.getState().artboards
  return { first: bs[0].preset, second: bs[1].preset }
})()`)
check('单选改比例不影响另一块', r.first === 'a4l' && r.second === 'square', JSON.stringify(r))

// ---- 6. 右侧面板跟着画板选择走 ----
r = await evaluate(`(() => {
  return { tab: document.querySelector('.right-tab.on')?.textContent?.trim(),
           hasGrid: !!document.querySelector('.preset-grid'),
           swatches: document.querySelectorAll('.bg-swatch').length }
})()`)
check('右侧切到「画板」页并显示比例 / 底色', r.tab === '画板' && r.hasGrid && r.swatches === 5, JSON.stringify(r))

// ---- 7. 真实拖动一块画板：只动它，且自动画布关掉 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store, stage = window.__cmf.stage
  // 摆到固定位置；视图用 actualSize 定住，屏幕坐标一律按 stage 的当前变换换算
  S.setState({ artboards: S.getState().artboards.map((b, i) => ({ ...b, x: 100 + i * 600, y: 100, w: 400, h: 400, auto: false })) })
  S.getState().selectBoard(S.getState().artboards[0].id)
  window.__cmf.controls.current.actualSize()
  await new Promise((r) => setTimeout(r, 300))
  const b = S.getState().artboards[0]
  const rect = stage.container().getBoundingClientRect()
  return { x: rect.left + stage.x() + (b.x + 3) * stage.scaleX(), y: rect.top + stage.y() + (b.y + 200) * stage.scaleY(), scale: stage.scaleX(),
           before: S.getState().artboards.map((b2) => Math.round(b2.x)) }
})()`)
const beforeDrag = r
const mouse = (type, x, y) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 })
await mouse('mousePressed', beforeDrag.x, beforeDrag.y)
await sleep(60)
await mouse('mouseMoved', beforeDrag.x + 90, beforeDrag.y + 30)
await sleep(60)
await mouse('mouseMoved', beforeDrag.x + 180, beforeDrag.y + 60)
await sleep(60)
await mouse('mouseReleased', beforeDrag.x + 180, beforeDrag.y + 60)
await sleep(400)
r = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  return { xs: S.artboards.map((b) => Math.round(b.x)), auto: S.artboards.map((b) => !!b.auto) }
})()`)
const moveDx = 180 / beforeDrag.scale
check(
  '拖动画板只挪它自己，并退出跟随时',
  Math.abs(r.xs[0] - beforeDrag.before[0] - moveDx) < 3 && r.xs[1] === beforeDrag.before[1] && r.auto.every((a) => a === false),
  JSON.stringify({ want: Math.round(moveDx), got: r.xs[0] - beforeDrag.before[0], other: r.xs[1] - beforeDrag.before[1] })
)

// ---- 8. 多选画板整组拖动 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store, stage = window.__cmf.stage
  S.getState().selectAllBoards()
  await new Promise((r) => setTimeout(r, 250))
  const first = S.getState().artboards[0]
  const rect = stage.container().getBoundingClientRect()
  return { x: rect.left + stage.x() + (first.x + 3) * stage.scaleX(), y: rect.top + stage.y() + (first.y + 200) * stage.scaleY(), scale: stage.scaleX(),
           before: S.getState().artboards.map((b) => Math.round(b.x)) }
})()`)
const beforeMulti = r
await mouse('mousePressed', beforeMulti.x, beforeMulti.y)
await sleep(60)
await mouse('mouseMoved', beforeMulti.x + 60, beforeMulti.y)
await sleep(60)
await mouse('mouseMoved', beforeMulti.x + 120, beforeMulti.y)
await sleep(60)
await mouse('mouseReleased', beforeMulti.x + 120, beforeMulti.y)
await sleep(400)
r = await evaluate(`(() => window.__cmf.store.getState().artboards.map((b) => Math.round(b.x)))()`)
const multiDx = 120 / beforeMulti.scale
check(
  '多选拖动：两块画板一起走',
  Math.abs(r[0] - beforeMulti.before[0] - multiDx) < 3 && Math.abs(r[1] - beforeMulti.before[1] - multiDx) < 3,
  JSON.stringify({ want: Math.round(multiDx), got: [r[0] - beforeMulti.before[0], r[1] - beforeMulti.before[1]] })
)

// ---- 9. 自动画布：内容变大时画板跟着扩 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const st = S.getState()
  st.selectBoard(st.artboards[0].id)
  st.updateBoard(st.artboards[0].id, { x: 0, y: 0, w: 200, h: 200, auto: true }, { keepAuto: true })
  await new Promise((r) => setTimeout(r, 200))
  const small = Math.round(S.getState().artboards[0].w)
  // 塞一张远超画板的大图：自动画布应当向外扩
  const c = document.createElement('canvas'); c.width = 1600; c.height = 1200
  c.getContext('2d').fillRect(0, 0, 1600, 1200)
  st.addImages([{ id: 'img-big', dataUrl: c.toDataURL('image/png'), name: 'big.png', x: 0, y: 0, w: 1600, h: 1200 }])
  await new Promise((r) => setTimeout(r, 500))
  const big = Math.round(S.getState().artboards[0].w)
  return { small, big, auto: !!S.getState().artboards[0].auto }
})()`)
check('自动画布跟着内容向外扩', r.big > r.small + 100 && r.auto === true, JSON.stringify(r))

// ---- 10. 至少保留一块画板 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  const ids = S.getState().artboards.map((b) => b.id)
  S.getState().removeBoards(ids)
  return { left: S.getState().artboards.length }
})()`)
check('画板不能删光（至少留一块）', r.left === 1, JSON.stringify(r))

// ---- 11. 老工程迁移：只有 exportRect 的存档变成一块画板 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const proj = {
    version: 2, info: S.getState().info, images: S.getState().images.slice(0, 2), annotations: [],
    updatedAt: 1, exportRect: { x: 10, y: 20, w: 300, h: 300 }, exportPreset: 'a3l',
    exportDpi: 300, exportFormat: 'jpeg', exportNative: false
  }
  S.getState().loadProject(proj)
  await new Promise((r) => setTimeout(r, 300))
  const b = S.getState().artboards
  return { n: b.length, preset: b[0]?.preset, dpi: b[0]?.dpi, format: b[0]?.format, rect: [b[0]?.x, b[0]?.y] }
})()`)
check(
  '老工程的导出区域迁成一块画板',
  r.n === 1 && r.preset === 'a3l' && r.dpi === 300 && r.format === 'jpeg' && r.rect[0] === 10,
  JSON.stringify(r)
)

// ---- 12. 导出选中画板：下载 1 个 png，像素 = 画板比例 @ DPI ----
await evaluate(`(async () => {
  const S = window.__cmf.store
  const st = S.getState()
  st.clearCanvas()
  S.setState({ artboards: S.getState().artboards.slice(0, 1) })
  const c = document.createElement('canvas'); c.width = 600; c.height = 400
  const g = c.getContext('2d'); g.fillStyle = '#7f8b99'; g.fillRect(0, 0, 600, 400)
  st.addImages([{ id: 'ex1', dataUrl: c.toDataURL('image/png'), name: 'e.png', x: 0, y: 0, w: 600, h: 400 }])
  await new Promise((r) => setTimeout(r, 350))
  const b = S.getState().artboards[0]
  st.updateBoard(b.id, { x: 0, y: 0, w: 600, h: 400, preset: 'free', dpi: 96, dpiCustom: false, format: 'png', native: false, auto: false })
  S.getState().setExportName('单板测试')
})()`)
await sleep(400)
await evaluate(`window.__cmf.controls.current.exportBoards('selected')`)
await sleep(1500)
let files = fs.readdirSync(DL).filter((f) => !f.endsWith('.crdownload') && !/^downloads\.htm/.test(f))
const png1 = files.find((f) => f.startsWith('单板测试'))
let px = null
if (png1) {
  const buf = fs.readFileSync(path.join(DL, png1))
  px = { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
check(
  '导出选中画板：文件名与像素正确',
  files.length === 1 && !!png1 && png1.endsWith('.png') && px?.w === 600 && px?.h === 400,
  JSON.stringify({ files, px })
)

// ---- 13. 导出所有画板（统一设置）：文件名缀画板名 ----
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })
await evaluate(`(() => {
  const S = window.__cmf.store
  S.getState().addBoard('square', { x: 900, y: 0, w: 500, h: 500 })
  S.getState().setBoardExport({ dpi: 96, format: 'png' })
  S.getState().setExportName('全部测试')
})()`)
await sleep(400)
await evaluate(`window.__cmf.controls.current.exportBoards('all', true)`)
await sleep(2600)
files = fs.readdirSync(DL).filter((f) => !f.endsWith('.crdownload') && !/^downloads\.htm/.test(f))
check(
  '导出所有画板：两块各出一个文件且都带画板名',
  files.length === 2 && files.every((f) => f.startsWith('全部测试-') && f.endsWith('.png')),
  JSON.stringify(files)
)

// ---- 14. 不统一设置时按各画板自己的格式 ----
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })
await evaluate(`(() => {
  const S = window.__cmf.store
  const bs = S.getState().artboards
  // 第二块单独设成 jpeg
  S.getState().selectBoard(bs[1].id)
  S.getState().setBoardExport({ format: 'jpeg' })
  S.getState().selectBoard(bs[0].id)
})()`)
await sleep(300)
await evaluate(`window.__cmf.controls.current.exportBoards('all', false)`)
await sleep(2600)
files = fs.readdirSync(DL).filter((f) => !f.endsWith('.crdownload') && !/^downloads\.htm/.test(f))
check(
  '不统一设置：png 与 jpeg 各按自己的',
  files.length === 2 && files.some((f) => f.endsWith('.png')) && files.some((f) => f.endsWith('.jpeg')),
  JSON.stringify(files)
)

// ---- 15. SVG 底色：透明画板不带纸面填充，有底色时带上 ----
r = await evaluate(`(async () => {
  const mod = await import('/src/lib/svgExport.ts')
  const S = window.__cmf.store.getState()
  const base = {
    rect: { x: 0, y: 0, w: 400, h: 300 }, title: 't', pageW: 400, pageH: 300,
    fit: 1, offX: 0, offY: 0, ptW: 200, ptH: 150,
    images: S.images, annotations: S.annotations, info: S.info, infoPos: S.infoPos,
    infoScale: S.infoScale, infoVisible: S.infoVisible, infoRule: S.infoRule,
    logo: S.logo, watermark: S.watermark
  }
  const clear = mod.buildLayeredSvg({ ...base, pageBg: null })
  const solid = mod.buildLayeredSvg({ ...base, pageBg: '#1f2329' })
  const paper = (svg) => (/<g id="paper"[\\s\\S]*?<\\/g>/.exec(svg) || [''])[0]
  return { clear: /fill="#ffffff"/.test(paper(clear)), solid: /fill="#1f2329"/.test(paper(solid)) }
})()`)
check('SVG 纸面跟随画板底色', r.clear === false && r.solid === true, JSON.stringify(r))

// ---- 16. 撤销能还原画板删除（走界面按钮，避免动态 import 拿到另一个模块实例）----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const before = S.getState().artboards.length
  S.getState().removeBoards([S.getState().artboards[1].id])
  await new Promise((r) => setTimeout(r, 600))
  const mid = S.getState().artboards.length
  document.querySelector('.tbtn[title^="撤销"]').click()
  await new Promise((r) => setTimeout(r, 400))
  return { before, mid, after: S.getState().artboards.length }
})()`)
check('撤销能还原被删的画板', r.before === 2 && r.mid === 1 && r.after === 2, JSON.stringify(r))

// ---- 17. 「自由」画板拖角不锁等比；有页面规格时锁等比 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const stage = window.__cmf.stage
  const tr = stage.findOne('Transformer')
  S.getState().selectBoard(S.getState().artboards[0].id)
  S.getState().setBoardPreset('a4l')
  await new Promise((r) => setTimeout(r, 400))
  const locked = tr.keepRatio()
  S.getState().setBoardPreset('free')
  await new Promise((r) => setTimeout(r, 400))
  const free = tr.keepRatio()
  return { locked, free }
})()`)
check('自由画板拖角不锁等比', r.locked === true && r.free === false, JSON.stringify(r))

await evaluate(`(() => { window.__cmf.store.getState().selectAllBoards() })()`)
await sleep(400)
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('shots/boards-check.png', Buffer.from(shot.data, 'base64'))

// ---- 18. 清空内容后：设置项仍可点，导出动作置灰且给出理由 ----
// 曾经整块面板跟着 images.length 一起灰掉，「导出画板原分辨率」这种设置项也点不动
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  S.getState().clearCanvas()
  // 导出设置默认收起，断言前先展开（收起时子节点不在 DOM 里）
  const head = [...document.querySelectorAll('.left .sect-head')].find((h) => h.textContent.includes('导出设置'))
  if (head && !head.parentElement.classList.contains('is-open')) head.click()
  await new Promise((r) => setTimeout(r, 600))
  const btns = [...document.querySelectorAll('.left button')]
  const one = (t) => btns.find((b) => b.textContent.trim().includes(t))
  const note = [...document.querySelectorAll('.left .dpi-note')].some((n) => n.textContent.includes('还没有渲染图'))
  return {
    images: S.getState().images.length,
    native: one('导出画板原分辨率')?.disabled,
    json: one('导出项目文件')?.disabled,
    sel: one('导出选中画板')?.disabled,
    all: one('导出所有画板')?.disabled,
    note
  }
})()`)
check(
  '没有渲染图时：设置项可点、导出置灰并说明原因',
  r.images === 0 && r.native === false && r.json === true && r.sel === true && r.all === true && r.note === true,
  JSON.stringify(r)
)

// ---- 19. 画板内部空白处能左键平移（画板框只该命中边框）----
// 曾经 fillEnabled 默认为 true，Konva 命中画布把整个矩形内部都填了色：
// 画板盖住的地方既拖不动画布，也点不中下面的图
r = await evaluate(`(async () => {
  const S = window.__cmf.store, stage = window.__cmf.stage
  S.setState({ images: [], annotations: [] })
  S.setState({ artboards: [S.getState().artboards[0]].map((x) => ({ ...x, x: 0, y: 0, w: 500, h: 400, auto: false })) })
  S.getState().selectBoard(null)
  window.__cmf.controls.current.actualSize()
  await new Promise((r) => setTimeout(r, 400))
  const rect = stage.container().getBoundingClientRect()
  const at = (cx, cy) => [rect.left + stage.x() + cx * stage.scaleX(), rect.top + stage.y() + cy * stage.scaleY()]
  const p1 = at(250, 200)
  const p2 = at(350, 270)
  const hit = stage.getIntersection({ x: p1[0] - rect.left, y: p1[1] - rect.top })
  return {
    x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
    hit: hit ? hit.getClassName() : null,
    pos: [Math.round(stage.x()), Math.round(stage.y())],
    board: [Math.round(S.getState().artboards[0].x), Math.round(S.getState().artboards[0].y)]
  }
})()`)
const panNeed = r
await mouse('mousePressed', panNeed.x1, panNeed.y1)
await sleep(50)
await mouse('mouseMoved', (panNeed.x1 + panNeed.x2) / 2, (panNeed.y1 + panNeed.y2) / 2)
await sleep(50)
await mouse('mouseMoved', panNeed.x2, panNeed.y2)
await sleep(50)
await mouse('mouseReleased', panNeed.x2, panNeed.y2)
await sleep(300)
r = await evaluate(`(() => {
  const S = window.__cmf.store.getState(), stage = window.__cmf.stage
  return { pos: [Math.round(stage.x()), Math.round(stage.y())], board: [Math.round(S.artboards[0].x), Math.round(S.artboards[0].y)] }
})()`)
check(
  '画板内部空白能拖动画布，画板不跟着动',
  panNeed.hit === null &&
    Math.abs(r.pos[0] - panNeed.pos[0] - 100) < 4 &&
    Math.abs(r.pos[1] - panNeed.pos[1] - 70) < 4 &&
    r.board[0] === panNeed.board[0] && r.board[1] === panNeed.board[1],
  JSON.stringify({ hit: panNeed.hit, from: panNeed.pos, to: r.pos, board: r.board })
)

// ---- 19b. 去掉内部命中后，边框仍然点得中 ---- 
r = await evaluate(`(async () => {
  const S = window.__cmf.store, stage = window.__cmf.stage
  S.getState().selectBoard(null)
  await new Promise((r) => setTimeout(r, 200))
  const b = S.getState().artboards[0]
  const rect = stage.container().getBoundingClientRect()
  const px = rect.left + stage.x() + (b.x + 2) * stage.scaleX()
  const py = rect.top + stage.y() + (b.y + b.h / 2) * stage.scaleY()
  const hit = stage.getIntersection({ x: px - rect.left, y: py - rect.top })
  return { px, py, hit: hit ? hit.getClassName() + '/' + hit.id() : null }
})()`)
await mouse('mousePressed', r.px, r.py)
await mouse('mouseReleased', r.px, r.py)
await sleep(350)
const borderHit = r
r = await evaluate(`(() => ({ n: window.__cmf.store.getState().selectedBoardIds.length, focus: window.__cmf.store.getState().boardFocus }))()`)
check(
  '画板边框仍可点选',
  borderHit.hit.startsWith('Rect/board-') && r.n === 1 && r.focus === true,
  JSON.stringify({ hit: borderHit.hit, ...r })
)

// ---- 20. 多选画板后点空白：画板选择要一起清掉 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  S.setState({
    artboards: [
      { ...S.getState().artboards[0], id: 'ba', name: 'A', x: 0, y: 0, w: 300, h: 300, auto: false },
      { ...S.getState().artboards[0], id: 'bb', name: 'B', x: 700, y: 0, w: 300, h: 300, auto: false }
    ],
    selectedBoardIds: ['ba', 'bb'],
    boardFocus: true,
    selectedIds: []
  })
  window.__cmf.controls.current.actualSize()
  await new Promise((r) => setTimeout(r, 350))
  const stage = window.__cmf.stage
  const rect = stage.container().getBoundingClientRect()
  return { x: rect.left + stage.x() + 500 * stage.scaleX(), y: rect.top + stage.y() + 600 * stage.scaleY(), before: S.getState().selectedBoardIds.length }
})()`)
await mouse('mousePressed', r.x, r.y)
await mouse('mouseReleased', r.x, r.y)
await sleep(300)
const blankClick = r
r = await evaluate(`(() => {
  const s = window.__cmf.store.getState()
  const tr = window.__cmf.stage.findOne('Transformer')
  return { n: s.selectedBoardIds.length, focus: s.boardFocus, nodes: tr.nodes().length }
})()`)
check(
  '多选画板后点空白：取消选择并收起缩放框',
  blankClick.before === 2 && r.n === 0 && r.focus === false && r.nodes === 0,
  JSON.stringify({ before: blankClick.before, ...r })
)

// ---- 21. 新建画板落在右侧空白处，且不和已有画板重叠 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const c = document.createElement('canvas'); c.width = 400; c.height = 300
  const g = c.getContext('2d'); g.fillStyle = '#ccd0d6'; g.fillRect(0, 0, 400, 300)
  S.setState({
    artboards: [{ ...S.getState().artboards[0], id: 'only', name: '画板 1', x: 0, y: 0, w: 400, h: 300, auto: false }],
    selectedBoardIds: ['only'],
    boardFocus: true,
    images: [{ id: 'nb1', dataUrl: c.toDataURL('image/png'), name: 'n.png', x: 0, y: 0, w: 400, h: 300 }],
    annotations: []
  })
  await new Promise((r) => setTimeout(r, 250))
  S.getState().addBoardFromContent()
  await new Promise((r) => setTimeout(r, 350))
  const bs = S.getState().artboards
  const a = bs[0], n = bs[bs.length - 1]
  const overlap = !(n.x >= a.x + a.w || n.x + n.w <= a.x || n.y >= a.y + a.h || n.y + n.h <= a.y)
  return { n: bs.length, a: [a.x, a.y, a.w, a.h], last: [Math.round(n.x), Math.round(n.y), Math.round(n.w), Math.round(n.h)], overlap, auto: !!n.auto, sel: S.getState().selectedBoardIds }
})()`)
check(
  '新建画板排在右侧空白处，不与已有画板重叠',
  r.n === 2 && r.overlap === false && r.last[0] >= r.a[0] + r.a[2] && r.auto === false && r.sel.length === 1,
  JSON.stringify(r)
)

// ---- 22. 多选画板时拖角点：两块一起等比放大 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  S.setState({
    artboards: [
      { ...S.getState().artboards[0], id: 'ma', name: 'A', x: 0, y: 0, w: 300, h: 200, auto: false, preset: 'free' },
      { ...S.getState().artboards[0], id: 'mb', name: 'B', x: 400, y: 0, w: 300, h: 200, auto: false, preset: 'free' }
    ],
    selectedBoardIds: ['ma', 'mb'],
    boardFocus: true,
    selectedIds: []
  })
  window.__cmf.controls.current.actualSize()
  await new Promise((r) => setTimeout(r, 450))
  const stage = window.__cmf.stage
  const tr = stage.findOne('Transformer')
  const anchor = tr.findOne('.bottom-right')
  const abs = anchor ? anchor.getAbsolutePosition() : null
  const rect = stage.container().getBoundingClientRect()
  return {
    nodes: tr.nodes().length,
    ax: abs ? rect.left + abs.x : null,
    ay: abs ? rect.top + abs.y : null,
    before: S.getState().artboards.map((b) => [b.x, b.y, b.w, b.h].map(Math.round)),
    boardW: S.getState().artboards.map((b) => b.w)
  }
})()`)
const multiResize = r
if (multiResize.ax != null) {
  await mouse('mousePressed', multiResize.ax, multiResize.ay)
  await sleep(60)
  await mouse('mouseMoved', multiResize.ax + 40, multiResize.ay + 40)
  await sleep(60)
  await mouse('mouseMoved', multiResize.ax + 80, multiResize.ay + 80)
  await sleep(60)
  await mouse('mouseReleased', multiResize.ax + 80, multiResize.ay + 80)
  await sleep(450)
}
r = await evaluate(`(() => {
  const bs = window.__cmf.store.getState().artboards
  return bs.map((b) => ({ w: Math.round(b.w), h: Math.round(b.h), ratio: +(b.w / b.h).toFixed(3) }))
})()`)
check(
  '多选画板可以一起等比缩放',
  multiResize.nodes === 2 &&
    r.length === 2 &&
    r[0].w > multiResize.boardW[0] + 10 &&
    r[1].w > multiResize.boardW[1] + 10 &&
    Math.abs(r[0].ratio - 1.5) < 0.05 &&
    Math.abs(r[1].ratio - 1.5) < 0.05,
  JSON.stringify({ nodes: multiResize.nodes, before: multiResize.boardW, after: r })
)

// ---- 23. 两块画板都开「跟随内容」：各贴各的，不互相吞、不重叠 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const st = S.getState()
  st.clearCanvas()
  const mk = (w, h, color) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h)
    return c.toDataURL('image/png')
  }
  st.addImages([
    { id: 'ia', dataUrl: mk(400, 300, '#8f9aa8'), name: 'a.png', x: 0, y: 0, w: 400, h: 300 },
    { id: 'ib', dataUrl: mk(300, 240, '#a8988f'), name: 'b.png', x: 900, y: 0, w: 300, h: 240 }
  ])
  // 信息栏会跟着图片右侧跑，先关掉，只看图片
  S.getState().setInfoVisible(false)
  await new Promise((r) => setTimeout(r, 200))
  // 画板直接铺两张：各框一张图（自由比例，比图大一圈），都开「跟随内容」。
  // 不用 addBoard：没有画板时 App 会自动补一块，数量会多出来
  const base = S.getState().artboards[0]
  S.setState({
    artboards: [
      { ...base, id: 'ba', name: 'A', preset: 'free', x: -40, y: -40, w: 480, h: 380, auto: true },
      { ...base, id: 'bb', name: 'B', preset: 'free', x: 860, y: -40, w: 380, h: 320, auto: true }
    ],
    selectedBoardIds: ['ba', 'bb'],
    boardFocus: true,
    selectedIds: []
  })
  await new Promise((r) => setTimeout(r, 150))
  S.getState().fitBoardsToContent()
  await new Promise((r) => setTimeout(r, 500))
  const bs = S.getState().artboards
  const ov = (a, b) =>
    Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return {
    boards: bs.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]),
    overlap: Math.round(ov(bs[0], bs[1])),
    imgs: S.getState().images.map((i) => [i.x, i.y, i.w, i.h])
  }
})()`)
check(
  '两块画板各贴自己的图（不再合并成一张大画板）',
  r.boards.length === 2 &&
    Math.abs(r.boards[0][2] - 400) <= 2 && Math.abs(r.boards[0][3] - 300) <= 2 &&
    Math.abs(r.boards[1][2] - 300) <= 2 && Math.abs(r.boards[1][3] - 240) <= 2 &&
    r.overlap === 0,
  JSON.stringify(r)
)

// ---- 24. 画板被别的内容撑大后，点「贴合内容」能收回到自己的内容 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const bs = S.getState().artboards
  // 把第一块画板人为撑大到盖住两张图（模拟之前被全局内容撑大的状态）
  S.setState({
    artboards: S.getState().artboards.map((b, i) => (i === 0 ? { ...b, x: -40, y: -40, w: 1400, h: 400, auto: true } : b))
  })
  S.getState().selectAllBoards()
  S.getState().fitBoardsToContent()
  await new Promise((r) => setTimeout(r, 500))
  const after = S.getState().artboards.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)])
  return { after }
})()`)
check(
  '被撑大的画板能收回自己那份内容（大板不抢小板的内容）',
  Math.abs(r.after[0][2] - 400) <= 2 && Math.abs(r.after[0][3] - 300) <= 2 && Math.abs(r.after[1][2] - 300) <= 2,
  JSON.stringify(r)
)

// ---- 25. 「自由」比例下才出现宽高数值框（其它比例靠页面比例定长短边） ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  S.setState({
    artboards: [{ ...S.getState().artboards[0], id: 'fz', name: '自由板', preset: 'a4l', x: 0, y: 0, w: 600, h: 400, auto: false }],
    selectedBoardIds: ['fz'],
    boardFocus: true,
    selectedIds: []
  })
  await new Promise((r) => setTimeout(r, 350))
  const fixed = document.querySelectorAll('.right .size-row input[type="number"]').length
  S.getState().setBoardPreset('free')
  await new Promise((r) => setTimeout(r, 350))
  const inputs = [...document.querySelectorAll('.right .size-row input[type="number"]')]
  return {
    fixed,
    tab: document.querySelector('.right-tab.on')?.textContent?.trim(),
    n: inputs.length,
    vals: inputs.map((i) => i.value),
    swap: !!document.querySelector('.right .size-row .size-btn')
  }
})()`)
check(
  '「自由」比例下出现宽高数值框（其它比例不显示）',
  r.fixed === 0 && r.tab === '画板' && r.n === 2 && r.vals[0] === '600' && r.vals[1] === '400' && r.swap,
  JSON.stringify(r)
)

// ---- 26. 输宽度只改宽，中心不动 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const inputs = [...document.querySelectorAll('.right .size-row input[type="number"]')]
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(inputs[0], 800)
  await new Promise((r) => setTimeout(r, 300))
  const b = S.getState().artboards[0]
  return {
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)],
    preset: b.preset,
    cx: Math.round(b.x + b.w / 2),
    cy: Math.round(b.y + b.h / 2)
  }
})()`)
check(
  '输宽度：只改宽、高不变、中心不动',
  r.rect[2] === 800 && r.rect[3] === 400 && r.cx === 300 && r.cy === 200 && r.preset === 'free',
  JSON.stringify(r)
)

// ---- 27. 互换长宽：宽高对调，中心仍不动 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  document.querySelector('.right .size-row .size-btn').click()
  await new Promise((r) => setTimeout(r, 300))
  const b = S.getState().artboards[0]
  return {
    rect: [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)],
    cx: Math.round(b.x + b.w / 2),
    cy: Math.round(b.y + b.h / 2),
    vals: [...document.querySelectorAll('.right .size-row input[type="number"]')].map((i) => i.value)
  }
})()`)
check(
  '互换长宽：宽高对调、中心不动',
  r.rect[2] === 400 && r.rect[3] === 800 && r.cx === 300 && r.cy === 200 && r.vals[0] === '400' && r.vals[1] === '800',
  JSON.stringify(r)
)

// 自由画板 + 宽高栏的面板截图
const freeShot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('shots/boards-free.png', Buffer.from(freeShot.data, 'base64'))

// ---- 28. 多块画板只按渲染图贴：板里的形状伸到板外也不把画板撑大 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store
  const st = S.getState()
  st.clearCanvas()
  const mk = (w, h, color) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h)
    return c.toDataURL('image/png')
  }
  st.addImages([
    { id: 'pa', dataUrl: mk(400, 300, '#8f9aa8'), name: 'a.png', x: 0, y: 0, w: 400, h: 300 },
    { id: 'pb', dataUrl: mk(300, 240, '#a8988f'), name: 'b.png', x: 900, y: 0, w: 300, h: 240 }
  ])
  S.getState().setInfoVisible(false)
  // 一块矩形压在 A 的右边缘、大半伸到板外：算进自动画布的话画板就会被撑宽
  const mod = await import('/src/lib/shapes.ts')
  S.getState().addShape(mod.makeShape('rect', { x: 380, y: 40, w: 300, h: 200 }))
  await new Promise((r) => setTimeout(r, 200))
  const base = S.getState().artboards[0]
  S.setState({
    artboards: [
      { ...base, id: 'qa', name: 'A', preset: 'free', x: -40, y: -40, w: 480, h: 380, auto: true },
      { ...base, id: 'qb', name: 'B', preset: 'free', x: 860, y: -40, w: 380, h: 320, auto: true }
    ],
    selectedBoardIds: ['qa', 'qb'],
    boardFocus: true,
    selectedIds: []
  })
  await new Promise((r) => setTimeout(r, 150))
  S.getState().fitBoardsToContent()
  await new Promise((r) => setTimeout(r, 600))
  const bs = S.getState().artboards
  return {
    boards: bs.map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.w), Math.round(b.h)]),
    shape: S.getState().shapes.map((s) => [s.x, s.y, s.w, s.h])
  }
})()`)
check(
  '板里的形状伸到板外，也不会把画板撑大（只按渲染图贴）',
  r.boards.length === 2 &&
    Math.abs(r.boards[0][2] - 400) <= 2 && Math.abs(r.boards[0][3] - 300) <= 2 &&
    Math.abs(r.boards[1][2] - 300) <= 2 && Math.abs(r.boards[1][3] - 240) <= 2,
  JSON.stringify(r)
)

console.log(log.join('\n'))
ws.close()
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0)
