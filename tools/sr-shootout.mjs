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

import { loadGraph, runGraph } from './span-reference.mjs'
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
function readBack(img, text, xh) {
  const g = geom(xh, text.length)
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
      const tpl = renderText(c, xh)
      const tg = geom(xh, 1)
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

function modelUp(g, img) {
  const n = img.w * img.h
  const chw = new Float32Array(3 * n)
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

// ---- main ----

const modelPaths = process.argv.slice(2).filter((a) => a.endsWith('.onnx'))
const models = []
for (const p of modelPaths) {
  try {
    models.push({ name: p.split(/[\\/]/).pop().replace('.onnx', ''), g: loadGraph(p) })
    console.log(`loaded ${p}`)
  } catch (e) {
    console.log(`SKIP ${p}: ${e.message}`)
  }
}
console.log()

const HEIGHTS = [4, 6, 8, 12]
const NOISE = 2

const methods = [
  { name: 'degraded (no restore)', fn: (img) => img, scale1: true },
  { name: 'lanczos + sharpen', fn: lanczosSharp },
  { name: 'deconvolve + lanczos', fn: deconvThenUp },
  ...models.map((m) => ({ name: m.name, fn: (img) => modelUp(m.g, img) })),
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
      restored = m.fn(degraded)
    } catch (e) {
      cells.push('  ERR')
      continue
    }
    // read back at whatever scale the method produced
    const effXh = m.scale1 ? xh : xh * 2
    const r = readBack(restored, TEXT, effXh)
    cells.push(`${Math.round((r.correct / r.total) * 100)}%`.padStart(7))
  }
  console.log(m.name.padEnd(24) + cells.join(''))
}

console.log('\n(100% = every character read back correctly; ~7% = chance)')
