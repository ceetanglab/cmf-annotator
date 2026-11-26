// 把 dist 里的 JS / CSS 内联进单个 HTML，产出三份（内容完全一样）：
//   1) dist/cmf-annotator.html   —— 可离线双击打开的独立文件
//   2) cmf-annotator.html        —— 仓库根那份，给 GitHub 上直接下载的人用
//   3) dist/site/index.html      —— 上线用：整个 dist/site 目录丢到站点根目录即可
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const indexPath = join(dist, 'index.html')
if (!existsSync(indexPath)) {
  console.error('未找到 dist/index.html，请先执行 vite build')
  process.exit(1)
}

let html = readFileSync(indexPath, 'utf8')

const readAsset = (href) => readFileSync(join(dist, href.replace(/^\.?\//, '')), 'utf8')

// <link rel="stylesheet" href="./assets/x.css"> → <style>
html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_m, href) => {
  const css = readAsset(href).replace(/<\/style/gi, '<\\/style')
  return `<style>\n${css}\n</style>`
})

// 预加载提示在单文件里没有意义
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')

// <script type="module" src="./assets/x.js"></script> → 内联模块脚本
html = html.replace(/<script[^>]*src="([^"]+)"[^>]*><\/script>/g, (_m, src) => {
  const js = readAsset(src).replace(/<\/script/gi, '<\\/script')
  return `<script type="module">\n${js}\n</script>`
})

// 内联图标：深紫底 + 品牌紫的开口圆环。上线后浏览器不再为 /favicon.ico 打一个 404
const ICON =
  'data:image/svg+xml,' +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
      "<rect width='32' height='32' rx='7' fill='#2b2650'/>" +
      "<path d='M22 11.8a6.6 6.6 0 1 0 0 8.4' fill='none' stroke='#8c75ff' stroke-width='3.2' stroke-linecap='round'/>" +
      '</svg>'
  )
if (!/rel="icon"/i.test(html)) {
  html = html.replace('</head>', `<link rel="icon" href="${ICON}"></head>`)
}

// 站点版：保留 public 里的实体图标 / 分享图引用，浏览器和抓取器各取所需
const htmlSite = html

// 单文件版：去掉只有上线站才有的外部图标引用。
// 离线双击时它们只会变成 404，图标已经由上面的 data URI 兜住。
const htmlSingle = html.replace(
  /<link[^>]*href="\.\/(?:favicon\.ico|favicon-32\.png|apple-touch-icon\.png|icon\.svg)"[^>]*>/g,
  ''
)

const out = join(dist, 'cmf-annotator.html')

// 版本戳：写在 <!doctype html> 后面，右键「查看网页源代码」或 curl 一眼就能确认线上跑的是哪一版。
// 版本号与构建时刻都取 vite 那一轮写下的 build-meta.json，保证和界面「关于」显示的一模一样。
const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'))
const pad = (n) => String(n).padStart(2, '0')
const d = new Date()
let meta = {
  version: pkg.version,
  builtAt: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
try {
  meta = JSON.parse(readFileSync(join(dist, '.build-meta.json'), 'utf8'))
} catch {
  /* 直接单独跑 inline.mjs 时没有 meta，退回当前时间 */
}
const withStamp = (html) => {
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0)
  const stamp = `<!-- CMF 标注工具 v${meta.version} · 构建 ${meta.builtAt} · ${kb} KB -->`
  return html.replace(/^(<!doctype html>)/i, `$1\n${stamp}`)
}
const kb = (Buffer.byteLength(htmlSingle) / 1024).toFixed(0)
const single = withStamp(htmlSingle)

writeFileSync(out, single, 'utf8')
console.log(`✔ 已生成单文件：${out}（${kb} KB，v${meta.version}）`)

// 仓库根也放一份：GitHub 上直接下载就能双击用，不必装 Node、不必自己构建。
// 这份是构建产物，别手改 —— 每次 build:single 都会覆盖
const rootCopy = resolve(process.cwd(), 'cmf-annotator.html')
writeFileSync(rootCopy, single, 'utf8')
console.log(`✔ 已同步仓库根的可下载版：${rootCopy}`)

// 上线目录：index.html 是内联版，另外把 public 里的站点文件一起带过去。
// 单文件 HTML 不需要这些也能跑，但分享图、图标、robots / sitemap、介绍页、404
// 必须是「独立可访问的文件」——搜索引擎和微信抓取器不会读 HTML 内联的 data URI。
const site = join(dist, 'site')
mkdirSync(site, { recursive: true })
const siteIndex = join(site, 'index.html')
writeFileSync(siteIndex, withStamp(htmlSite), 'utf8')

// vite 已经把 site/* 拷到 dist 根，这里只需要转存到上线目录
const SITE_FILES = [
  'favicon.ico',
  'favicon-32.png',
  'apple-touch-icon.png',
  'icon.svg',
  'og-cover.png',
  'robots.txt',
  'sitemap.xml',
  'about.html',
  '404.html'
]
const copied = []
for (const f of SITE_FILES) {
  const from = join(dist, f)
  if (!existsSync(from)) {
    console.warn(`⚠ 缺少 dist/${f}（public 里没有？上线后会 404）`)
    continue
  }
  copyFileSync(from, join(site, f))
  copied.push(f)
}
console.log(`✔ 已生成上线目录：${site}（index.html + ${copied.length} 个站点文件）`)

// 按版本归档一份：发新版前把旧的留在 releases/，需要回滚时直接拿对应版本上传
const rel = join(dist, 'releases')
mkdirSync(rel, { recursive: true })
const relFile = join(rel, `index-v${meta.version}.html`)
writeFileSync(relFile, html, 'utf8')
console.log(`✔ 已归档：${relFile}`)
