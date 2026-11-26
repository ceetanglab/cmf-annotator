// 裁剪 + 最近邻放大：用来把自己截图的局部放到足够大再看
// 用法：node scripts/crop.mjs in.png out.png x0 y0 x1 y1 [scale]
import fs from 'node:fs'
import zlib from 'node:zlib'

function decode(file) {
  const buf = fs.readFileSync(file)
  let p = 8, w = 0, h = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p)
    const t = buf.toString('ascii', p + 4, p + 8)
    const d = buf.subarray(p + 8, p + 8 + len)
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9] }
    else if (t === 'IDAT') idat.push(d)
    else if (t === 'IEND') break
    p += 12 + len
  }
  const ch = ct === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = w * ch
  const out = Buffer.alloc(h * stride)
  let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    const cur = Buffer.alloc(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? cur[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0
      let v = line[x]
      if (ft === 1) v += a
      else if (ft === 2) v += b
      else if (ft === 3) v += (a + b) >> 1
      else if (ft === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[x] = v & 255
    }
    cur.copy(out, y * stride)
    prev = cur
  }
  return { w, h, ch, out }
}

function encode(w, h, ch, px) {
  const stride = w * ch
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    px.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const chunks = []
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crcTable = []
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0 }
    let crc = 0xffffffff
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    chunks.push(len, body, c)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2
  chunk('IHDR', ihdr)
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 }))
  chunk('IEND', Buffer.alloc(0))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks])
}

const [inFile, outFile, x0s, y0s, x1s, y1s, ss] = process.argv.slice(2)
const img = decode(inFile)
const [x0, y0, x1, y1, s] = [x0s, y0s, x1s, y1s, ss || '2'].map(Number)
const cw = x1 - x0, chh = y1 - y0
const W = cw * s, H = chh * s
const out = Buffer.alloc(W * H * img.ch)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sx = x0 + Math.floor(x / s), sy = y0 + Math.floor(y / s)
    const si = (sy * img.w + sx) * img.ch, di = (y * W + x) * img.ch
    for (let c = 0; c < img.ch; c++) out[di + c] = img.out[si + c]
  }
}
fs.writeFileSync(outFile, encode(W, H, img.ch, out))
console.log(`cropped ${cw}x${chh} ×${s} → ${W}x${H}  ${outFile}`)
