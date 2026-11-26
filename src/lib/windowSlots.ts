// 多开时的窗口号：默认项目名的 -01 / -02 / -03 …
//
// 窗口之间没法直接问「你是第几个」，所以在一张共享的小表里排队：
// localStorage 里记「哪个工程槽位占了第几号」，每个窗口定期报到；
// 超过 TTL 没报到的（关掉、崩了）自动让位，下一次开工能接着用回这个号。
//
// 表坏了 / localStorage 不可用时一律退回 1 号，绝不因此挡住开工。

const KEY = 'cmf-window-slots'
/** 报到间隔与过期时间：20 秒没动静就当这个窗口没了 */
const BEAT = 5000
const TTL = 20000

interface Slot {
  doc: string
  num: number
  t: number
}

function read(): Slot[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    const now = Date.now()
    return arr.filter(
      (s): s is Slot =>
        !!s && typeof s.doc === 'string' && typeof s.num === 'number' && typeof s.t === 'number' && now - s.t < TTL
    )
  } catch {
    return []
  }
}

function write(list: Slot[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 隐私模式写不进去：那就各叫各的，不影响开工 */
  }
}

function put(list: Slot[], doc: string, num: number): Slot[] {
  return [...list.filter((s) => s.doc !== doc), { doc, num, t: Date.now() }]
}

/**
 * 领一个窗口号：从 1 开始找第一个没被占的。
 * 同一个 docId 再进来（刷新 / 重新打开同一个工程）沿用原来的号。
 */
export function claimWindowNumber(docId: string): number {
  const list = read()
  const mine = list.find((s) => s.doc === docId)
  if (mine) {
    write(put(list, docId, mine.num))
    return mine.num
  }
  const used = new Set(list.map((s) => s.num))
  let n = 1
  while (used.has(n)) n++
  write(put(list, docId, n))
  return n
}

/** 定期报到，并让窗口关闭时把自己的号还回去 */
export function startWindowHeartbeat(docId: string, num: number): () => void {
  const beat = () => write(put(read(), docId, num))
  const timer = window.setInterval(beat, BEAT)
  const release = () => {
    window.clearInterval(timer)
    write(read().filter((s) => s.doc !== docId))
  }
  window.addEventListener('pagehide', release)
  // 页面被彻底关掉时 pagehide 不一定来得及，再兜一层
  window.addEventListener('beforeunload', release)
  return () => {
    window.removeEventListener('pagehide', release)
    window.removeEventListener('beforeunload', release)
    release()
  }
}
