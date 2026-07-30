// Checks for the high-quality enlarge path (src/lib/resample.ts).
//
// The claim this guards: Lanczos3 + unsharp produces a measurably sharper and
// more faithful enlargement than plain bilinear. Method mirrors standard
// super-resolution evaluation — take a sharp reference, shrink it, enlarge it
// back, and score the reconstruction against the reference.
//
//   node tests/resample.check.mjs

import { lanczos3Resize, unsharpMaskInPlace, flattenToWhiteInPlace } from '../src/lib/resample.ts'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg)
  else {
    console.error('  ✗', msg)
    failures++
  }
}

const idx = (x, y, w) => (y * w + x) * 4

/** Sharp reference: black text-like bars and a checker, on white. */
function reference(w, h) {
  const d = new Uint8ClampedArray(w * h * 4).fill(255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bar = x % 8 < 3 && y > h * 0.2 && y < h * 0.5
      const checker = y > h * 0.6 && (((x >> 2) + (y >> 2)) & 1) === 0
      if (bar || checker) {
        const i = idx(x, y, w)
        d[i] = d[i + 1] = d[i + 2] = 0
      }
    }
  }
  return d
}

function bilinear(src, sw, sh, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5))
    const y0 = Math.floor(sy)
    const y1 = Math.min(sh - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5))
      const x0 = Math.floor(sx)
      const x1 = Math.min(sw - 1, x0 + 1)
      const fx = sx - x0
      for (let c = 0; c < 4; c++) {
        const a = src[idx(x0, y0, sw) + c] * (1 - fx) + src[idx(x1, y0, sw) + c] * fx
        const b = src[idx(x0, y1, sw) + c] * (1 - fx) + src[idx(x1, y1, sw) + c] * fx
        out[idx(x, y, dw) + c] = a * (1 - fy) + b * fy
      }
    }
  }
  return out
}

const luma = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]

function edgeVariance(d, w, h) {
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const v =
        4 * luma(d, idx(x, y, w)) -
        luma(d, idx(x - 1, y, w)) -
        luma(d, idx(x + 1, y, w)) -
        luma(d, idx(x, y - 1, w)) -
        luma(d, idx(x, y + 1, w))
      sum += v
      sumSq += v * v
      n++
    }
  }
  return sumSq / n - (sum / n) ** 2
}

function psnr(a, b) {
  let se = 0
  let n = 0
  for (let i = 0; i < a.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const d = a[i + c] - b[i + c]
      se += d * d
      n++
    }
  }
  return 10 * Math.log10(65025 / (se / n))
}

function testQuality() {
  console.log('Enlarge quality — Lanczos3 vs bilinear:')
  const W = 320
  const H = 240
  const ref = reference(W, H)
  // Shrink to a quarter, then enlarge back to the original size.
  const small = lanczos3Resize(ref, W, H, W / 4, H / 4)
  const up = lanczos3Resize(small, W / 4, H / 4, W, H)
  const bil = bilinear(small, W / 4, H / 4, W, H)

  const pLan = psnr(up, ref)
  const pBil = psnr(bil, ref)
  const eLan = edgeVariance(up, W, H)
  const eBil = edgeVariance(bil, W, H)
  assert(pLan > pBil, `lanczos is more faithful (PSNR ${pLan.toFixed(2)} > ${pBil.toFixed(2)})`)
  assert(eLan > eBil, `lanczos holds more edge contrast (${eLan.toFixed(0)} > ${eBil.toFixed(0)})`)

  const sharpened = Uint8ClampedArray.from(up)
  unsharpMaskInPlace(sharpened, W, H, 1.2)
  const eSharp = edgeVariance(sharpened, W, H)
  assert(eSharp > eLan, `unsharp adds edge contrast (${eSharp.toFixed(0)} > ${eLan.toFixed(0)})`)
  assert(
    edgeVariance(ref, W, H) > eSharp,
    'the sharp original still beats every enlargement (no detail is invented)',
  )
}

function testGeometryAndAlpha() {
  console.log('Geometry and alpha:')
  const w = 16
  const h = 10
  const src = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < src.length; i += 4) {
    src[i] = 200
    src[i + 1] = 100
    src[i + 2] = 50
    src[i + 3] = 255
  }
  const out = lanczos3Resize(src, w, h, 40, 25)
  assert(out.length === 40 * 25 * 4, 'output buffer matches requested dimensions')
  let flat = true
  for (let i = 0; i < out.length; i += 4) {
    if (Math.abs(out[i] - 200) > 1 || out[i + 3] !== 255) flat = false
  }
  assert(flat, 'a flat opaque colour enlarges without colour shift or alpha loss')

  const clear = new Uint8ClampedArray(w * h * 4) // fully transparent
  const clearOut = lanczos3Resize(clear, w, h, 32, 20)
  assert(
    clearOut.every((v) => v === 0),
    'fully transparent input stays transparent (no dark halo)',
  )
}

function testHelpers() {
  console.log('Sharpen and flatten helpers:')
  const w = 8
  const h = 8
  const flatField = new Uint8ClampedArray(w * h * 4).fill(128)
  for (let i = 3; i < flatField.length; i += 4) flatField[i] = 255
  const before = Uint8ClampedArray.from(flatField)
  unsharpMaskInPlace(flatField, w, h, 1.5)
  assert(
    flatField.every((v, i) => v === before[i]),
    'threshold leaves flat areas untouched (does not amplify compression noise)',
  )

  const px = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255])
  flattenToWhiteInPlace(px)
  assert(px[0] === 255 && px[3] === 255, 'transparent pixels flatten to white for JPEG')
  assert(px[4] === 10 && px[7] === 255, 'opaque pixels are left alone')
}

testQuality()
testGeometryAndAlpha()
testHelpers()

if (failures) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll resample checks passed ✓')
