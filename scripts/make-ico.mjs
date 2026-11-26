// 从 assets/icons 的母版 PNG 生成站点图标，输出到 site/
//
// 图标母版只有一套：assets/icons/*.png（多尺寸）+ assets/icon.svg（矢量）。
// 这里只做两件事：把 16/32 打包成 favicon.ico、把需要的尺寸按站点约定命名拷一份。
// 换 logo 时重跑即可，不用手改 site/ 里的文件。
//
// 用法：node scripts/make-ico.mjs
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = process.cwd()
const SRC = resolve(ROOT, 'assets/icons')
const OUT = resolve(ROOT, 'site')

const read = (name) => {
  const p = resolve(SRC, name)
  if (!existsSync(p)) throw new Error(`缺少图标母版：${p}`)
  const b = readFileSync(p)
  if (b.slice(1, 4).toString() !== 'PNG') throw new Error(`不是 PNG：${p}`)
  return b
}

// ICO 允许每个条目直接内嵌一张 PNG（Vista 之后所有浏览器都支持）
function toICO(items) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(items.length, 4)

  const dir = Buffer.alloc(16 * items.length)
  let offset = 6 + dir.length
  items.forEach((it, i) => {
    const o = i * 16
    dir[o] = it.size >= 256 ? 0 : it.size
    dir[o + 1] = it.size >= 256 ? 0 : it.size
    dir[o + 2] = 0
    dir[o + 3] = 0
    dir.writeUInt16LE(1, o + 4) // planes
    dir.writeUInt16LE(32, o + 6) // bpp
    dir.writeUInt32LE(it.png.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += it.png.length
  })

  return Buffer.concat([header, dir, ...items.map((it) => it.png)])
}

writeFileSync(
  resolve(OUT, 'favicon.ico'),
  toICO([
    { size: 16, png: read('icon-16.png') },
    { size: 32, png: read('icon-32.png') }
  ])
)

// 站点约定的文件名 → 母版
copyFileSync(resolve(SRC, 'icon-32.png'), resolve(OUT, 'favicon-32.png'))
copyFileSync(resolve(SRC, 'apple-touch-icon-180.png'), resolve(OUT, 'apple-touch-icon.png'))
copyFileSync(resolve(ROOT, 'assets/icon.svg'), resolve(OUT, 'icon.svg'))

console.log('✔ site/favicon.ico（16 + 32）')
console.log('✔ site/favicon-32.png')
console.log('✔ site/apple-touch-icon.png（180）')
console.log('✔ site/icon.svg')
