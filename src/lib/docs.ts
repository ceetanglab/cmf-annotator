// 工程存储：IndexedDB，一条工程一条记录，按 docId 分区。
//
// 为什么不用 localStorage：多开意味着多份工程同时常驻，而 localStorage 全站只有 5 MB，
// 一张渲染图的 dataURL 就 1~3 MB —— 几份工程就会写爆，而且 setItem 抛异常时
// 现在的实现是静默吞掉的（用户以为存上了，其实早没存）。
//
// 两张表分开：meta 很轻（列表用，不必把几十 MB 的工程读出来），data 放大对象。
import type { CMFProject } from '../types'

const DB_NAME = 'cmf-docs'
const DB_VER = 1
const META = 'meta'
const DATA = 'data'

export interface DocMeta {
  id: string
  /** 列表里显示的名字：优先用工程名 */
  name: string
  updatedAt: number
  images: number
  /** 粗略体积（图片 dataURL 长度之和），只用来给用户一个量级感知 */
  size: number
}

let dbp: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VER)
    } catch (err) {
      reject(err)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('另一个窗口正占用本地数据库，请先关掉旧标签页'))
  })
  return dbp
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** 工程体积的粗略估算：图片占绝对大头，没必要为了精确而 stringify 整个工程 */
export function projectSize(p: CMFProject): number {
  let n = 0
  for (const im of p.images || []) n += im.dataUrl?.length || 0
  return n
}

export async function listDocs(): Promise<DocMeta[]> {
  try {
    const db = await openDB()
    const all = await done(db.transaction(META, 'readonly').objectStore(META).getAll())
    return (all as DocMeta[]).sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

export async function loadDoc(id: string): Promise<CMFProject | null> {
  try {
    const db = await openDB()
    const rec = (await done(db.transaction(DATA, 'readonly').objectStore(DATA).get(id))) as
      | { id: string; project: CMFProject }
      | undefined
    return rec?.project ?? null
  } catch {
    return null
  }
}

/** 写工程 + 更新它的 meta，同一个事务里完成，避免列表和内容对不上 */
export async function saveDoc(id: string, p: CMFProject, name: string): Promise<DocMeta> {
  const db = await openDB()
  const meta: DocMeta = {
    id,
    name: name || '未命名项目',
    updatedAt: Date.now(),
    images: (p.images || []).length,
    size: projectSize(p)
  }
  const t = db.transaction([META, DATA], 'readwrite')
  t.objectStore(DATA).put({ id, project: p })
  t.objectStore(META).put(meta)
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error || new Error('写入被中断'))
  })
  return meta
}

export async function deleteDoc(id: string): Promise<void> {
  const db = await openDB()
  const t = db.transaction([META, DATA], 'readwrite')
  t.objectStore(DATA).delete(id)
  t.objectStore(META).delete(id)
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

// 项目列表变了就喊一声，左栏「项目」区块据此刷新，不用把列表状态提到 App 里。
// 本窗口用 CustomEvent，其他窗口用 BroadcastChannel —— IndexedDB 是跨窗口共享的，
// A 窗口存完，B 窗口的列表也得跟着变，否则两边看到的时间会差一截。

const CHANNEL = 'cmf-docs'
let chan: BroadcastChannel | null = null
try {
  chan = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
} catch {
  chan = null
}

export const DOCS_CHANGED = 'cmf:docs-changed'

export function bumpDocs() {
  window.dispatchEvent(new Event(DOCS_CHANGED))
  try {
    chan?.postMessage('changed')
  } catch {
    /* 通道被关掉 / 不支持，忽略：本窗口的列表仍然是准的 */
  }
}

/** 订阅列表变化（含其他窗口的写入），返回取消订阅函数 */
export function onDocsChanged(fn: () => void): () => void {
  window.addEventListener(DOCS_CHANGED, fn)
  chan?.addEventListener('message', fn)
  return () => {
    window.removeEventListener(DOCS_CHANGED, fn)
    chan?.removeEventListener('message', fn)
  }
}
