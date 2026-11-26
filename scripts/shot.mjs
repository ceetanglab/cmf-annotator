// 界面截图工具（用于改样式后自查，不参与构建）
//   1) 先起一个开着远程调试的 Chrome：
//      chrome --headless=new --remote-debugging-port=9226 --user-data-dir=<tmp> about:blank
//   2) node scripts/shot.mjs <url> <out.png> [要先点击的按钮/标题文字] [裁剪选择器]
import fs from 'node:fs'

const [APP, OUT = 'tmp-shot.png', CLICK = '', CLIP = ''] = process.argv.slice(2)
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!APP) throw new Error('用法：node scripts/shot.mjs <url> <out.png> [点击文字] [裁剪选择器]')

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
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails, null, 2))
  return r.result.value
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 1600,
  height: 1000,
  deviceScaleFactor: 2,
  mobile: false
})
await send('Page.navigate', { url: APP })

for (let i = 0; i < 40; i++) {
  await sleep(300)
  if (await evaluate('!!document.querySelector(".sect")')) break
  if (i === 39) throw new Error('页面没渲染出来')
}

if (CLICK) {
  // 支持 "第一个||第二个" 连续点击（先展开分组、再点里面的入口）
  for (const text of CLICK.split('||').filter(Boolean)) {
    const ok = await evaluate(`(() => {
      const el = [...document.querySelectorAll('.sect-head, button')]
        .find((e) => e.textContent.trim().includes(${JSON.stringify(text)}))
      if (!el) return false
      el.click()
      return true
    })()`)
    if (!ok) throw new Error('找不到要点击的元素：' + text)
    await sleep(400)
  }
}

await sleep(300)
if (CLIP) {
  // 先把目标滚进视口，否则截到的是视口外的一片空白
  await evaluate(`document.querySelector(${JSON.stringify(CLIP)})?.scrollIntoView({ block: 'center' })`)
  await sleep(250)
}
const clip = CLIP
  ? await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(CLIP)})
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }
    })()`)
  : null

const shot = await send('Page.captureScreenshot', {
  format: 'png',
  ...(clip ? { clip } : {})
})
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
if (clip) console.log(`✔ ${OUT}  ${Math.round(clip.width)}×${Math.round(clip.height)}`)
else console.log(`✔ ${OUT}`)
ws.close()
