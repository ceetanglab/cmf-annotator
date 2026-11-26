// 项目区（多开）的自测（开发期工具，不参与构建）
//   node scripts/check-projects.mjs [url]
// 覆盖：槽位 id 写进网址、项目区渲染、IndexedDB 自动存档、导入项目覆盖当前、
//       增加项目（新窗口）、最近工程列表、切换工程、删除、模板文件护栏。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const APP = process.argv[2] || 'http://localhost:5173/'
const CDP = process.env.CDP || 'http://127.0.0.1:9226'
const DL = path.resolve('shots/dl-projects')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const log = []
const check = (name, ok, extra = '') => {
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`
  log.push(line)
  // 实时往 stderr 打一份：中途卡死时也能看出跑到哪一步了
  console.error(line)
}
const waitFor = async (fn, ms = 6000, step = 200) => {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn()
    if (v || Date.now() > end) return v
    await sleep(step)
  }
}

// ---- 连接页面目标：上次跑崩留下死目标时换一个新的，否则后面每个命令都会超时 ----
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
        // 关键事件打出来：崩溃 / 弹窗 / 导航都能在这里看到
        if (/^(Inspector\.|Page\.(frameDetached|javascriptDialogOpening|frameNavigated|loadEventFired)|Runtime\.exceptionThrown)/.test(m.method || ''))
          console.error('[ev]', m.method, JSON.stringify(m.params || {}).slice(0, 140))
        return
      }
      if (!waiting.has(m.id)) return
      const { resolve, reject, timer } = waiting.get(m.id)
      waiting.delete(m.id)
      clearTimeout(timer)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
    // 每个命令都带超时：目标死了要能立刻发现，而不是把整个脚本吊死
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
      return { ws, send, evaluate, targetId: target.id }
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

const { ws, send, evaluate, targetId } = await connect()
console.error('[1] connected')

const acceptDialog = async (tries = 8) => {
  for (let i = 0; i < tries; i++) {
    try {
      await send('Page.handleJavaScriptDialog', { accept: true })
      return true
    } catch {
      await sleep(150)
    }
  }
  return false
}

/** 往隐藏的 file input 塞文件（0=导入项目 1=上传图片） */
const setFile = async (index, filePath) => {
  const { root } = await send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeIds } = await send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: 'input[type=file]' })
  const nodeId = nodeIds[index]
  if (!nodeId) throw new Error(`找不到第 ${index} 个 file input`)
  await send('DOM.setFileInputFiles', { nodeId, files: [filePath] })
}

const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(DL, `${name}.png`), Buffer.from(data, 'base64'))
}

const goto = async (url) => {
  await send('Page.navigate', { url })
  // 窗口不在前台时 renderer 会丢 Input 事件，先置前
  await send('Page.bringToFront')
  await sleep(1800)
}

const assets = `document.querySelectorAll('.asset-grid .asset:not(.asset-add)').length`

await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false })
fs.rmSync(DL, { recursive: true, force: true })
fs.mkdirSync(DL, { recursive: true })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL })

// 先从一个干净的库开始。注意不能用 deleteDatabase：页面自己开着一个连接，删除会被永久 block，
// 只能按记录清空（同版本号的第二个连接不会影响页面那条）
await goto(APP)
await evaluate(`(async () => {
  localStorage.clear()
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('cmf-docs')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  await new Promise((res, rej) => {
    const t = db.transaction(['meta', 'data'], 'readwrite')
    t.objectStore('meta').clear()
    t.objectStore('data').clear()
    t.oncomplete = res
    t.onerror = () => rej(t.error)
  })
  db.close()
  return 1
})()`)
await goto(APP)
console.error('[2] clean state')

// ---- 1. 网址上写了槽位 id：这是「一个窗口一个工程」的根 ----
let r = await evaluate(`({ doc: new URL(location.href).searchParams.get('doc') })`)
check('打开时自动分配工程槽位并写进网址', !!r.doc && /^[0-9a-z]{4,32}$/.test(r.doc), r.doc || '(空)')
const docA = r.doc

// ---- 2. 项目区渲染 ----
r = await evaluate(`(() => {
  const sec = [...document.querySelectorAll('.left .sect')].find((s) => s.querySelector('.sect-title')?.textContent.trim() === '项目')
  return {
    hasSect: !!sec,
    isFirst: document.querySelector('.left .sect') === sec,
    curName: sec?.querySelector('.proj-cur-txt strong')?.textContent.trim() || '',
    tag: sec?.querySelector('.proj-tag')?.textContent.trim() || '',
    acts: [...sec.querySelectorAll('.proj-acts .btn')].map((b) => b.textContent.trim()),
    empty: sec?.querySelector('.proj-empty')?.textContent.trim() || '',
    head: sec?.querySelector('.proj-list-head')?.textContent.trim() || '',
    rows: sec?.querySelectorAll('.proj-row').length || 0
  }
})()`)
check('左栏第一块就是「项目」', r.hasSect && r.isFirst)
check('项目区显示当前工程名与「当前」标签', !!r.curName && r.tag === '当前', `${r.curName} / ${r.tag}`)
check('两个入口在位：增加项目 / 导入项目', r.acts.join(',') === '增加项目,导入项目', JSON.stringify(r.acts))
check('空库时列表给空态说明', r.rows === 0 && /增加项目/.test(r.empty), `行 ${r.rows}`)
check('空库时「最近工程」右侧不长「仅本机」', !/仅本机/.test(r.head), JSON.stringify(r.head))
await shot('01-empty')

// ---- 3. 导入项目（覆盖当前）----
const mkProject = (name, imageCount) => ({
  version: 2,
  info: {
    fields: [
      { label: '项目', value: name },
      { label: '设计师', value: '测试' }
    ]
  },
  images: Array.from({ length: imageCount }, (_, i) => ({
    id: `img${i}`,
    name: `${name}-${i + 1}.png`,
    // 1×1 透明 PNG：体积小、能正常解码
    dataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    x: i * 100,
    y: 0,
    w: 400,
    h: 300
  })),
  annotations: [],
  shapes: [],
  updatedAt: Date.now()
})

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cmf-'))
const fileB = path.join(tmp, '工程B.json')
fs.writeFileSync(fileB, JSON.stringify(mkProject('工程B', 2)), 'utf8')

await setFile(0, fileB)
await sleep(600)
// confirm 会挡住渲染进程：从 CDP 侧点掉
await acceptDialog()
await sleep(1000)

r = await evaluate(`(() => ({
  assets: ${assets},
  rows: document.querySelectorAll('.proj-row').length,
  curRow: document.querySelectorAll('.proj-row.is-on').length,
  curName: document.querySelector('.proj-cur-txt strong')?.textContent.trim() || '',
  title: document.title
}))()`)
check('导入项目后画布里是这份工程的内容', r.assets === 2, `素材 ${r.assets} 张`)
check('导入后列表出现这条工程并标记为当前', r.rows === 1 && r.curRow === 1, `行 ${r.rows} / 当前 ${r.curRow}`)
check('项目区当前名换成导入的工程', r.curName === '工程B', r.curName)
check('窗口标题跟着工程名走', r.title.startsWith('工程B'), r.title)
await sleep(700)

// ---- 4. 自动存档进 IndexedDB（同一槽位重新打开还在）----
r = await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('cmf-docs')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  const meta = await new Promise((res, rej) => {
    const q = db.transaction('meta').objectStore('meta').getAll()
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  db.close()
  return meta.map((m) => ({ id: m.id, name: m.name, images: m.images }))
})()`)
check(
  '工程按槽位存进 IndexedDB',
  r.some((m) => m.id === docA && m.name === '工程B' && m.images === 2),
  JSON.stringify(r)
)

await goto(`${APP}?doc=${docA}`)
r = await evaluate(`({ assets: ${assets}, name: document.querySelector('.proj-cur-txt strong')?.textContent.trim() || '' })`)
check('同一网址重新打开能读回工程', r.assets === 2 && r.name === '工程B', JSON.stringify(r))

// ---- 5. 切换工程（本窗口打开另一份）----
// 先造出第二份工程：直接写进库（「开新窗口」那条路单独放在最后测，免得先被多窗口带偏）
const docC = 'probe0001'
const cProj = mkProject('工程C', 1)
await evaluate(`(async () => {
  const db = await new Promise((res, rej) => {
    const q = indexedDB.open('cmf-docs')
    q.onsuccess = () => res(q.result)
    q.onerror = () => rej(q.error)
  })
  const t = db.transaction(['meta', 'data'], 'readwrite')
  t.objectStore('data').put({ id: '${docC}', project: ${JSON.stringify(cProj)} })
  t.objectStore('meta').put({ id: '${docC}', name: '工程C', updatedAt: Date.now(), images: 1, size: 0 })
  await new Promise((res) => { t.oncomplete = res })
  db.close()
  return 1
})()`)
await evaluate(`window.dispatchEvent(new Event('cmf:docs-changed')); 1`)
await sleep(500)

const otherName = await evaluate(`(() => {
  const row = [...document.querySelectorAll('.proj-row')].find((x) => !x.className.includes('is-on'))
  const name = row.querySelector('.proj-txt strong').textContent.trim()
  row.querySelector('.proj-act').click()
  return name
})()`)
await sleep(2400)
r = await evaluate(`({ url: location.href, name: document.querySelector('.proj-cur-txt strong')?.textContent.trim() || '' })`)
check('切到另一份工程后槽位换掉了', !r.url.includes(`doc=${docA}`), r.url.slice(0, 80))
check('切换后内容换成那份工程的', r.name === otherName, `${r.name} / ${otherName}`)

// ---- 6. 模板文件不能当工程导入 ----
const tplFile = path.join(tmp, '模板.json')
fs.writeFileSync(tplFile, JSON.stringify({ kind: 'cmf-template', name: '模板A' }), 'utf8')
await setFile(0, tplFile)
await sleep(900)
r = await evaluate(`document.querySelector('.proj-err')?.textContent.trim() || ''`)
check('模板文件走「导入项目」会被拦下并提示去处', /模板/.test(r), r)

// ---- 7. 删除非当前工程 ----
const beforeCount = await evaluate(`document.querySelectorAll('.proj-row').length`)
// 注意：点击里同步弹 confirm，页面会一直阻塞到弹窗关掉，这条 evaluate 的响应也会跟着卡住。
// 所以先发出去、不等它，弹出后从 CDP 侧点掉，再回头收结果
const clicked = evaluate(`(() => {
  const row = [...document.querySelectorAll('.proj-row')].find((x) => !x.className.includes('is-on'))
  row.querySelector('.proj-del').click()
  return 1
})()`).catch(() => 'blocked')
await sleep(400)
await acceptDialog()
await clicked
await sleep(700)
r = await evaluate(`document.querySelectorAll('.proj-row').length`)
check('删除非当前工程后列表少一条', r === beforeCount - 1, `${beforeCount} → ${r}`)

// ---- 8. 增加项目：直接开一份空白工程，当前窗口不动 ----
const curDoc = await evaluate(`new URL(location.href).searchParams.get('doc')`)
const before = (await pages()).length
await evaluate(
  `(() => {
    const btn = [...document.querySelectorAll('.proj-acts .btn')].find((b) => b.textContent.trim() === '增加项目')
    btn.click()
    return 1
  })()`,
  // window.open 需要用户手势，否则会被弹窗拦截
  true
)
const popup = await waitFor(async () => {
  const list = await pages()
  if (list.length <= before) return null
  const p = list.find((t) => t.id !== targetId)
  return p && p.url ? p : null
})
check('「增加项目」新开一个窗口', (await pages()).length === before + 1, `${before} → ${(await pages()).length}`)
if (popup) {
  const u = new URL(popup.url)
  check(
    '新窗口直接开在工程网址上，不是 about:blank',
    u.searchParams.get('doc') !== null && !u.searchParams.has('new'),
    popup.url.slice(0, 100)
  )
  check(
    '空白工程拿到自己的槽位（与当前不同）',
    !!u.searchParams.get('doc') && u.searchParams.get('doc') !== docA,
    popup.url.slice(0, 90)
  )
  const blank = await waitFor(async () => {
    const t = (await pages()).find((x) => x.id === popup.id)
    return t && /未命名项目-\d\d/.test(decodeURIComponent(t.title || '')) ? t : null
  }, 3000)
  check('新窗口是一份空白工程（默认名 -01 递增，没有等文件）', !!blank && !decodeURIComponent(blank.title || '').includes('工程C'), blank ? blank.title : '标题没变')
}
await sleep(1400)
check('空白工程窗口不会自己关掉', (await pages()).length === before + 1, `${before} → ${(await pages()).length}`)

// 断言完就关掉：两个窗口停在同一个槽位上会互相覆盖
if (popup) {
  await fetch(`${CDP}/json/close/${popup.id}`)
  await send('Page.bringToFront')
  await sleep(600)
}

r = await evaluate(`({ assets: ${assets}, url: location.href })`)
check('当前窗口内容没被新开工的工程顶掉', r.url.includes(`doc=${curDoc}`) && r.assets === 1, JSON.stringify(r))

// ---- 9. 空白工程不落库：最近工程仍只有原有那一条 ----
await evaluate(`window.dispatchEvent(new Event('cmf:docs-changed')); 1`)
await sleep(500)
r = await evaluate(`(() => {
  const rows = [...document.querySelectorAll('.proj-row')]
  return {
    names: rows.map((x) => x.querySelector('.proj-txt strong').textContent.trim()),
    curHasDel: !!rows.find((x) => x.className.includes('is-on'))?.querySelector('.proj-del')
  }
})()`)
check('空白工程不落库，最近工程仍只有已有那条', r.names.length === 1 && r.names[0] === '工程C', JSON.stringify(r.names))
check('当前工程那行不给删（避免边看边删）', r.curHasDel === false)

// ---- 10. 老版 localStorage 存档会迁进第一个槽位 ----
// 升级前所有用户都只有这一份存档，不能因为换了存储位置就让他们丢画面
await evaluate(`localStorage.setItem('cmf-project-autosave', JSON.stringify(${JSON.stringify(mkProject('老工程', 1))})); 1`)
await goto(APP)
await sleep(900)
r = await evaluate(`({
  assets: ${assets},
  name: document.querySelector('.proj-cur-txt strong')?.textContent.trim() || '',
  ls: localStorage.getItem('cmf-project-autosave'),
  rows: document.querySelectorAll('.proj-row').length
})`)
check(
  '老 localStorage 存档迁进新槽位并清掉老键',
  r.assets === 1 && r.name === '老工程' && r.ls === null,
  JSON.stringify(r)
)

// ---- 10. 导入的工程没写项目名时，用文件名兜底（工程自己写了就尊重它）----
const mkBare = (projectName) => ({
  version: 2,
  info: { fields: [{ label: '项目', value: projectName }, { label: '设计师', value: '' }] },
  images: [],
  annotations: [],
  shapes: [],
  updatedAt: Date.now()
})
const fileNunu = path.join(tmp, '怒怒.json')
fs.writeFileSync(fileNunu, JSON.stringify(mkBare('')), 'utf8')
await setFile(0, fileNunu)
await sleep(700)
await acceptDialog()
await sleep(900)
r = await evaluate(`({
  name: document.querySelector('.proj-cur-txt strong')?.textContent.trim() || '',
  info: window.__cmf.store.getState().info.fields.find((f) => f.label === '项目')?.value || '',
  title: document.title
})`)
check('导入的工程没写项目名时，用文件名当项目名', r.name === '怒怒' && r.info === '怒怒', JSON.stringify(r))
check('窗口标题也跟着换成新项目名', r.title.startsWith('怒怒'), r.title)

const fileOther = path.join(tmp, '随便什么名字.json')
fs.writeFileSync(fileOther, JSON.stringify(mkBare('工程C')), 'utf8')
await setFile(0, fileOther)
await sleep(700)
await acceptDialog()
await sleep(900)
r = await evaluate(`document.querySelector('.proj-cur-txt strong')?.textContent.trim() || ''`)
check('工程自己写了项目名就不被文件名覆盖', r === '工程C', r)

const fail = log.filter((l) => l.startsWith('FAIL')).length
console.log(`\n${fail ? 'FAILED' : 'ALL PASS'}  ${log.length - fail}/${log.length}`)
ws.close()
process.exit(fail ? 1 : 0)
