// Model shootout: which restoration method actually makes small text READABLE?
//
// Scores by CHARACTER ACCURACY rather than PSNR/SSIM. Because the text is
// rendered from a known font, each restored character slot can be matched
// against every glyph template and the winner compared to ground truth. That is
// the same thing TextZoom measures (word accuracy) and it is the only metric
// that answers the actual question — PSNR can improve while the digits stay
// wrong, and a GAN model can score badly on PSNR while being more readable.
//
//   node tools/sr-shootout.mjs [model.onnx ...]

// Inference runs through onnxruntime-node so ANY architecture can be scored,
// not just the ops our hand-written CPU reference implements. ORT is a dev
// dependency and never ships.
import ort from 'onnxruntime-node'
import { FONT, renderTextExport as renderText, down2, blockify } from './text-legibility-lib.mjs'
import { lanczos3Resize, unsharpMaskInPlace } from '../src/lib/resample.ts'
import { deconvolve } from '../src/lib/deconvolve.ts'

const CHARS = Object.keys(FONT).filter((c) => c !== ' ')
const TEXT = 'INVOICE 4291-8837'

function addNoise(img, sigma, seed = 7) {
  let s = seed >>> 0
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5)
  const d = Uint8ClampedArray.from(img.data)
  for (let i = 0; i < d.length; i += 4) {
    const n = rnd() * 2 * sigma
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  return { data: d, w: img.w, h: img.h }
}

/** Geometry must match renderText exactly so slots line up. */
function geom(xh, len, pad = 4) {
  const scale = xh / 7
  const gw = Math.round(5 * scale) + Math.max(1, Math.round(scale))
  return { pad, gw, w: pad * 2 + gw * len, h: pad * 2 + xh }
}

/**
 * Read back the text by matching each slot against every glyph template,
 * after normalising for brightness/contrast so methods that shift levels are
 * not unfairly penalised.
 */
function readBack(img, text, xh, pad) {
  const g = geom(xh, text.length, pad)
  let correct = 0
  let total = 0
  const got = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') {
      got.push(' ')
      continue
    }
    total++
    let best = null
    let bestScore = Infinity
    for (const c of CHARS) {
      const tpl = renderText(c, xh, pad)
      const tg = geom(xh, 1, pad)
      // normalised SSD over the glyph box
      let ssd = 0
      let n = 0
      let ma = 0
      let mb = 0
      const vals = []
      for (let y = 0; y < xh; y++) {
        for (let x = 0; x < g.gw; x++) {
          const ax = g.pad + i * g.gw + x
          const ay = g.pad + y
          const bx = tg.pad + x
          const by = tg.pad + y
          if (ax >= img.w || ay >= img.h || bx >= tpl.w || by >= tpl.h) continue
          const a = img.data[(ay * img.w + ax) * 4]
          const b = tpl.data[(by * tpl.w + bx) * 4]
          vals.push([a, b])
          ma += a
          mb += b
          n++
        }
      }
      if (!n) continue
      ma /= n
      mb /= n
      let va = 0
      let vb = 0
      for (const [a, b] of vals) {
        va += (a - ma) ** 2
        vb += (b - mb) ** 2
      }
      va = Math.sqrt(va / n) || 1
      vb = Math.sqrt(vb / n) || 1
      for (const [a, b] of vals) ssd += (((a - ma) / va) - ((b - mb) / vb)) ** 2
      ssd /= n
      if (ssd < bestScore) {
        bestScore = ssd
        best = c
      }
    }
    got.push(best ?? '?')
    if (best === text[i]) correct++
  }
  return { correct, total, got: got.join('') }
}

// ---- restoration methods ----

function lanczosSharp(img) {
  const d = lanczos3Resize(img.data, img.w, img.h, img.w * 2, img.h * 2)
  unsharpMaskInPlace(d, img.w * 2, img.h * 2, 1.5)
  return { data: d, w: img.w * 2, h: img.h * 2 }
}

function deconvThenUp(img) {
  const r = deconvolve(img.data, img.w, img.h, { kind: 'gaussian', radius: 1.1, strength: 0.6 })
  const d = lanczos3Resize(r.data, img.w, img.h, img.w * 2, img.h * 2)
  unsharpMaskInPlace(d, img.w * 2, img.h * 2, 1.2)
  return { data: d, w: img.w * 2, h: img.h * 2 }
}

/** Some exports (RealPLKSR) have a FIXED input size; pad up to it and crop back. */
function padTo(img, side) {
  if (img.w === side && img.h === side) return { img, ox: 0, oy: 0 }
  const d = new Uint8ClampedArray(side * side * 4)
  // edge-replicate rather than zero-fill: a black border would make the model
  // hallucinate a hard edge right next to the text.
  for (let y = 0; y < side; y++) {
    const sy = Math.min(img.h - 1, y)
    for (let x = 0; x < side; x++) {
      const sx = Math.min(img.w - 1, x)
      const s = (sy * img.w + sx) * 4
      const t = (y * side + x) * 4
      d[t] = img.data[s]
      d[t + 1] = img.data[s + 1]
      d[t + 2] = img.data[s + 2]
      d[t + 3] = 255
    }
  }
  return { img: { data: d, w: side, h: side }, ox: 0, oy: 0 }
}

function cropTo(img, w, h) {
  if (img.w === w && img.h === h) return img
  const d = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const s = (Math.min(img.h - 1, y) * img.w + Math.min(img.w - 1, x)) * 4
      const t = (y * w + x) * 4
      d[t] = img.data[s]
      d[t + 1] = img.data[s + 1]
      d[t + 2] = img.data[s + 2]
      d[t + 3] = 255
    }
  return { data: d, w, h }
}

async function modelUp(session, img, fixedSide) {
  const orig = img
  if (fixedSide) img = padTo(img, fixedSide).img
  const n = img.w * img.h
  const chw = new Float32Array(3 * n)
  for (let p = 0; p < n; p++) {
    chw[p] = img.data[p * 4] / 255
    chw[n + p] = img.data[p * 4 + 1] / 255
    chw[2 * n + p] = img.data[p * 4 + 2] / 255
  }
  const feeds = {}
  feeds[session.inputNames[0]] = new ort.Tensor('float32', chw, [1, 3, img.h, img.w])
  void orig
  const res = await session.run(feeds)
  const o = res[session.outputNames[0]]
  const [, , oh, ow] = o.dims
  const on = oh * ow
  const d = new Uint8ClampedArray(on * 4)
  for (let p = 0; p < on; p++) {
    d[p * 4] = o.data[p] * 255
    d[p * 4 + 1] = o.data[on + p] * 255
    d[p * 4 + 2] = o.data[2 * on + p] * 255
    d[p * 4 + 3] = 255
  }
  const scale = Math.round(ow / img.w)
  const out = { data: d, w: ow, h: oh }
  return fixedSide ? cropTo(out, orig.w * scale, orig.h * scale) : out
}

// ---- main ----

const modelPaths = process.argv.slice(2).filter((a) => a.endsWith('.onnx'))
const models = []
for (const p of modelPaths) {
  try {
    const session = await ort.InferenceSession.create(p)
    const short = p.split(/[\\/]/).pop().replace('.onnx', '').slice(0, 22)
    // Probe for a fixed input size — several published exports refuse anything
    // but the shape they were traced at, and report it in the error text.
    let fixedSide = 0
    try {
      const f = {}
      f[session.inputNames[0]] = new ort.Tensor('float32', new Float32Array(3 * 32 * 32), [1, 3, 32, 32])
      await session.run(f)
    } catch (e) {
      const m = String(e.message).match(/Expected:\s*(\d+)/)
      if (m) fixedSide = Number(m[1])
    }
    models.push({ name: short, session, fixedSide })
    console.log(`loaded ${short}${fixedSide ? `  (fixed ${fixedSide}x${fixedSide} input)` : ''}`)
  } catch (e) {
    console.log(`SKIP ${p.split(/[\\/]/).pop()}: ${String(e.message).slice(0, 140)}`)
  }
}
console.log()

const HEIGHTS = [4, 6, 8, 12]
const NOISE = 2

const methods = [
  { name: 'degraded (no restore)', fn: (img) => img, scale1: true },
  { name: 'lanczos + sharpen', fn: lanczosSharp },
  { name: 'deconvolve + lanczos', fn: deconvThenUp },
  ...models.map((m) => ({ name: m.name, fn: (img) => modelUp(m.session, img, m.fixedSide) })),
]

console.log(`character accuracy reading back "${TEXT}"  (noise sigma ${NOISE}/255)\n`)
const head = ['method'.padEnd(24), ...HEIGHTS.map((h) => `${h}px`.padStart(7))].join('')
console.log(head)
console.log('-'.repeat(head.length))

for (const m of methods) {
  const cells = []
  for (const xh of HEIGHTS) {
    const sharp = renderText(TEXT, xh * 2)
    const degraded = addNoise(blockify(down2(sharp), 0.5), NOISE)
    let restored
    try {
      restored = await m.fn(degraded)
    } catch (e) {
      cells.push('  ERR')
      if (!globalThis.__shown) { globalThis.__shown = 1; console.log('   ('+m.name+' error: '+String(e.message).slice(0,150)+')') }
      continue
    }
    // Normalise every method's output to the SHARP reference size before
    // matching. Methods upscale by different factors (2x, 4x, 1x), and glyph
    // spacing does not scale linearly through integer rounding, so comparing at
    // native scale silently misaligns the slots and makes good models look bad.
    const norm =
      restored.w === sharp.w && restored.h === sharp.h
        ? restored
        : {
            data: lanczos3Resize(restored.data, restored.w, restored.h, sharp.w, sharp.h),
            w: sharp.w,
            h: sharp.h,
          }
    const r = readBack(norm, TEXT, xh * 2, 4)
    cells.push(`${Math.round((r.correct / r.total) * 100)}%`.padStart(7))
  }
  console.log(m.name.padEnd(24) + cells.join(''))
}

console.log('\n(100% = every character read back correctly; ~7% = chance)')
