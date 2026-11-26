// 极简 PDF 生成：把一张 JPEG 作为 DCTDecode 图像嵌入单页 PDF（无需第三方库）。
// 页面尺寸使用 PDF point（1pt = 1/72 inch）。

export function buildPdfFromJpeg(
  jpegBase64: string,
  pxW: number,
  pxH: number,
  ptW: number,
  ptH: number
): Blob {
  const enc = new TextEncoder()
  const parts: BlobPart[] = []
  let offset = 0
  const offsets: number[] = []

  const push = (s: string) => {
    const b = enc.encode(s)
    parts.push(b as unknown as BlobPart)
    offset += b.length
  }
  const pushBytes = (b: Uint8Array) => {
    parts.push(b as unknown as BlobPart)
    offset += b.length
  }

  // 解码 base64 → 二进制
  const bin = atob(jpegBase64)
  const img = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i)

  push('%PDF-1.4\n')
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // 二进制标识注释

  offsets[1] = offset
  push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  offsets[2] = offset
  push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  const pw = ptW.toFixed(2)
  const ph = ptH.toFixed(2)
  offsets[3] = offset
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`
  )

  offsets[4] = offset
  push(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`
  )
  pushBytes(img)
  push('\nendstream\nendobj\n')

  const content = `q\n${pw} 0 0 ${ph} 0 0 cm\n/Im0 Do\nQ\n`
  offsets[5] = offset
  push(`5 0 obj\n<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)

  const xrefStart = offset
  push('xref\n0 6\n0000000000 65535 f \n')
  for (let i = 1; i <= 5; i++) {
    push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  return new Blob(parts, { type: 'application/pdf' })
}
