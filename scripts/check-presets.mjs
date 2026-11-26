// 材质 / 工艺「快捷标签」的自测（开发期工具，不参与构建）
//   node scripts/check-presets.mjs [url]
// 覆盖：标注面板与项目信息栏两处入口、展开后的项数、点选拼接用「 + 」、
//       再点一次取消、材质名里的加号不被拆开、手打顿号也能高亮、两处互不影响。
import fs from 'node:fs'
import path from 'node:path'

const APP = process.argv[2] || 'http://localhost:5173/'
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const OUT = path.resolve('shots/presets')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const log = []
const check = (name, ok, extra = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`
  log.push(line)
  console.error(line)
}

// ---- 连接页面目标 ----
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
        if (/^(Inspector\.|Page\.(frameDetached|javascriptDialogOpening)|Runtime\.exceptionThrown)/.test(m.method || ''))
          console.error('[ev]', m.method, JSON.stringify(m.params || {}).slice(0, 140))
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
    const evaluate = async (expression, userGesture = false) =>
      (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }))
        .result.value
    try {
      await send('Page.enable', {}, 5000)
      await send('Runtime.enable')
      await send('Inspector.enable').catch(() => {})
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

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
}

await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

// ---- 定位工具：先锁到某个分组卡片，再找其中某个栏目行 ----
const ROW = (label, sect = '标注信息栏') => `(() => {
  const sec = [...document.querySelectorAll('.sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === ${JSON.stringify(sect)})
  if (!sec) return null
  return [...sec.querySelectorAll('.cmf-row')].find((r) => r.querySelector('.combo input')?.value === ${JSON.stringify(label)}) || null
})()`

const toggle = (label, sect) => evaluate(`(() => {
  const row = ${ROW(label, sect)}
  if (!row) return 'no-row'
  row.querySelector('.preset-toggle').click()
  return 'ok'
})()`)

const clickChip = (label, text, sect) => evaluate(`(() => {
  const row = ${ROW(label, sect)}
  if (!row) return 'no-row'
  const chip = [...row.querySelectorAll('.preset-chip')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})
  if (!chip) return 'no-chip'
  chip.click()
  return 'ok'
})()`)

const readRow = (label, sect) => evaluate(`(() => {
  const row = ${ROW(label, sect)}
  if (!row) return null
  return {
    value: row.querySelector('.cmf-body textarea, .cmf-body input[type="text"]')?.value ?? '',
    chips: row.querySelectorAll('.preset-chip').length,
    on: [...row.querySelectorAll('.preset-chip.on')].map((b) => b.textContent.trim()),
    count: row.querySelector('.preset-count')?.textContent.trim() || '',
    pad: !!row.querySelector('.preset-pad')
  }
})()`)

const ann = () =>
  evaluate(`(() => {
    const a = window.__cmf.store.getState().annotations[0]
    return a ? { material: a.cmf.material, finish: a.cmf.finish } : null
  })()`)

const infoVal = (label) =>
  evaluate(`(() => {
    const f = window.__cmf.store.getState().info.fields.find((x) => x.label === ${JSON.stringify(label)})
    return f ? f.value : null
  })()`)

// ---- 造一个最小工程：一张图 + 一条空材质/空工艺的标注 ----
await send('Page.navigate', { url: `${APP}?doc=presettest` })
await send('Page.bringToFront')
await sleep(1800)

let r = await evaluate(`(() => {
  const S = window.__cmf.store
  const st = S.getState()
  st.clearCanvas()
  const c = document.createElement('canvas'); c.width = 640; c.height = 420
  const g = c.getContext('2d'); g.fillStyle = '#8f9aa8'; g.fillRect(0, 0, 640, 420)
  g.fillStyle = '#fff'; g.font = '700 40px sans-serif'; g.fillText('CMF RENDER', 36, 110)
  st.addImages([{ id: 'img-1', dataUrl: c.toDataURL('image/png'), name: 'a.png', x: 0, y: 0, w: 640, h: 420 }])
  st.addAnnotation({
    id: 'ann-1', anchor: { x: 200, y: 200 }, label: { x: 260, y: 120 },
    cmf: { name: 'P1', color: '#e60012', material: '', finish: '', process: '注塑', note: '' },
    createdAt: 1
  })
  S.setState({ selectedIds: ['ann-1'] })
  // 项目信息栏的材质 / 工艺会被自动存档带回来，先清空，保证每次跑都是同一个起点
  const st2 = S.getState()
  st2.info.fields
    .filter((f) => f.label === '材质' || f.label === '工艺')
    .forEach((f) => st2.updateInfoField(f.id, { value: '' }))
  return true
})()`)
await sleep(600)
console.error('[2] project built')

// ---- 1. 两行都有入口，且默认收起 ----
r = await evaluate(`(() => {
  const sec = [...document.querySelectorAll('.sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '标注信息栏')
  return {
    toggles: sec ? [...sec.querySelectorAll('.preset-toggle')].map((b) => b.textContent.trim()) : [],
    chips: sec ? sec.querySelectorAll('.preset-chip').length : -1
  }
})()`)
check(
  '标注的材质 / 工艺两栏都有快捷标签入口',
  r.toggles.length === 2 && r.toggles[0].includes('材质') && r.toggles[1].includes('工艺'),
  JSON.stringify(r.toggles)
)
check('折叠时不渲染标签，只占一行按钮', r.chips === 0, `chips ${r.chips}`)

// ---- 2. 展开材质：清单齐全 ----
await toggle('材质')
await sleep(250)
r = await readRow('材质')
check('展开后平铺出全部材质项', r.chips === 30, `chips ${r.chips}`)
check('尚末选中时没有高亮项、也没有计数徽标', r.on.length === 0 && r.count === '', JSON.stringify(r.on))

// ---- 3. 点一项 → 拼进去；再点一项 → 用「 + 」连接 ----
await clickChip('材质', 'PC+ABS')
await sleep(200)
r = await readRow('材质')
let a = await ann()
check('点一个标签就填进材质栏', r.value === 'PC+ABS' && a.material === 'PC+ABS', `${r.value} / store ${a.material}`)
check('材质名里的加号不被拆开，仍算同一项', r.on.length === 1 && r.on[0] === 'PC+ABS', JSON.stringify(r.on))

await clickChip('材质', 'PC')
await sleep(200)
r = await readRow('材质')
a = await ann()
check('多选时用「 + 」连接', r.value === 'PC+ABS + PC' && a.material === 'PC+ABS + PC', `${r.value}`)
check('计数徽标显示已选 2 项', r.count === '2' && r.on.length === 2, `count ${r.count} / on ${JSON.stringify(r.on)}`)

// ---- 4. 再点一次 → 取消该项（只去掉它自己）----
await clickChip('材质', 'PC+ABS')
await sleep(200)
r = await readRow('材质')
a = await ann()
check('再点一次取消该项，其余保留', r.value === 'PC' && a.material === 'PC', `${r.value}`)

await clickChip('材质', '其他')
await sleep(200)
await shot('01-material')

// ---- 5. 工艺面板与标注框同步 ----
await toggle('工艺')
await sleep(250)
r = await readRow('工艺')
check('工艺清单 23 项（截图 20 + 补 3）', r.chips === 23, `chips ${r.chips}`)
await clickChip('工艺', '磨砂')
await clickChip('工艺', '拉丝')
await sleep(250)
r = await readRow('工艺')
a = await ann()
check('工艺同样可多选并写回标注', r.value === '磨砂 + 拉丝' && a.finish === '磨砂 + 拉丝', `${r.value}`)
check('材质与工艺各自独立', a.material === 'PC + 其他', `material ${a.material}`)

// ---- 6. 手打顿号也能被认出来（不用非点标签）----
await evaluate(`(() => {
  const S = window.__cmf.store
  const st = S.getState()
  const a = st.annotations[0]
  st.updateAnnotation(a.id, { cmf: { ...a.cmf, finish: '哑面、亮面、本色' } })
  return 1
})()`)
await sleep(400)
r = await readRow('工艺')
check(
  '手打「哑面、亮面、本色」时三个标签同时高亮',
  r.on.length === 3 && r.count === '3',
  JSON.stringify(r.on)
)
await shot('02-finish')

// ---- 7. 项目信息栏：同样有标签，且和标注互不影响 ----
// 项目信息栏在右栏的「全局」页签下（选中对象时右栏自动切去「标注」页），先切回来
r = await evaluate(`(() => {
  const tab = [...document.querySelectorAll('.right-tab')].find((b) => b.textContent.trim() === '全局')
  if (!tab) return 'no-tab'
  tab.click()
  return 'ok'
})()`)
check('右栏能切回「全局」页签', r === 'ok', String(r))
await sleep(600)

r = await evaluate(`(() => {
  const sec = [...document.querySelectorAll('.sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '项目信息栏')
  if (!sec) return 'no-sect'
  if (!sec.classList.contains('is-open')) sec.querySelector('.sect-head').click()
  return 'ok'
})()`)
check('项目信息栏可展开', r === 'ok', String(r))
await sleep(400)
r = await evaluate(`(() => {
  const sec = [...document.querySelectorAll('.sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '项目信息栏')
  return sec ? [...sec.querySelectorAll('.cmf-row')].filter((x) => x.querySelector('.preset-toggle')).map((x) => x.querySelector('.combo input')?.value) : []
})()`)
check('项目信息栏的材质 / 工艺行也有入口', JSON.stringify(r) === '["材质","工艺"]', JSON.stringify(r))

await toggle('材质', '项目信息栏')
await sleep(250)
r = await readRow('材质', '项目信息栏')
check('项目信息栏展开后同样是 30 项', r.chips === 30, `chips ${r.chips}`)

await clickChip('材质', '铝合金', '项目信息栏')
await sleep(250)
const projMat = await infoVal('材质')
a = await ann()
check('点选写进项目信息栏', projMat === '铝合金', `info ${projMat}`)
check('项目信息栏的选择不影响标注', a.material === 'PC + 其他', `标注 ${a.material}`)
// 项目信息栏比一屏长，截图前把材质行滚到中间，不然拍不到标签区
await evaluate(`(() => {
  const row = ${ROW('材质', '项目信息栏')}
  if (row) row.scrollIntoView({ block: 'center' })
  return 1
})()`)
await sleep(300)
await shot('03-project')

// ---- 汇总 ----
const failed = log.filter((l) => l.startsWith('FAIL'))
console.error(`\n${log.length - failed.length}/${log.length} 通过`)
if (failed.length) console.error(failed.join('\n'))
ws.close()
process.exit(failed.length ? 1 : 0)
