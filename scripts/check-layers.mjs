// 图层 / 分组 / 粘贴 的交互自测（开发期工具，不参与构建）
//   node scripts/check-layers.mjs [url]
// 依赖：一个开着远程调试的 Chrome（--remote-debugging-port=9226）
import fs from 'node:fs'

const APP = process.argv[2] || 'http://localhost:5173/'
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  return r.result.value
}

console.error('[1] connected')
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
await send('Page.navigate', { url: APP })
// 页面不在前台时 renderer 会丢掉 Input 事件（点了没反应），先置前
await send('Page.bringToFront')
await sleep(2200)
console.error('[2] navigated')

const log = []
const check = (name, ok, extra = '') => {
  log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}

// ---- 造一个可交互的工程：两张图 + 三条标注 ----
await evaluate(`(async () => {
  const S = window.__cmf.store
  const mk = (txt, color) => {
    const c = document.createElement('canvas'); c.width = 640; c.height = 420
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0,0,640,420)
    g.fillStyle = '#fff'; g.font = '700 44px sans-serif'; g.fillText(txt, 36, 120)
    return c.toDataURL('image/png')
  }
  const a1 = mk('RENDER A', '#8f9aa8'), a2 = mk('RENDER B', '#c8b49a')
  const st = S.getState()
  st.clearCanvas()
  st.addImages([
    { id: 'img-a', dataUrl: a1, name: 'a.png', x: 0, y: 0, w: 640, h: 420 },
    { id: 'img-b', dataUrl: a2, name: 'b.png', x: 700, y: 0, w: 640, h: 420 }
  ])
  const base = { anchor: { x: 200, y: 200 }, label: { x: 260, y: 120 }, cmf: { name: 'P1', color: '#e60012', material: 'ABS', finish: '喷涂', process: '注塑', note: '' }, createdAt: 1 }
  st.addAnnotation({ ...base, id: 'ann-1' })
  st.addAnnotation({ ...base, id: 'ann-2', anchor: { x: 400, y: 260 }, label: { x: 460, y: 200 }, cmf: { ...base.cmf, name: 'P2' } })
  st.addAnnotation({ ...base, id: 'ann-3', anchor: { x: 600, y: 320 }, label: { x: 660, y: 300 }, cmf: { ...base.cmf, name: 'P3' } })
  return true
})()`)
await sleep(600)
console.error('[3] project built')

// ---- 1. 图层列表应同时含 2 张图 + 3 条标注 ----
let r = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.layer-list .layer-item, .layer-list .layer-child')]
  return { n: rows.length, kinds: rows.filter(el => el.textContent.includes('图')).length,
           titles: rows.map(el => el.querySelector('strong')?.textContent.trim()) }
})()`)
check('图层列表包含图片与标注', r.n === 5 && r.kinds === 2, JSON.stringify(r.titles))

console.error('[4] first check done')
// ---- 2. 图片的 z 默认在图注之下：先查 store 的层级序 ----
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  const ord = [...st.images, ...st.annotations].sort((a,b) => (a.z??0)-(b.z??0)).map(x => x.id + ':' + (x.z??0))
  return ord
})()`)
check('图片 z 低于标注', r.slice(0, 2).every((x) => x.startsWith('img-')), JSON.stringify(r))

// ---- 3. 选中两条标注 → 分组 ----
await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  window.__cmf.store.setState({ selectedIds: ['ann-1', 'ann-2'] })
  st.groupSelectedLayers()
})()`)
await sleep(300)
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  return { groups: st.groups.map(g => g.name), members: st.annotations.filter(a => a.groupId).map(a => a.id),
           rows: document.querySelectorAll('.layer-group').length }
})()`)
check('两条标注进入同一分组', r.groups.length === 1 && r.members.length === 2 && r.rows === 1, JSON.stringify(r))

// ---- 4. 分组的眼睛能一起隐藏 ----
await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  st.setGroupVisible(st.groups[0].id, false)
})()`)
await sleep(300)
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  const gid = st.groups[0].id
  return { hidden: st.groups[0].hidden, stageNodes: window.__cmf.stage.find('.konvajs-content').length }
})()`)
check('整组隐藏标记生效', r.hidden === true, JSON.stringify(r))
await evaluate(`(() => { const st = window.__cmf.store.getState(); st.setGroupVisible(st.groups[0].id, true) })()`)

// ---- 5. 把图片拖到标注之上（reorderLayers） ----
await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  st.reorderLayers('img-a', 'ann-3', 'after')
})()`)
await sleep(300)
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  const im = st.images.find(i => i.id === 'img-a')
  const a3 = st.annotations.find(a => a.id === 'ann-3')
  return { imgZ: im.z, annZ: a3.z, above: im.z > a3.z }
})()`)
check('图片可移到标注之上', r.above === true, JSON.stringify(r))

// ---- 6. 单条标注独立配色：全局换色不覆盖它 ----
await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  st.setAnnLineColor('ann-1', '#1f2329')
  st.applyGlobalStyle({ lineColor: '#00a0ff' })
})()`)
await sleep(300)
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  const a1 = st.annotations.find(a => a.id === 'ann-1')
  const a2 = st.annotations.find(a => a.id === 'ann-2')
  return { locked: a1.lineColor, follows: a2.lineColor, global: st.globalLineColor }
})()`)
check('单独配色不被全局覆盖', r.locked === '#1f2329' && r.follows === '#00a0ff', JSON.stringify(r))

// ---- 7. 粘贴剪贴板图片 ----
r = await evaluate(`(async () => {
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200
  const g = cv.getContext('2d'); g.fillStyle = '#4a7'; g.fillRect(0,0,300,200)
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
  const file = new File([blob], 'clip.png', { type: 'image/png' })
  const dt = new DataTransfer(); dt.items.add(file)
  const before = window.__cmf.store.getState().images.length
  window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  await new Promise((r) => setTimeout(r, 700))
  return { before, after: window.__cmf.store.getState().images.length }
})()`)
check('Ctrl+V 粘贴图片落到画布', r.after === r.before + 1, JSON.stringify(r))

// ---- 8. 隐藏图片后不进导出包围盒 ----
r = await evaluate(`(() => {
  window.__cmf.store.getState().setImageVisible('img-b', false)
  return window.__cmf.store.getState().images.find(i => i.id === 'img-b').hidden
})()`)
check('图片隐藏开关写入状态', r === true)
await evaluate(`(() => { const st = window.__cmf.store.getState(); st.setImageVisible('img-b', true) })()`)

// ---- 9. 真的拖一下：把 b.png 拖到 P3 下方（DOM 级，验证 DnD 接线）----
r = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.layer-list .layer-item, .layer-list .layer-child')]
  const byText = (t) => rows.find((el) => (el.querySelector('strong')?.textContent || '').includes(t))
  const src = byText('b.png')
  const dst = byText('P3')
  if (!src || !dst) return { err: 'row not found' }
  const dt = new DataTransfer()
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  const rb = dst.getBoundingClientRect()
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: rb.bottom - 4 }))
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: rb.bottom - 4 }))
  await new Promise((r) => setTimeout(r, 300))
  const st = window.__cmf.store.getState()
  const b = st.images.find((i) => i.name === 'b.png')
  const p3 = st.annotations.find((a) => a.cmf.name === 'P3')
  return { bz: b.z, pz: p3.z, below: b.z < p3.z }
})()`)
check('拖动图层可改层级（b.png 拖到 P3 下方）', r.below === true, JSON.stringify(r))

// ---- 10. 选中两行后点「分组」按钮 ----
r = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.layer-list .layer-item, .layer-list .layer-child')]
  const byText = (t) => rows.find((el) => (el.querySelector('strong')?.textContent || '').includes(t))
  const ids = [window.__cmf.store.getState().images.find((i) => i.name === 'a.png').id,
               window.__cmf.store.getState().images.find((i) => i.name === 'b.png').id]
  window.__cmf.store.setState({ selectedIds: ids })
  await new Promise((r) => setTimeout(r, 120))
  const btn = document.querySelector('.layer-tools .btn')
  const disabled = btn.disabled
  btn.click()
  await new Promise((r) => setTimeout(r, 300))
  const st = window.__cmf.store.getState()
  return { disabled, groups: st.groups.length, inGroup: st.images.filter((i) => i.groupId).length,
           groupRows: document.querySelectorAll('.layer-group').length }
})()`)
check('分组按钮把选中的图片归组', r.disabled === false && r.groups === 2 && r.inGroup === 2 && r.groupRows === 2, JSON.stringify(r))

// ---- 11. SVG 分层：图片压到标注之上时，图层顺序要跟着变 ----
r = await evaluate(`(async () => {
  const mod = await import('/src/lib/svgExport.ts')
  const st = window.__cmf.store.getState()
  const svg = mod.buildLayeredSvg({
    rect: { x: 0, y: 0, w: 1400, h: 460 }, title: 't', pageW: 1400, pageH: 460,
    fit: 1, offX: 0, offY: 0, ptW: 700, ptH: 230,
    images: st.images, annotations: st.annotations, info: st.info, infoPos: st.infoPos,
    infoScale: st.infoScale, infoVisible: st.infoVisible, infoRule: st.infoRule,
    logo: st.logo, watermark: st.watermark
  })
  const layers = [...svg.matchAll(/<g id="([^"]+)"[^>]*inkscape:label="([^"]*)"/g)].map((m) => m[2])
  return { layers, count: layers.length }
})()`)
check('SVG 图层顺序跟随层级', r.layers.length >= 2 && r.layers[0] === '纸面', JSON.stringify(r.layers))


// ---- 12. 单个图层拖到分组头上 = 归组 ----
r = await evaluate(`(async () => {
  const rows = [...document.querySelectorAll('.layer-list .layer-group')]
  const dst = rows[0]                                   // 列表最上面的分组
  const name = dst.querySelector('strong').textContent.replace(/·.*/, '').trim()
  const gid = window.__cmf.store.getState().groups.find((g) => g.name === name).id
  const target = window.__cmf.store.getState().annotations.find((a) => !a.groupId)
  const srcEl = [...document.querySelectorAll('.layer-list .layer-item')].find((el) => el.textContent.includes(target.cmf.name))
  if (!dst || !srcEl) return { err: 'row not found', name }
  const dt = new DataTransfer()
  srcEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
  const rb = dst.getBoundingClientRect()
  dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientY: rb.top + 4 }))
  dst.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientY: rb.top + 4 }))
  await new Promise((r) => setTimeout(r, 300))
  const after = window.__cmf.store.getState().annotations.find((a) => a.id === target.id)
  return { name, moved: after.groupId === gid, got: after.groupId }
})()`)
check('图层拖到分组上会归组', r.moved === true, JSON.stringify(r))

// ---- 13. 默认状态下 SVG 仍是「渲染图 / 标注」两层 ----
r = await evaluate(`(async () => {
  const st = window.__cmf.store.getState()
  st.clearCanvas()
  const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300
  const g = cv.getContext('2d'); g.fillStyle = '#999'; g.fillRect(0, 0, 400, 300)
  const url = cv.toDataURL('image/png')
  st.addImages([{ id: 'x1', dataUrl: url, name: 'x.png', x: 0, y: 0, w: 400, h: 300 }])
  st.addAnnotation({ id: 'x2', anchor: { x: 100, y: 100 }, label: { x: 140, y: 60 },
    cmf: { name: 'X', color: '#e60012', material: '', finish: '', process: '', note: '' }, createdAt: 1 })
  const mod = await import('/src/lib/svgExport.ts')
  // 信息栏显隐是工程设置、会存进 localStorage；别的自测关掉过它，这里显式打开，
  // 否则这条断言会随上一个脚本的残留状态时好时坏
  window.__cmf.store.getState().setInfoVisible(true)
  const s2 = window.__cmf.store.getState()
  const svg = mod.buildLayeredSvg({
    rect: { x: 0, y: 0, w: 420, h: 320 }, title: 't', pageW: 420, pageH: 320,
    fit: 1, offX: 0, offY: 0, ptW: 210, ptH: 160,
    images: s2.images, annotations: s2.annotations, info: s2.info, infoPos: s2.infoPos,
    infoScale: s2.infoScale, infoVisible: s2.infoVisible, infoRule: s2.infoRule,
    logo: s2.logo, watermark: s2.watermark
  })
  const ids = [...svg.matchAll(/<g id="([^"]+)"[^>]*inkscape:label="([^"]*)"/g)].map((m) => m[1] + '=' + m[2])
  return ids
})()`)
check('默认仍输出渲染图 / 标注两层', r.join('|') === 'paper=纸面|render=渲染图|annotations=标注|info-bar=项目信息栏', JSON.stringify(r))


// ---- 14. 整组移动：文本框和锚点一起走 ----
r = await evaluate(`(() => {
  const st = window.__cmf.store.getState()
  st.clearCanvas()
  st.addAnnotation({ id: 'm1', anchor: { x: 100, y: 120 }, label: { x: 160, y: 60 },
    cmf: { name: 'M1', color: '#e60012', material: '', finish: '', process: '', note: '' }, createdAt: 1 })
  const before = window.__cmf.store.getState().annotations[0]
  window.__cmf.store.getState().moveSelectionBy(
    { images: [], annotations: [{ id: 'm1', x: before.label.x, y: before.label.y, ax: before.anchor.x, ay: before.anchor.y }] },
    40, 25
  )
  const a = window.__cmf.store.getState().annotations[0]
  return { label: [a.label.x, a.label.y], anchor: [a.anchor.x, a.anchor.y] }
})()`)
check('整组移动同时搬运锚点', r.label[0] === 200 && r.label[1] === 85 && r.anchor[0] === 140 && r.anchor[1] === 145, JSON.stringify(r))

// ---- 15. 方向键微调也带上锚点 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  S.setState({ selectedIds: ['m1'] })
  S.getState().nudgeSelected(5, -3)
  const a = S.getState().annotations[0]
  return { label: [a.label.x, a.label.y], anchor: [a.anchor.x, a.anchor.y] }
})()`)
check('方向键微调带上锚点', r.label[0] === 205 && r.label[1] === 82 && r.anchor[0] === 145 && r.anchor[1] === 142, JSON.stringify(r))

// ---- 16. 真拖一遍：多选时拖图片，标注框与锚点同步 ----
r = await evaluate(`(async () => {
  const S = window.__cmf.store, stage = window.__cmf.stage
  S.getState().clearCanvas()
  const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300
  const g = cv.getContext('2d'); g.fillStyle = '#9aa4b2'; g.fillRect(0, 0, 400, 300)
  S.getState().addImages([{ id: 'gi', dataUrl: cv.toDataURL('image/png'), name: 'g.png', x: 0, y: 0, w: 400, h: 300 }])
  // 把画板挪远：画板边框有 10px 的抓取区，压在图片上会抢走这次拖拽
  S.setState({ artboards: S.getState().artboards.map((b) => ({ ...b, x: 2000, y: 0 })), boardFocus: false })
  const st = S.getState()
  st.addAnnotation({ id: 'ga', anchor: { x: 120, y: 140 }, label: { x: 180, y: 80 },
    cmf: { name: 'G', color: '#e60012', material: '', finish: '', process: '', note: '' }, createdAt: 1 })
  S.setState({ selectedIds: ['gi', 'ga'] })
  await new Promise((r) => setTimeout(r, 200))
  const node = stage.findOne('#gi')
  const p = node.getAbsolutePosition()
  const rect = stage.container().getBoundingClientRect()
  const a = S.getState().annotations[0]
  return { x: rect.left + p.x + 40, y: rect.top + p.y + 40, scale: stage.scaleX(),
           img: S.getState().images[0].x, label: a.label.x, anchor: a.anchor.x }
})()`)
const before = r
const mouse = (type, x, y, extra = {}) =>
  send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra })
await mouse('mousePressed', before.x, before.y)
await sleep(60)
await mouse('mouseMoved', before.x + 60, before.y + 20)
await sleep(60)
await mouse('mouseMoved', before.x + 120, before.y + 40)
await sleep(60)
await mouse('mouseReleased', before.x + 120, before.y + 40)
await sleep(400)
r = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  const a = S.annotations[0]
  return { img: S.images[0].x, label: a.label.x, anchor: a.anchor.x }
})()`)
const dx = 120 / before.scale
check(
  '多选拖图片时标注框与锚点同步移动',
  Math.abs(r.img - before.img - dx) < 2 &&
    Math.abs(r.label - before.label - dx) < 2 &&
    Math.abs(r.anchor - before.anchor - dx) < 2,
  JSON.stringify({ dx: +dx.toFixed(1), frame: Math.round(r.img - before.img), label: Math.round(r.label - before.label), anchor: Math.round(r.anchor - before.anchor) })
)


// ---- 图层区高度：至少能同时看到 6 行，行多了在列表内部滚动 ----
r = await evaluate(`(() => {
  const sec = [...document.querySelectorAll('.left .sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '图层')
  const list = sec?.querySelector('.layer-list')
  return {
    h: Math.round(sec?.getBoundingClientRect().height || 0),
    listH: Math.round(list?.getBoundingClientRect().height || 0),
    rows: sec?.querySelectorAll('.layer-list li').length || 0
  }
})()`)
check('图层区留足高度（≥ 300px），行多了在列表内滚动', r.h >= 300 && r.listH >= 220, JSON.stringify(r))

// ---- 截图 ----
await evaluate(`(() => { window.__cmf.store.setState({ selectedIds: [] }) })()`)
console.error('[5] all checks done')
await sleep(500)
const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
fs.writeFileSync('shots/layers.png', Buffer.from(shot.data, 'base64'))

console.log(log.join('\n'))
ws.close()
process.exit(log.some((l) => l.startsWith('FAIL')) ? 1 : 0)
