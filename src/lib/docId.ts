// 每个窗口 = 一个工程槽位。槽位 id 挂在网址上（?doc=xxx），
// 刷新 / 收藏 / 复制链接都能回到同一个工程，也是多开时区分彼此的唯一样子。

const PARAM = 'doc'
const ID_RE = /^[0-9a-z]{4,32}$/

export function readDocId(): string | null {
  try {
    const v = new URL(window.location.href).searchParams.get(PARAM)
    return v && ID_RE.test(v) ? v : null
  } catch {
    return null
  }
}

export function newDocId(): string {
  const a = new Uint32Array(2)
  crypto.getRandomValues(a)
  return a[0].toString(36) + a[1].toString(36)
}

export function docUrl(id: string): string {
  const u = new URL(window.location.href)
  u.searchParams.set(PARAM, id)
  return u.href
}

/** 把槽位写回地址栏（不产生历史记录，避免用户按后退时在两个工程之间跳） */
export function putDocIdInUrl(id: string) {
  try {
    window.history.replaceState(null, '', docUrl(id))
  } catch {
    /* file:// 等场景下 replaceState 可能不可用，忽略即可 —— 槽位仍由内存状态决定 */
  }
}
