// 形状标注（文本框 / 直线 / 折线 / 圆形 / 矩形）的交互自测（开发期工具，不参与构建）
//   node scripts/check-shapes.mjs [url]
// 依赖：开着远程调试的 Chrome（--remote-debugging-port=9226）与 dev server
import fs from 'node:fs'
import path from 'node:path'

const APP = process.argv[2] || 'http://localhost:5173/'
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const DL = path.resolve('shots/dl-shapes')
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
  if (r.exceptionDetails) {
    console.log(log.join('\n'))
    throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''))
  }
  return r.result.value
}

const log = []
const check = (name, ok, extra = '') => log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)

console.error('[1] connected')
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })
await send('Page.navigate', { url: APP })
// 页面不在前台时 renderer 会丢掉 Input 事件（点了没反应），先置前
await send('Page.bringToFront')
await sleep(2200)
console.error('[2] navigated')

// ---- 造一块干净的画布：一张小图 + 一块手动画板，视图固定 1:1 / pos 40,40 ----
await evaluate(`(async () => {
  const S = window.__cmf.store
  const c = document.createElement('canvas'); c.width = 240; c.height = 160
  const g = c.getContext('2d'); g.fillStyle = '#9aa5b1'; g.fillRect(0, 0, 240, 160)
  S.getState().clearCanvas()
  S.setState({ artboards: S.getState().artboards.slice(0, 1) })
  S.getState().addImages([
    { id: 'img-shape', dataUrl: c.toDataURL('image/png'), name: 'shape.png', x: 0, y: 0, w: 240, h: 160 }
  ])
  S.getState().updateBoard(S.getState().artboards[0].id, {
    id: S.getState().artboards[0].id, x: 0, y: 0, w: 1200, h: 800, preset: 'free', auto: false
  })
  await new Promise((r) => setTimeout(r, 400))
  window.__cmf.controls.current.actualSize()
  // 信息栏默认贴在图片右侧，会盖住部分测试点；这里先收起来，保证「双击空白」真的是空白
  S.getState().setInfoVisible(false)
  S.getState().setTool('select')
  S.getState().select(null)
  window.__dbl = 0
  window.__dblTargets = []
  window.__cmf.stage.container().addEventListener('dblclick', (e) => {
    window.__dbl++
    window.__dblTargets.push(e.target?.className || e.target?.tagName)
  }, true)
  await new Promise((r) => setTimeout(r, 300))
  return true
})()`)
await sleep(400)

const mouse = (type, x, y, clickCount = 1) =>
  send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount
  })
const dbl = async (x, y) => {
  // Chrome 会在 500ms 内把前后两次点击合并成一次 dblclick；
  // 连续造多个形状时必须拉开间隔，否则 Dom 会把上一轮的第二次点击算进来（0 次或 2 次）
  await sleep(600)
  await mouse('mousePressed', x, y, 1)
  await mouse('mouseReleased', x, y, 1)
  await mouse('mousePressed', x, y, 2)
  await mouse('mouseReleased', x, y, 2)
  await sleep(250)
}
// content 坐标 → 屏幕坐标：left + 40 + content（actualSize 后 scale=1、pos=40,40）
const screen = async (cx, cy) =>
  evaluate(`(() => {
    const st = window.__cmf.stage
    const r = st.container().getBoundingClientRect()
    return { x: r.left + st.x() + ${cx} * st.scaleX(), y: r.top + st.y() + ${cy} * st.scaleY() }
  })()`)

// ---- 1. 工具条：红框内四颗已删，五个形状工具在位 ----
let r = await evaluate(`(() => {
  const labels = [...document.querySelectorAll('.toolbar .tbtn')].map((b) => b.textContent.trim())
  return { labels }
})()`)
const removed = ['导入项目', '导出设置', '导出 JSON', '导出选中画板']
const added = ['文本', '直线', '多段线', '圆形', '矩形']
check('工具条已删掉红框内四颗按钮', removed.every((x) => !r.labels.includes(x)), JSON.stringify(r.labels))
check('工具条新增五个形状工具', added.every((x) => r.labels.includes(x)), JSON.stringify(r.labels))

// ---- 2. 逐个工具：双击空白新建对应形状 ----
// 直线 / 圆形 / 矩形是「两点定大小」：双击落起点，移动，再双击落终点，对角线就是尺寸
const tools = [
  { label: '文本', kind: 'text', at: [220, 220] },
  { label: '直线', kind: 'line', from: [480, 160], to: [740, 300] },
  // 多段线不是双击落的：给它三个落点，最后一次双击收尾
  { label: '多段线', kind: 'polyline', at: [880, 220], pointDraw: [[300, 300], [420, 360], [560, 300]] },
  { label: '圆形', kind: 'circle', from: [160, 460], to: [340, 620] },
  { label: '矩形', kind: 'rect', from: [460, 460], to: [700, 620] }
]
for (const t of tools) {
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '${t.label}')
    b.click(); return b.textContent.trim()
  })()`)
  if (t.pointDraw) {
    // 单击落点：点与点相距远（>8px）不会被当成双击收尾
    for (const [cx, cy] of t.pointDraw) {
      const q = await screen(cx, cy)
      await mouse('mousePressed', q.x, q.y)
      await mouse('mouseReleased', q.x, q.y)
      await sleep(130)
    }
    const lastPt = await screen(t.pointDraw[t.pointDraw.length - 1][0], t.pointDraw[t.pointDraw.length - 1][1])
    await dbl(lastPt.x, lastPt.y)
  } else if (t.from) {
    const a = await screen(t.from[0], t.from[1])
    await dbl(a.x, a.y)
    const b = await screen(t.to[0], t.to[1])
    await mouse('mouseMoved', b.x, b.y, 0)
    await sleep(120)
    await dbl(b.x, b.y)
  } else {
    const p = await screen(t.at[0], t.at[1])
    const atEl = await evaluate('(() => { const e = document.elementFromPoint(' + p.x + ',' + p.y + '); return e ? (e.className || e.tagName) : null })()')
    console.error('   point', JSON.stringify(p), 'under=', atEl)
    await dbl(p.x, p.y)
  }
  const got = await evaluate(`(() => {
    const s = window.__cmf.store.getState()
    const last = s.shapes[s.shapes.length - 1]
    return { n: s.shapes.length, last: last?.kind, pts: last?.points?.length ?? 0, sel: s.selectedIds.slice(), tool: s.tool,
             w: last?.w ?? 0, h: last?.h ?? 0,
             dbl: window.__dbl, targets: window.__dblTargets.slice(-2) }
  })()`)
  const wantW = t.from ? Math.abs(t.to[0] - t.from[0]) : null
  const wantH = t.from ? Math.abs(t.to[1] - t.from[1]) : null
  const sizeOk = t.from ? Math.abs(got.w - wantW) <= 1 && Math.abs(got.h - wantH) <= 1 : true
  check(
    t.pointDraw
      ? `逐点画「${t.label}」：三个落点 + 双击收尾`
      : t.from
        ? `双击起点 + 双击终点画出「${t.label}」，大小就是对角线`
        : `双击新建「${t.label}」`,
    got.last === t.kind && got.sel.length === 1 && got.sel[0] && (!t.pointDraw || got.pts >= 3) && sizeOk,
    JSON.stringify({ n: got.n, last: got.last, pts: got.pts, tool: got.tool, dbl: got.dbl, targets: got.targets, sel: got.sel, size: `${got.w}×${got.h}`, want: t.from ? `${wantW}×${wantH}` : '' })
  )
}

// ---- 2d. 按住 Shift：直线锁水平 / 垂直，圆形 / 矩形锁正圆 / 正方形 ----
{
  const before = await evaluate('(() => window.__cmf.store.getState().shapes.length)()')
  const SHIFT = 8 // CDP 的修饰键位：1=Alt 2=Ctrl 4=Meta 8=Shift
  const draw = async (label, from, to) => {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '${label}')
      b.click()
    })()`)
    await sleep(150)
    const a = await screen(from[0], from[1])
    const b = await screen(to[0], to[1])
    const press = (type, p, count = 1) =>
      send('Input.dispatchMouseEvent', {
        type,
        x: p.x,
        y: p.y,
        button: 'left',
        buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1,
        clickCount: count,
        modifiers: SHIFT
      })
    await sleep(600)
    await press('mousePressed', a)
    await press('mouseReleased', a)
    await press('mousePressed', a, 2)
    await press('mouseReleased', a, 2)
    await sleep(250)
    await press('mouseMoved', b)
    await sleep(150)
    await sleep(600)
    await press('mousePressed', b)
    await press('mouseReleased', b)
    await press('mousePressed', b, 2)
    await press('mouseReleased', b, 2)
    await sleep(250)
    return evaluate(`(() => { const s = window.__cmf.store.getState(); const l = s.shapes[s.shapes.length - 1]; return { kind: l?.kind, w: l?.w, h: l?.h } })()`)
  }
  // 拖出来是「偏了 40px 的竖线」，锁垂直后应该变成一条不歪的竖线（宽 2px）
  let s1 = await draw('直线', [700, 560], [740, 690])
  check('Shift 让直线锁成垂直线（不歪）', s1.kind === 'line' && s1.w <= 3 && s1.h === 130, JSON.stringify(s1))
  let s2 = await draw('圆形', [700, 200], [780, 260])
  check('Shift 让圆形锁成正圆', s2.kind === 'circle' && s2.w === 80 && s2.h === 80, JSON.stringify(s2))
  let s3 = await draw('矩形', [700, 330], [760, 400])
  check('Shift 让矩形锁成正方形', s3.kind === 'rect' && s3.w === 70 && s3.h === 70, JSON.stringify(s3))
  // 这三个是验证 Shift 的临时形状，删掉，后面的图层数量断言仍然按 5 个算
  const cleaned = await evaluate(`(() => {
    const s = window.__cmf.store.getState()
    const ids = s.shapes.slice(${before}).map((x) => x.id)
    s.removeShapes(ids)
    return { removed: ids.length, n: window.__cmf.store.getState().shapes.length }
  })()`)
  check('Shift 用例的临时形状已清理，画布回到 5 个形状', cleaned.n === before && cleaned.removed === 3, JSON.stringify(cleaned))
}

// ---- 2e. 形状工具下「没在画」的时候，单击形状照样能选中 / 拖动 ----
{
  await evaluate(`(() => {
    [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '矩形').click()
  })()`)
  await sleep(200)
  const before = await evaluate(`(() => {
    const S = window.__cmf.store, st = window.__cmf.stage, s = S.getState()
    const sh = s.shapes.find((x) => x.kind === 'rect')
    const r = st.container().getBoundingClientRect()
    return { id: sh.id, x: sh.x, y: sh.y, n: s.shapes.length, k: st.scaleX(),
      sx: r.left + st.x() + (sh.x + sh.w / 2) * st.scaleX(),
      sy: r.top + st.y() + (sh.y + sh.h / 2) * st.scaleY() }
  })()`)
  await mouse('mousePressed', before.sx, before.sy)
  await mouse('mouseReleased', before.sx, before.sy)
  await sleep(220)
  const sel = await evaluate(`(() => ({ sel: window.__cmf.store.getState().selectedIds.slice(), n: window.__cmf.store.getState().shapes.length }))()`)
  check(
    '形状工具下单击形状即选中（不会新建形状）',
    sel.sel.length === 1 && sel.sel[0] === before.id && sel.n === before.n,
    JSON.stringify({ ...sel, id: before.id })
  )

  const dx = 40
  const dy = 24
  await mouse('mousePressed', before.sx, before.sy)
  await mouse('mouseMoved', before.sx + dx, before.sy + dy)
  await sleep(80)
  await mouse('mouseReleased', before.sx + dx, before.sy + dy)
  await sleep(260)
  const moved = await evaluate(`(() => { const sh = window.__cmf.store.getState().shapes.find((x) => x.id === ${JSON.stringify(before.id)}); return { x: sh.x, y: sh.y } })()`)
  check(
    '形状工具下也能直接拖动形状',
    Math.abs(moved.x - before.x - dx / before.k) <= 2 && Math.abs(moved.y - before.y - dy / before.k) <= 2,
    JSON.stringify({ from: [before.x, before.y], to: [moved.x, moved.y], k: before.k })
  )
}

// ---- 2f. 形状可以自由改长宽：拖角不再锁比例，尺寸栏能输数值 / 锁比例 / 互换 ----
{
  await evaluate(`(() => {
    const S = window.__cmf.store.getState()
    S.setTool('select')
    S.select(S.shapes.find((x) => x.kind === 'rect').id)
  })()`)
  await sleep(260)
  const tr = await evaluate(`(() => {
    const walk = (n) => {
      if (typeof n.getChildren !== 'function') return null
      for (const c of n.getChildren()) {
        if (c.getClassName() === 'Transformer') return c
        const r = walk(c)
        if (r) return r
      }
      return null
    }
    const t = walk(window.__cmf.stage)
    return t ? { keep: t.keepRatio(), anchors: t.enabledAnchors().length } : null
  })()`)
  check('选中矩形时变换框不锁长宽，且四边中也有手柄', !!tr && tr.keep === false && tr.anchors === 8, JSON.stringify(tr))

  // 真拖右下角：只往右拉 60px，高度应该一点不变
  const before = await evaluate(`(() => {
    const st = window.__cmf.stage, s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect')
    const r = st.container().getBoundingClientRect()
    return { w: s.w, h: s.h, k: st.scaleX(),
      x: r.left + st.x() + (s.x + s.w) * st.scaleX(), y: r.top + st.y() + (s.y + s.h) * st.scaleY() }
  })()`)
  await mouse('mousePressed', before.x, before.y)
  await mouse('mouseMoved', before.x + 60, before.y)
  await sleep(90)
  await mouse('mouseReleased', before.x + 60, before.y)
  await sleep(280)
  const after = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { w: s.w, h: s.h } })()`)
  check(
    '拖右下角只改宽不改高（不再锁比例）',
    Math.abs(after.w - before.w - 60 / before.k) <= 2 && Math.abs(after.h - before.h) <= 1,
    JSON.stringify({ before: [before.w, before.h], after: [after.w, after.h] })
  )

  // 尺寸栏：直接输数值
  const inputs = await evaluate(`(() => [...document.querySelectorAll('.size-cell input')].length)()`)
  const setNum = (i, v) =>
    evaluate(`(() => {
      const el = [...document.querySelectorAll('.size-cell input')][${i}]
      if (!el) return 'no-input'
      el.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${v}')
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    })()`)
  await setNum(0, 320)
  await sleep(200)
  let sz = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { w: s.w, h: s.h } })()`)
  check('尺寸栏能直接输宽度', inputs === 2 && sz.w === 320, JSON.stringify({ inputs, ...sz }))

  // 锁比例：改宽时高度按比例跟着走
  await evaluate(`(() => { document.querySelectorAll('.size-btn')[0].click() })()`)
  await sleep(200)
  const lockedTr = await evaluate(`(() => {
    const walk = (n) => { if (typeof n.getChildren !== 'function') return null; for (const c of n.getChildren()) { if (c.getClassName() === 'Transformer') return c; const r = walk(c); if (r) return r } return null }
    const t = walk(window.__cmf.stage)
    const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect')
    return { keep: t.keepRatio(), lock: !!s.lockRatio }
  })()`)
  check('锁形按钮让变换框恢复等比', lockedTr.keep === true && lockedTr.lock === true, JSON.stringify(lockedTr))

  const preLock = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { w: s.w, h: s.h } })()`)
  await setNum(0, 160)
  await sleep(220)
  const proportional = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { w: s.w, h: s.h } })()`)
  const wantH = Math.round((160 * preLock.h) / preLock.w)
  check(
    '锁定比例后改宽，高度按比例一起变',
    proportional.w === 160 && Math.abs(proportional.h - wantH) <= 1,
    JSON.stringify({ from: preLock, to: proportional, wantH })
  )

  // 互换长宽
  const preSwap = proportional
  await evaluate(`(() => { document.querySelectorAll('.size-btn')[1].click() })()`)
  await sleep(220)
  const swapped = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { w: s.w, h: s.h } })()`)
  check('互换长宽', swapped.w === preSwap.h && swapped.h === preSwap.w, JSON.stringify({ preSwap, swapped }))

  // 收尾：把矩形还原成一个规整尺寸，后面的用例继续用
  await evaluate(`(() => { const st = window.__cmf.store.getState(); st.updateShape(st.shapes.find((x) => x.kind === 'rect').id, { w: 240, h: 160, lockRatio: false }) })()`)
  await sleep(150)
}

// ---- 2b. 多段线的半截要能被 Esc 丢掉（不能留在画布上，也不能变成一条新形状）----
{
  const beforeN = await evaluate('(() => window.__cmf.store.getState().shapes.length)()')
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '多段线')
    b.click(); return b.textContent.trim()
  })()`)
  for (const [cx, cy] of [[240, 660], [380, 700]]) {
    const q = await screen(cx, cy)
    await mouse('mousePressed', q.x, q.y)
    await mouse('mouseReleased', q.x, q.y)
    await sleep(130)
  }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(250)
  const afterN = await evaluate('(() => ({ n: window.__cmf.store.getState().shapes.length, tool: window.__cmf.store.getState().tool }))()')
  check('Esc 丢掉没画完的多段线', afterN.n === beforeN && afterN.tool === 'select', JSON.stringify({ beforeN, ...afterN }))
}

// ---- 2c. Ctrl / ⌘ + 左键：随手回到选择工具（画到一半也生效）----
{
  await evaluate(`(() => {
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '多段线')
    b.click()
  })()`)
  await sleep(150)
  const q = await screen(300, 300)
  const mods = 2 // 1=Alt 2=Ctrl 4=Meta 8=Shift
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q.x, y: q.y, button: 'left', buttons: 1, clickCount: 1, modifiers: mods })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q.x, y: q.y, button: 'left', buttons: 0, clickCount: 1, modifiers: mods })
  await sleep(280)
  const t = await evaluate(`(() => ({ tool: window.__cmf.store.getState().tool, n: window.__cmf.store.getState().shapes.length }))()`)
  check('Ctrl + 左键回到选择工具', t.tool === 'select', JSON.stringify(t))
}

// ---- 3. 图层列表出现对应的形状图层 ----
r = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.layer-item')]
  const shapeRows = rows.filter((x) => [...x.querySelectorAll('.layer-kind')].some((k) => k.textContent.trim() === '形'))
  return { total: rows.length, shapeRows: shapeRows.length, titles: shapeRows.map((x) => x.querySelector('.layer-txt strong').textContent.trim()) }
})()`)
check('图层面板新增 5 行形状图层', r.shapeRows === 5, JSON.stringify(r.titles))

// ---- 4. 点形状自动跳到「标注」页：形状不单独占页签，属性统一在标注设置框里 ----
// 前面的 Esc / Ctrl+左键 用例会把选择清掉，这里先重新选中一个形状
await evaluate(`(() => { const S = window.__cmf.store.getState(); S.select(S.shapes.find((x) => x.kind === 'rect').id) })()`)
await sleep(250)
r = await evaluate(`(() => ({
  tab: document.querySelector('.right-tab.on')?.textContent.trim(),
  tabs: [...document.querySelectorAll('.right-tab')].map((x) => x.textContent.trim()),
  title: [...document.querySelectorAll('.right .sect-title')].map((x) => x.textContent.trim())
}))()`)
check('右栏只有 全局 / 标注 / 画板 三个页签', r.tabs.join('|') === '全局|标注|画板', JSON.stringify(r.tabs))
check('选中形状自动跳「标注」页并显示标注设置', r.tab === '标注' && r.title.some((t) => t.includes('标注设置')), JSON.stringify(r))

// ---- 5. 画布上真的能点中形状（命中区） ----
await evaluate(`(() => {
  [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '选择').click()
  const S = window.__cmf.store.getState(); S.select(null)
})()`)
await sleep(180)
r = await evaluate(`(() => {
  const S = window.__cmf.store, st = window.__cmf.stage
  const sh = S.getState().shapes.find((x) => x.kind === 'rect')
  sh && S.getState().select(null)
  const cx = sh.x + sh.w / 2, cy = sh.y + sh.h / 2
  const hit = st.getIntersection({ x: cx * st.scaleX() + st.x(), y: cy * st.scaleY() + st.y() })
  let n = hit, owner = null
  while (n) { if (S.getState().shapes.some((x) => x.id === n.id())) { owner = n.id(); break } n = n.getParent && n.getParent() }
  const rect = st.container().getBoundingClientRect()
  return { id: sh.id, owner, x: rect.left + st.x() + cx * st.scaleX(), y: rect.top + st.y() + cy * st.scaleY() }
})()`)
check('矩形内部可命中（点得到）', r.owner === r.id, JSON.stringify({ owner: r.owner, id: r.id }))
await mouse('mousePressed', r.x, r.y)
await mouse('mouseReleased', r.x, r.y)
await sleep(220)
r = await evaluate(`(() => ({ sel: window.__cmf.store.getState().selectedIds.slice(), tab: document.querySelector('.right-tab.on')?.textContent.trim() }))()`)
check('点击形状即选中并跳到「标注」设置', r.sel.length === 1 && r.tab === '标注', JSON.stringify(r))

// ---- 6. 右栏改颜色 / 粗细 / 透明度（面板实际操作） ----
const before = await evaluate(`(() => { const s = window.__cmf.store.getState(); return s.shapes.find((x) => x.id === s.selectedIds[0]) })()`)
r = await evaluate(`(() => {
  const dots = [...document.querySelectorAll('.right .color-dot')]
  dots[1].click()
  const sliders = [...document.querySelectorAll('.right input[type="range"]')]
  const set = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // 形状页里：线条粗细第一个 slider、透明度最后一个 slider
  set(sliders[0], 8)
  set(sliders[sliders.length - 1], 0.5)
  return { dots: dots.length, sliders: sliders.length }
})()`)
await sleep(180)
const after = await evaluate(`(() => { const s = window.__cmf.store.getState(); return s.shapes.find((x) => x.id === s.selectedIds[0]) })()`)
check(
  '右栏可调颜色 / 粗细 / 透明度',
  after.color !== before.color && Math.abs(after.strokeWidth - 8) < 0.01 && Math.abs(after.opacity - 0.5) < 0.01,
  JSON.stringify({ color: after.color, stroke: after.strokeWidth, opacity: after.opacity, ui: r })
)

// 右栏形状设置页截图（选中矩形、颜色与滑杆都在）
const shapeShot = await send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync(path.resolve('shots/shapes-panel.png'), Buffer.from(shapeShot.data, 'base64'))

// ---- 7. 文字内容与字号：改字后高度按内容重算 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  const t = S.shapes.find((x) => x.kind === 'text')
  S.select(t.id)
  return { id: t.id, h: t.h }
})()`)
await sleep(180)
const setText = await evaluate(`(() => {
  const ta = document.querySelector('.right textarea')
  if (!ta) return false
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, '外壳 / 磨砂处理\\n第二行说明文字\\n第三行补充说明')
  ta.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)
await sleep(220)
const txt = await evaluate(`(() => { const s = window.__cmf.store.getState(); return s.shapes.find((x) => x.id === s.selectedIds[0]) })()`)
check('文本框可在设置页改字且高度自动重排', setText && (txt.text ?? '').includes('磨砂') && txt.h > r.h, JSON.stringify({ oldH: r.h, newH: txt.h, text: txt.text }))

// ---- 8. 撤销：history 快照带着 shapes ----
await sleep(500)
await evaluate(`(() => { [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.title.startsWith('撤销')).click() })()`)
await sleep(250)
const undone = await evaluate(`(() => { const s = window.__cmf.store.getState(); const t = s.shapes.find((x) => x.kind === 'text'); return t?.text ?? '' })()`)
check('撤销能回到改字之前（快照含形状）', !undone.includes('磨砂'), JSON.stringify({ text: undone }))

// ---- 9. 工程 JSON 读写带上形状 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  const before = S.getState().shapes.length
  const p = S.getState().exportProject()
  S.getState().loadProject(p)
  return { before, inJson: (p.shapes ?? []).length, after: S.getState().shapes.length }
})()`)
check('工程 JSON 保存 / 打开都带形状', r.inJson === r.before && r.after === r.before, JSON.stringify(r))
await sleep(300)

// ---- 10. SVG 导出带形状图层 ----
await evaluate(`(async () => {
  const S = window.__cmf.store.getState()
  const b = S.artboards[0]
  S.updateBoard(b.id, { format: 'svg', dpi: 96, native: false })
  S.selectBoard(b.id)
  await new Promise((r) => setTimeout(r, 150))
  return true
})()`)
await evaluate(`(async () => { await window.__cmf.controls.current.exportBoards('selected'); return true })()`)
await sleep(900)
const svgFile = fs.existsSync(DL) ? fs.readdirSync(DL).find((f) => f.endsWith('.svg')) : null
const svg = svgFile ? fs.readFileSync(path.join(DL, svgFile), 'utf8') : ''
check(
  'SVG 导出含可编辑形状图层',
  !!svgFile && svg.includes('形状标注') && svg.includes('<polyline') && svg.includes('<ellipse') && svg.includes('<text'),
  JSON.stringify({ file: svgFile, hasLayer: svg.includes('形状标注'), len: svg.length })
)

// ---- 11. 形状图层：复制 / 分组 / 隐藏 / 删除 ----
r = await evaluate(`(() => {
  const S = window.__cmf.store
  S.getState().selectBoard(null)
  S.getState().setTool('select')
  const sh = S.getState().shapes[0]
  S.getState().select(sh.id)
  return { id: sh.id, n: S.getState().shapes.length }
})()`)
await evaluate(`(() => { document.querySelector('.right .btn[title^="原地复制"]').click() })()`)
await sleep(150)
const dup = await evaluate(`(() => { const s = window.__cmf.store.getState(); return { n: s.shapes.length, sel: s.selectedIds.length } })()`)
check('形状可复制副本', dup.n === r.n + 1 && dup.sel === 1, JSON.stringify(dup))

r = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  const ids = S.shapes.slice(0, 2).map((x) => x.id)
  S.select(ids[0]); S.select(ids[1], true)
  S.groupSelectedLayers()
  const st = window.__cmf.store.getState()
  return { groups: st.groups.length, grouped: st.shapes.filter((x) => x.groupId).length }
})()`)
check('形状可以归到图层分组', r.groups > 0 && r.grouped >= 2, JSON.stringify(r))

const hiddenIds = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  const gid = S.groups[S.groups.length - 1].id
  S.setGroupVisible(gid, false)
  return window.__cmf.store.getState().shapes.filter((x) => x.groupId === gid).map((x) => x.id)
})()`)
await sleep(250) // 等 React 重渲染，否则量到的还是上一帧的 Konva 节点
r = await evaluate('(() => { const stage = window.__cmf.stage; const ids = ' + JSON.stringify(hiddenIds) + '; return { hidden: ids.length, onStage: ids.filter((id) => stage.findOne("#" + id)).length } })()')
check('隐藏整组后形状不再出现在画布上', r.hidden >= 2 && r.onStage === 0, JSON.stringify(r))

r = await evaluate(`(() => {
  const S = window.__cmf.store.getState()
  const sh = S.shapes.find((x) => !x.hidden)
  S.select(sh.id)
  return { id: sh.id, n: S.shapes.length }
})()`)
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
await sleep(180)
const deleted = await evaluate(`(() => ({ n: window.__cmf.store.getState().shapes.length }))()`)
check('Delete 能删掉形状', deleted.n === r.n - 1, JSON.stringify(deleted))

// ---- 22. 多段线工具空闲时点已有形状：选中它，不落第一个点 ----
{
  const before = await evaluate(`(() => {
    const st = window.__cmf.store.getState()
    st.select(null)
    const b = [...document.querySelectorAll('.toolbar .tbtn')].find((x) => x.textContent.trim() === '多段线')
    b.click()
    return { n: st.shapes.length }
  })()`)
  await sleep(220)
  const rect = await evaluate(`(() => { const s = window.__cmf.store.getState().shapes.find((x) => x.kind === 'rect'); return { id: s.id, x: s.x, y: s.y, w: s.w, h: s.h } })()`)
  const q = await screen(rect.x + rect.w / 2, rect.y + rect.h / 2)
  await mouse('mousePressed', q.x, q.y)
  await mouse('mouseReleased', q.x, q.y)
  await sleep(260)
  const after = await evaluate(`(() => {
    const st = window.__cmf.store.getState()
    const stg = window.__cmf.stage
    // 覆盖层里那个全屏命中 Rect（fill 0.001）还在不在 = 有没有落点
    const overlay = stg.getLayers().some((l) => l.getChildren().some((n) => n.getClassName() === 'Rect' && String(n.fill()).includes('0.001')))
    return { sel: st.selectedIds.slice(), n: st.shapes.length, overlay, tool: st.tool }
  })()`)
  check(
    '多段线工具下点形状＝直接选中（不落点）',
    after.sel.length === 1 && after.sel[0] === rect.id && after.n === before.n && after.overlay === false && after.tool === 'polyline',
    JSON.stringify({ before: before.n, ...after })
  )
}

// ---- 23. 多段线预览是实线：和成品同色同粗细，没有 dash ----
{
  await evaluate(`(() => { window.__cmf.store.getState().select(null) })()`)
  await sleep(120)
  const q1 = await screen(240, 700)
  const q2 = await screen(420, 760)
  await mouse('mousePressed', q1.x, q1.y)
  await mouse('mouseReleased', q1.x, q1.y)
  await sleep(160)
  await mouse('mouseMoved', q2.x, q2.y)
  await sleep(220)
  const prev = await evaluate(`(() => {
    const stg = window.__cmf.stage
    const layers = stg.getLayers()
    const top = layers[layers.length - 1]
    const line = top.getChildren().find((n) => n.getClassName() === 'Line')
    if (!line) return { found: false }
    return { found: true, dash: line.dash() || [], stroke: line.strokeWidth(), strokeColor: line.stroke() }
  })()`)
  check(
    '多段线预览用实线（无 dash、粗细＝成品 2px）',
    prev.found === true && (prev.dash.length === 0) && Math.abs(prev.stroke - 2) < 0.01,
    JSON.stringify(prev)
  )
  // 收尾，别把半截草稿留给后面的用例
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: q2.x, y: q2.y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: q2.x, y: q2.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(140)
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await sleep(200)
}

// ---- 12. 截图 ----
const shot = await send('Page.captureScreenshot', { format: 'png' })
fs.mkdirSync(path.resolve('shots'), { recursive: true })
fs.writeFileSync(path.resolve('shots/shapes.png'), Buffer.from(shot.data, 'base64'))
console.error('[3] screenshot saved')

console.log(log.join('\n'))
const fails = log.filter((x) => x.startsWith('FAIL'))
console.log(`\n${log.length - fails.length}/${log.length} passed`)
ws.close()
if (fails.length) process.exit(1)
