// Pantone 颜色栏的自测（开发期工具，不参与构建）
//   node scripts/check-pantone.mjs [url]
// 现在的约定：输入框里就是**色号**（如 186 C），色值只是输入手段；
// 下方只留一个 ΔE（色块与色号的差距）。覆盖：默认值、色值→色号、写法规范化、
// 取色器反算、查不到时原样保留、老工程 hex 迁移。
import fs from 'node:fs'
import path from 'node:path'

const APP = process.argv[2] || 'http://localhost:5173/'
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const OUT = path.resolve('shots/pantone')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const log = []
const check = (name, ok, extra = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`
  log.push(line)
  console.error(line)
}

const pages = async () => (await (await fetch(`${CDP}/json/list`)).json()).filter((t) => t.type === 'page')

const connect = async () => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const target = (await pages())[0]
    if (!target) {
      await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })
      await sleep(600)
      continue
    }
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })
    let id = 0
    const waiting = new Map()
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (!m.id) {
        if (/^(Inspector\.|Runtime\.exceptionThrown)/.test(m.method || ''))
          console.error('[ev]', m.method, JSON.stringify(m.params || {}).slice(0, 160))
        return
      }
      if (!waiting.has(m.id)) return
      const { resolve, reject, timer } = waiting.get(m.id)
      waiting.delete(m.id)
      clearTimeout(timer)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    const send = (method, params = {}, ms = 12000) =>
      new Promise((resolve, reject) => {
        const n = ++id
        const timer = setTimeout(() => {
          waiting.delete(n)
          reject(new Error(`CDP 超时：${method}`))
        }, ms)
        waiting.set(n, { resolve, reject, timer })
        ws.send(JSON.stringify({ id: n, method, params }))
      })
    const evaluate = async (expression) =>
      (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
    try {
      await send('Page.enable', {}, 5000)
      await send('Runtime.enable')
      return { ws, send, evaluate }
    } catch (err) {
      console.error(`[!] 目标无响应（${err.message}），换一个`)
      try {
        ws.close()
      } catch {
        /* 忽略 */
      }
      await fetch(`${CDP}/json/close/${target.id}`)
      await sleep(500)
    }
  }
  throw new Error('连不上可用的页面目标')
}

const { ws, send, evaluate } = await connect()
console.error('[1] connected')

await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}

// 页面侧定位：颜色行的文本输入框 / 取色器
const ROW = `(() => {
  const sec = [...document.querySelectorAll('.sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '标注信息栏')
  if (!sec) return null
  return [...sec.querySelectorAll('.cmf-row')].find((r) => r.querySelector('.combo input')?.value === '颜色') || null
})()`

const TEXT = `(() => { const row = ${ROW}; return row ? row.querySelector('.swatch-row input[type=text]') : null })()`
const SWATCH = `(() => { const row = ${ROW}; return row ? row.querySelector('input.swatch') : null })()`

const typeIn = (text) =>
  evaluate(`(() => {
    const el = ${TEXT}
    if (!el) return 'no-input'
    el.focus()
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(text)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return 'ok'
  })()`)

const blur = () =>
  evaluate(`(() => {
    const el = ${TEXT}
    if (!el) return 'no-input'
    el.blur()
    return 'ok'
  })()`)

const pickColor = (hex) =>
  evaluate(`(() => {
    const el = ${SWATCH}
    if (!el) return 'no-swatch'
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, ${JSON.stringify(hex)})
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return 'ok'
  })()`)

const fieldText = () => evaluate(`(() => { const el = ${TEXT}; return el ? el.value : null })()`)
const hintText = () => evaluate(`document.querySelector('.pt-hint')?.textContent.replace(/\\s+/g, ' ').trim() || ''`)
const colorOf = () => evaluate(`window.__cmf.store.getState().annotations[0]?.cmf.color ?? null`)
const pickedOf = () => evaluate(`window.__cmf.store.getState().annotations[0]?.cmf.colorPicked ?? null`)
// 画布上的文字（Konva 节点），用来确认标注框里也带 Pantone 前缀
const canvasTexts = () =>
  evaluate(`(() => {
    const s = window.__cmf?.stage
    if (!s) return []
    return s.find('Text').map((n) => n.text())
  })()`)

// ---- 造工程 ----
await send('Page.navigate', { url: `${APP}?doc=pantonetest` })
await send('Page.bringToFront')
await sleep(1800)

await evaluate(`(() => {
  const S = window.__cmf.store
  const st = S.getState()
  st.clearCanvas()
  const c = document.createElement('canvas'); c.width = 640; c.height = 420
  const g = c.getContext('2d'); g.fillStyle = '#8f9aa8'; g.fillRect(0, 0, 640, 420)
  st.addImages([{ id: 'img-1', dataUrl: c.toDataURL('image/png'), name: 'a.png', x: 0, y: 0, w: 640, h: 420 }])
  st.addAnnotation({
    id: 'ann-1', anchor: { x: 200, y: 200 }, label: { x: 260, y: 120 },
    cmf: { name: 'P1', color: '186 C', material: '', finish: '', process: '', note: '' },
    createdAt: 1
  })
  S.setState({ selectedIds: ['ann-1'] })
  return 1
})()`)
await sleep(600)

// ---- 1. 框里是色号，下面只有一个 ΔE ----
let v = await fieldText()
let h = await hintText()
check('颜色框里带 Pantone 前缀', v === 'Pantone 186 C', String(v))
check('画布标注里的颜色也带前缀', (await canvasTexts()).includes('Pantone 186 C'), JSON.stringify(await canvasTexts()))
check('直接写色号时不出 ΔE 行（色块就是它自己的色）', h === '', String(h))
check('直接写色号时不写 colorPicked', (await pickedOf()) === null, String(await pickedOf()))

// ---- 2. 填色值 → 换成色号，并把原色值记下来 ----
await typeIn('#E60012')
await sleep(150)
await blur()
await sleep(300)
v = await fieldText()
const c2 = await colorOf()
check('填 #E60012 后框里变成 Pantone 色号', /^Pantone .+ C$/.test(v || '') && !v.startsWith('#'), `${v} / store ${c2}`)
check('原色值存进 colorPicked，供色块与 ΔE 用', (await pickedOf()) === '#E60012', String(await pickedOf()))
h = await hintText()
check('ΔE 不为 0（这个红和色号不完全一样）', /ΔE [1-9]/.test(h), h)
await shot('01-converted')

// ---- 3. 写法规范化：186c → 186 C ----
await typeIn('186c')
await sleep(150)
await blur()
await sleep(300)
v = await fieldText()
check('「186c」确认后规范化成「Pantone 186 C」', v === 'Pantone 186 C', String(v))

// ---- 3b. 改色号时色块立刻换成该色号的近似屏色（不用等失焦）----
await typeIn('300c')
await sleep(250)
const sw = await evaluate(`(() => document.querySelector('.swatch-row input[type=color]').value)()`)
const live = { code: await colorOf(), picked: await pickedOf(), hint: await hintText() }
check(
  '输入色号的同时色块就变成该色号的颜色',
  String(live.code) === '300 C' && live.picked === null && sw.toLowerCase() === '#005eb8',
  JSON.stringify({ ...live, swatch: sw })
)
check('手选色作废后 ΔE 行随之消失', live.hint === '', String(live.hint))
check('画布上跟着换成新色号', (await canvasTexts()).includes('Pantone 300 C'), JSON.stringify(await canvasTexts()))
await blur()
await sleep(200)

// ---- 4. 命名色也认 ----
await typeIn('Cool Gray 11 C')
await sleep(150)
await blur()
await sleep(300)
v = await fieldText()
check('命名色保持原样并加前缀', v === 'Pantone Cool Gray 11 C', String(v))
check('对应 store 也是色号', (await colorOf()) === 'Cool Gray 11 C', String(await colorOf()))

// ---- 5. 取色器：选色后自动换成最接近的色号 ----
await pickColor('#005eb8')
await sleep(350)
v = await fieldText()
check('取色器选蓝色后框里变成 Pantone 300 C', v === 'Pantone 300 C', String(v))
check('取色器选的色值被记住', (await pickedOf()) === '#005EB8', String(await pickedOf()))
h = await hintText()
check('选的就是色号本身的色：ΔE 0.0', /^ΔE 0\.0$/.test(h), h)
await shot('02-picker')

// ---- 6. 查不到的色号：不转、不猜 ----
await typeIn('99999 C')
await sleep(150)
await blur()
await sleep(300)
v = await fieldText()
check('查不到的色号原样留在框里', v === '99999 C', String(v))
check('认不出时没有 ΔE 行', (await hintText()) === '', await hintText())

// ---- 7. 老工程里的 #RRGGBB 打开时迁成色号 ----
const migrated = await evaluate(`(() => {
  const S = window.__cmf.store
  const st = S.getState()
  const proj = st.exportProject()
  proj.annotations = proj.annotations.map((a) => ({ ...a, cmf: { ...a.cmf, color: '#C8102E', colorPicked: undefined } }))
  st.loadProject(proj)
  const a = S.getState().annotations[0]
  return { color: a.cmf.color, picked: a.cmf.colorPicked ?? null }
})()`)
check('老工程的 #C8102E 加载时迁成 186 C', migrated.color === '186 C', JSON.stringify(migrated))
check('迁移时保留原色值，ΔE 仍有意义', migrated.picked === '#C8102E', JSON.stringify(migrated))

// ---- 汇总 ----
const failed = log.filter((l) => l.startsWith('FAIL'))
console.error(`\n${log.length - failed.length}/${log.length} 通过`)
if (failed.length) console.error(failed.join('\n'))
ws.close()
process.exit(failed.length ? 1 : 0)
