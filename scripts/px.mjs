// 极简 PNG 采样器：读 8bit RGB/RGBA 截图，输出指定坐标的颜色
import fs from 'node:fs'
import zlib from 'node:zlib'

function decode(file) {
  const buf = fs.readFileSync(file)
  let p = 8
  let w = 0, h = 0, bd = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bd = data[8]; ct = data[9]
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (bd !== 8) throw new Error('bitDepth ' + bd)
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : null
  if (!ch) throw new Error('colorType ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0
      const b = prev[x]
      const c = x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pp = a + b - c
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { w, h, ch, out }
}

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
const lum = (r, g, b) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

const file = process.argv[2]
const pts = process.argv.slice(3)
const img = decode(file)
console.log(`${file}  ${img.w}x${img.h} ch=${img.ch}`)
for (const pt of pts) {
  const [x, y] = pt.split(',').map(Number)
  const i = (y * img.w + x) * img.ch
  const r = img.out[i], g = img.out[i + 1], b = img.out[i + 2]
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const sat = max === 0 ? 0 : ((max - min) / max) * 100
  console.log(`(${x},${y}) ${hex(r, g, b)}  rgb(${r},${g},${b})  L=${lum(r, g, b).toFixed(3)}  sat=${sat.toFixed(0)}%  hueish=${max === min ? '-' : max === r ? 'R' : max === g ? 'G' : 'B'}`)
}
