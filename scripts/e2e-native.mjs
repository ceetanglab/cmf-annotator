// 端到端验证「导出尺寸」是否等于预期：走真实的 DOM 路径（点按钮），拦截下载的 data URL 后量像素。
// 依赖一个开着远程调试的 Chrome：
//   chrome --headless --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank
// 用法：node scripts/e2e-native.mjs http://localhost:5183/
import fs from 'node:fs'

const APP = process.argv[2] || 'http://localhost:5183/'
const CDP = 'http://127.0.0.1:9225'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function targets() {
  const res = await fetch(`${CDP}/json/list`)
  return res.json()
}

class Session {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.waiting = new Map()
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.id && this.waiting.has(msg.id)) {
        const { resolve, reject } = this.waiting.get(msg.id)
        this.waiting.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails, null, 2))
    return r.result.value
  }
}

const list = await targets()
const page = list.find((t) => t.type === 'page')
if (!page) throw new Error('没有可用的页面目标')

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})
const s = new Session(ws)
await s.send('Page.enable')
await s.send('Runtime.enable')
await s.send('Page.navigate', { url: APP })
// dev 首次启动要等 vite 预构建 + React 挂载，轮询到 __cmf 出现为止（最多 20s）
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const ready = await s.eval('!!(window.__cmf && window.__cmf.store)')
  if (ready) break
  if (i === 39) throw new Error('应用没起来：window.__cmf 一直不存在')
}

const script = String.raw`
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const st = () => window.__cmf.store.getState()
  const clickText = (t) => {
    const b = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t)
    if (!b) throw new Error('找不到按钮：' + t)
    b.click()
    return b
  }

  // 造一张 800×600 的假渲染图（画面上有硬边方块，便于看出是否被重采样）
  const c = document.createElement('canvas')
  c.width = 800
  c.height = 600
  const g = c.getContext('2d')
  g.fillStyle = '#3366cc'
  g.fillRect(0, 0, 800, 600)
  g.fillStyle = '#ffffff'
  g.fillRect(120, 120, 160, 160)
  g.fillStyle = '#e8b4a0'
  g.fillRect(400, 300, 200, 160)
  // 每次从空画面开始：自动保存会把上一次的图 / 标注 / 区域一起带过来
  st().clearCanvas()
  st().addImages([{ id: 'probe-img', dataUrl: c.toDataURL('image/png'), name: 'probe.png', x: 0, y: 0, w: 800, h: 600 }])
  // 造一条标注，SVG 里才有真正的 annotation 分组可查
  st().addAnnotation({
    id: 'probe-ann',
    anchor: { x: 600, y: 420 },
    label: { x: 40, y: 40 },
    cmf: {
      name: '前壳',
      color: 'PANTONE 7527 C',
      material: 'PC + ABS',
      finish: '细磨砂',
      process: '注塑',
      note: '与后壳同色系，拼缝控制在 0.3mm 以内并做顺色处理'
    },
    createdAt: Date.now()
  })
  // 第二条标注用箭头端点 + 平铺水印，把 SVG 里这两条不常走的路径也覆盖到
  st().addAnnotation({
    id: 'probe-ann-arrow',
    anchor: { x: 470, y: 480 },
    label: { x: 40, y: 560 },
    endStyle: 'arrow',
    cmf: {
      name: '卡扣',
      color: '',
      material: 'POM',
      finish: '自润滑',
      process: '注塑',
      note: '插拔寿命 5 万次'
    },
    createdAt: Date.now()
  })
  st().patchWatermark({ on: true, mode: 'tile', text: 'SAMPLE', size: 24, density: 40, opacity: 0.3 })
  // 上一次跑留下的自定义区域 / 原分辨率开关都会被自动保存带过来，先清掉才能量到干净基线
  st().setExportRect(null)
  st().setExportPreset('a4l')
  st().setExportNative(false)
  await sleep(900)

  // 拦截下载：PNG 走 data URL，SVG/PDF 走 blob URL，这里只量 PNG
  const caps = []
  const origClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.href) caps.push({ href: this.href, name: this.download })
  }
  const measure = (href) => new Promise((res, rej) => {
    const im = new Image()
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
    im.onerror = () => rej(new Error('decode failed'))
    im.src = href
  })

  const out = { region: st().regionSize, cases: [] }
  st().setExportFormat('png')
  // 打开导出设置面板（走工具栏那个按钮，和用户操作一致）
  clickText('导出设置')
  await sleep(500)
  out.panelOpen = !!document.querySelector('.preset-grid')

  // 量一次「最新一次下载」的像素尺寸；没产生新下载就报错，避免拿上一轮的图凑数
  const tap = async (label, btn, wait = 1400) => {
    const before = caps.length
    btn.click()
    await sleep(wait)
    if (caps.length === before) throw new Error(label + '：没有触发下载')
    const last = caps[caps.length - 1]
    const px = await measure(last.href)
    // 分辨率那一行的右侧读数（原分辨率时应显示自动换算的 DPI）
    const vals = [...document.querySelectorAll('.field-head .val')].map((n) => n.textContent.trim())
    return { name: label, file: last.name, w: px.w, h: px.h, vals }
  }
  const primary = () => document.querySelector('.btn.primary.block')

  // ---- 用例 1：勾选「导出框选区域原分辨率」后出图 ----
  clickText('导出框选区域原分辨率')
  await sleep(300)
  out.cases.push(await tap('native-toggle', primary()))

  // ---- 用例 2：A4 @150DPI 基线（应回到固定页面像素）----
  document.querySelector('button[aria-label="A4 横向（297×210）"]').click()
  clickText('150')
  await sleep(200)
  const a4Case = await tap('a4-150', primary(), 2000)
  out.cases.push(a4Case)
  out.png = caps[caps.length - 1].href

  // ---- 用例 3：自定义框选区域 + 原分辨率（区域 300×200 应得 300×200）----
  st().setExportRect({ x: 40.4, y: 30.6, w: 300, h: 200 })
  await sleep(300)
  out.region2 = st().regionSize
  clickText('导出框选区域原分辨率')
  await sleep(300)
  out.cases.push(await tap('native-custom-rect', primary()))

  // ---- 用例 3.5：自定义文件名（非法字符被清掉、首尾空白去掉，扩展名按格式补）----
  st().setExportName(' 测试/图纸 01. ')
  await sleep(250)
  out.filenameCase = (await tap('filename', primary())).file
  st().setExportName('CMF 总表')
  await sleep(250)

  // ---- 用例 4：SVG 分层导出（检查分组 / 可解析 / 文字仍是 text）----
  st().setExportRect(null)
  st().setExportNative(false)
  st().setExportFormat('svg')
  await sleep(300)
  const svgBefore = caps.length
  primary().click()
  // downloadBlob 1.5s 后会撤销 blob URL，必须立刻取
  await sleep(150)
  const svgCap = caps[caps.length - 1]
  if (caps.length === svgBefore) throw new Error('SVG：没有触发下载')
  const svgText = await (await fetch(svgCap.href)).text()
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  const err = doc.querySelector('parsererror')
  out.svg = {
    name: svgCap.name,
    kb: Math.round(svgText.length / 1024),
    parserError: err ? err.textContent.slice(0, 160) : null,
    groups: [...svgText.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]),
    textCount: (svgText.match(/<text /g) || []).length,
    imageCount: (svgText.match(/<image /g) || []).length,
    text: svgText
  }

  // ---- 用例 5：导出工程 JSON 的文件名跟产物同名（都用 导出设置 里的文件名）----
  st().setExportName('测试/图纸 01')
  await sleep(250)
  const jsonBefore = caps.length
  clickText('导出 JSON')
  await sleep(400)
  out.jsonName = caps.length > jsonBefore ? caps[caps.length - 1].name : null
  st().setExportName('CMF 总表')
  await sleep(200)

  HTMLAnchorElement.prototype.click = origClick
  return out
})()
`

const out = await s.eval(script)
const svgText = out.svg?.text || ''
if (out.svg) delete out.svg.text
const pngData = out.png || ''
delete out.png
console.log(JSON.stringify(out, null, 2))
if (svgText) {
  fs.writeFileSync('tmp-out.svg', svgText)
  console.log(`\n已写出 tmp-out.svg（${(svgText.length / 1024).toFixed(0)} KB）`)
}
if (pngData.startsWith('data:image/png;base64,')) {
  fs.writeFileSync('tmp-out.png', Buffer.from(pngData.split(',')[1], 'base64'))
  console.log('已写出 tmp-out.png（同一版式的位图，用于和 SVG 对比）')
}

// 顺手截一张面板图，便于目视核对文案与排版；第二个参数可指定收尾时的页面比例
const endPreset = process.argv[3] || 'a4l'
await s.eval(
  `(() => { const st = window.__cmf.store.getState(); st.setExportRect(null); st.setExportPreset(${JSON.stringify(endPreset)}); st.setExportNative(true); return 1 })()`
)
await sleep(600)
const shot = await s.send('Page.captureScreenshot', { format: 'png' })
fs.writeFileSync('tmp-probe.png', Buffer.from(shot.data, 'base64'))
ws.close()
