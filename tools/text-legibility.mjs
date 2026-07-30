// How small can text be before no amount of upscaling brings it back?
//
// Renders the same words at a range of x-heights, degrades each the way a real
// WebP does (downscale + block-quantise), then restores with (a) Lanczos+sharpen
// and (b) the SPAN super-resolution model, and writes a PNG contact sheet plus
// a stroke-separation score.
//
//   node tools/text-legibility.mjs <model.onnx> out.png

import fs from 'node:fs'
import zlib from 'node:zlib'
import { loadGraph, runGraph } from './span-reference.mjs'
import { lanczos3Resize, unsharpMaskInPlace } from '../src/lib/resample.ts'

// ---- a 5x7 bitmap font, enough for a readable sentence ----
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  3: ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
}

/** Render text so the glyphs are exactly `xh` pixels tall, supersampled. */
function renderText(text, xh, pad = 4) {
  const SS = 8
  const scale = xh / 7
  const gw = Math.round(5 * scale) + Math.max(1, Math.round(scale))
  const w = pad * 2 + gw * text.length
  const h = pad * 2 + xh
  const acc = new Float32Array(w * h)
  for (let i = 0; i < text.length; i++) {
    const g = FONT[text[i]] || FONT[' ']
    for (let sy = 0; sy < xh * SS; sy++) {
      for (let sx = 0; sx < Math.round(5 * scale) * SS; sx++) {
        const fy = Math.min(6, Math.floor(sy / SS / scale))
        const fx = Math.min(4, Math.floor(sx / SS / scale))
        if (g[fy][fx] === '1') {
          const px = pad + i * gw + Math.floor(sx / SS)
          const py = pad + Math.floor(sy / SS)
          if (px < w && py < h) acc[py * w + px] += 1 / (SS * SS)
        }
      }
    }
  }
  const d = new Uint8ClampedArray(w * h * 4)
  for (let p = 0; p < w * h; p++) {
    const ink = Math.min(1, acc[p])
    const v = 245 * (1 - ink) + 20 * ink
    d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v
    d[p * 4 + 3] = 255
  }
  return { data: d, w, h }
}

function down2(img) {
  const w = img.w >> 1
  const h = img.h >> 1
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++)
        d[(y * w + x) * 4 + c] =
          (img.data[(2 * y * img.w + 2 * x) * 4 + c] +
            img.data[(2 * y * img.w + 2 * x + 1) * 4 + c] +
            img.data[((2 * y + 1) * img.w + 2 * x) * 4 + c] +
            img.data[((2 * y + 1) * img.w + 2 * x + 1) * 4 + c]) /
          4
  return { data: d, w, h }
}

/** Cheap stand-in for lossy compression: quantise 4x4 blocks toward their mean. */
function blockify(img, amount) {
  const d = Uint8ClampedArray.from(img.data)
  for (let by = 0; by + 4 <= img.h; by += 4)
    for (let bx = 0; bx + 4 <= img.w; bx += 4)
      for (let c = 0; c < 3; c++) {
        let m = 0
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) m += img.data[((by + y) * img.w + bx + x) * 4 + c]
        m /= 16
        for (let y = 0; y < 4; y++)
          for (let x = 0; x < 4; x++) {
            const i = ((by + y) * img.w + bx + x) * 4 + c
            d[i] = img.data[i] * (1 - amount) + m * amount
          }
      }
  return { data: d, w: img.w, h: img.h }
}

async function spanUp(g, img) {
  const chw = new Float32Array(3 * img.w * img.h)
  const n = img.w * img.h
  for (let p = 0; p < n; p++) {
    chw[p] = img.data[p * 4] / 255
    chw[n + p] = img.data[p * 4 + 1] / 255
    chw[2 * n + p] = img.data[p * 4 + 2] / 255
  }
  const out = runGraph(g, { c: 3, h: img.h, w: img.w, data: chw })
  const on = out.h * out.w
  const d = new Uint8ClampedArray(on * 4)
  for (let p = 0; p < on; p++) {
    d[p * 4] = out.data[p] * 255
    d[p * 4 + 1] = out.data[on + p] * 255
    d[p * 4 + 2] = out.data[2 * on + p] * 255
    d[p * 4 + 3] = 255
  }
  return { data: d, w: out.w, h: out.h }
}

function lanczosUp(img) {
  const d = lanczos3Resize(img.data, img.w, img.h, img.w * 2, img.h * 2)
  unsharpMaskInPlace(d, img.w * 2, img.h * 2, 1.2)
  return { data: d, w: img.w * 2, h: img.h * 2 }
}

/**
 * Legibility proxy: how cleanly ink separates from paper. Readable text is
 * bimodal — dark strokes, light background, few mid-greys. Mush is unimodal.
 */
function separation(img) {
  const v = []
  for (let p = 0; p < img.w * img.h; p++) v.push(img.data[p * 4])
  v.sort((a, b) => a - b)
  const lo = v[Math.floor(v.length * 0.05)]
  const hi = v[Math.floor(v.length * 0.95)]
  const mid = (lo + hi) / 2
  let between = 0
  for (const x of v) if (Math.abs(x - mid) < (hi - lo) * 0.25) between++
  return { contrast: hi - lo, muddy: between / v.length }
}

// ---- minimal PNG writer ----
function writePng(path, img) {
  const raw = Buffer.alloc((img.w * 4 + 1) * img.h)
  let o = 0
  for (let y = 0; y < img.h; y++) {
    raw[o++] = 0
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * 4
      raw[o++] = img.data[i]
      raw[o++] = img.data[i + 1]
      raw[o++] = img.data[i + 2]
      raw[o++] = 255
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(img.w, 0)
  ihdr.writeUInt32BE(img.h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  fs.writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}
let CRC_T = null
function crc32(buf) {
  if (!CRC_T) {
    CRC_T = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_T[n] = c
    }
  }
  let c = 0xffffffff
  for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

function blit(dst, src, ox, oy, zoom) {
  for (let y = 0; y < src.h * zoom; y++)
    for (let x = 0; x < src.w * zoom; x++) {
      const s = (Math.floor(y / zoom) * src.w + Math.floor(x / zoom)) * 4
      const px = ox + x
      const py = oy + y
      if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue
      const d = (py * dst.w + px) * 4
      dst.data[d] = src.data[s]
      dst.data[d + 1] = src.data[s + 1]
      dst.data[d + 2] = src.data[s + 2]
      dst.data[d + 3] = 255
    }
}

// ---- main ----
const model = process.argv[2]
const outPng = process.argv[3] || 'legibility.png'
const g = loadGraph(model)
const TEXT = 'INVOICE 4291-8837'
const HEIGHTS = [4, 6, 8, 12, 16]

const panels = []
console.log('x-height  what survives in the file            lanczos+sharp      SPAN')
for (const xh of HEIGHTS) {
  const sharp = renderText(TEXT, xh * 2)
  const small = blockify(down2(sharp), 0.55) // this is what your webp actually holds
  const lan = lanczosUp(small)
  const span = await spanUp(g, small)
  const sSmall = separation(small)
  const sLan = separation(lan)
  const sSpan = separation(span)
  console.log(
    `${String(xh).padStart(5)} px   contrast ${sSmall.contrast.toFixed(0).padStart(3)} muddy ${(
      sSmall.muddy * 100
    )
      .toFixed(0)
      .padStart(3)}%      ` +
      `contrast ${sLan.contrast.toFixed(0).padStart(3)} muddy ${(sLan.muddy * 100).toFixed(0).padStart(3)}%   ` +
      `contrast ${sSpan.contrast.toFixed(0).padStart(3)} muddy ${(sSpan.muddy * 100).toFixed(0).padStart(3)}%`,
  )
  panels.push({ xh, small, lan, span })
}

// contact sheet, everything drawn at the same physical scale
const ZOOM = 3
const rowH = Math.max(...panels.map((p) => p.lan.h)) * ZOOM + 26
const colW = Math.max(...panels.map((p) => p.lan.w)) * ZOOM + 16
const sheet = {
  w: colW + 20,
  h: rowH * panels.length * 3 + 40,
  data: new Uint8ClampedArray((colW + 20) * (rowH * panels.length * 3 + 40) * 4).fill(255),
}
let y = 10
for (const p of panels) {
  blit(sheet, p.small, 10, y, ZOOM * 2)
  y += rowH
  blit(sheet, p.lan, 10, y, ZOOM)
  y += rowH
  blit(sheet, p.span, 10, y, ZOOM)
  y += rowH + 8
}
writePng(outPng, sheet)
console.log(`\nwrote ${outPng}  (rows repeat per x-height: degraded / lanczos+sharp / SPAN)`)
