import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 版本号只有一个来源：package.json。
// 构建时注入成常量，界面 / 产物注释 / 归档文件名全部读它，避免「改了三处漏一处」。
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}
const pad = (n: number) => String(n).padStart(2, '0')
const d = new Date()
const BUILD_TIME = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'build-meta',
      // 构建结束把「版本 + 构建时刻」落盘，给 scripts/inline.mjs 复用：
      // 否则两个进程各取一次时间，产物注释和界面里的时间会差一分钟，看着像两个版本
      closeBundle() {
        const dir = new URL('./dist/', import.meta.url)
        mkdirSync(dir, { recursive: true })
        writeFileSync(
          new URL('.build-meta.json', dir),
          JSON.stringify({ version: pkg.version, builtAt: BUILD_TIME })
        )
      }
    }
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME)
  },
  // 相对路径：既能部署到域名根目录，也能丢进任意子目录 / GitHub Pages 而不 404
  base: './',
  // 站点附属文件（about / 404 / robots / sitemap / 分享图 / 图标）统一放在 site/，
  // 不和 src、assets 混在一起；构建时原样拷到 dist 根，再由 inline.mjs 转存进 dist/site
  publicDir: 'site',
  build: {
    // 单文件产物（dist/cmf-annotator.html）不允许外挂资源，否则离线双击打开时图片是裂的：
    // 小于这个体积的图片 / 字体会直接内联成 base64（当前只有公众号二维码一张，9KB）
    assetsInlineLimit: 120 * 1024
  },
  server: { port: 5173, host: true }
})
