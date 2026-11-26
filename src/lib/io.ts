import type { CMFProject } from '../types'

/**
 * 文件名净化：不同系统对文件名的限制不一样，这里统一收一遍，
 * 让用户在输入框里怎么打都不会得到「保存失败 / 文件名非法」。
 * - 去掉 Windows 非法字符 \ / : * ? " < > |（macOS 只禁 /，取交集）
 * - 连续空白收成一个；首尾空白与结尾的点去掉（Windows 不允许以点结尾）
 * - 限长 80，避免超过各系统 255 字节的限制（中文 3 字节/字）
 */
export function safeFileName(raw: string, fallback = '项目名'): string {
  const s = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .replace(/[\s.]+$/, '')
    .slice(0, 80)
    .trim()
  return s || fallback
}

// 通用 JSON 下载（工程 / 模板共用）
export function downloadAnyJSON(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = /\.json$/i.test(filename) ? filename : `${filename}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJSON(project: CMFProject) {
  // 工程 JSON 跟产物同名：用户在「导出设置 → 文件名」里改一次，图片 / PDF / SVG / 工程文件就都叫这个名字
  // （payload 里的 name 字段仍是项目名，用于导入后回显，两者互不影响）
  downloadAnyJSON(project, safeFileName(project.exportName || project.name || '未命名项目'))
}

export function readJSONFile<T = CMFProject>(file: File): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)) as T)
      } catch (e) {
        reject(e)
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export function readImageFile(file: File): Promise<{ dataUrl: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ dataUrl: String(reader.result), name: file.name })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new window.Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = src
  })
}
