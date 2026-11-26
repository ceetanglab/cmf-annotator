import type { CMFProject } from '../types'

// 旧版（单工程时代）的自动存档。现在工程都存在 IndexedDB 里按 docId 分槽，
// 这个模块只剩「迁移老存档」一个用途：第一次打开时把这份内容搬进第一个槽位，然后清掉。
// 留在 localStorage 里的原因：那是当年唯一的存放处，不能指望用户自己导出过 JSON。
const KEY = 'cmf-project-autosave'

export function loadLocal(): (CMFProject & { image?: string }) | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as CMFProject & { image?: string }) : null
  } catch {
    return null
  }
}

/** 迁移完成后清掉，否则每开一个新窗口都会把老画面又搬一遍 */
export function clearLocal() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* 隐私模式下可能抛异常，忽略 */
  }
}
