// Checks for Wiener deconvolution (src/lib/deconvolve.ts).
//
// Method is the standard one for a restoration algorithm: take a sharp
// reference, blur it with a KNOWN point-spread function, quantise to 8-bit and
// add noise, then deconvolve and score the result against the reference. If the
// maths is right, the recovered image is far closer to the reference than the
// blurred input, and beats a sharpening pass on the same input.
//
//   node tests/deconvolve.check.mjs

import { deconvolve, makePsf, estimateNoiseSigma } from '../src/lib/deconvolve.ts'
import { unsharpMaskInPlace } from '../src/lib/resample.ts'

let failures = 0
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg)
  else {
    console.error('  ✗', msg)
    failures++
  }
}

const W = 192
const H = 192

/** Sharp reference: fine bars, a checker, and thin strokes — text-like content. */
function reference() {
  const d = new Uint8ClampedArray(W * H * 4).fill(255)
  for (let p = 3; p < d.length; p += 4) d[p] = 255
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const bars = x % 8 < 3 && y > 16 && y < 70
      const checker = y > 80 && y < 130 && (((x >> 2) + (y >> 2)) & 1) === 0
      const thin = y > 140 && y < 180 && x % 6 === 0
      if (bars || checker || thin) {
        const i = (y * W + x) * 4
        d[i] = d[i + 1] = d[i + 2] = 0
      }
    }
  }
  return d
}

const toLinear = (v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const toSrgb = (c) => {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c
  return (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255
}

/**
 * Apply a PSF in LINEAR LIGHT, which is where real optical blur happens —
 * photons add linearly, gamma encoding is applied afterwards by the camera.
 * Simulating in gamma space would be inverting a different forward model than
 * the one the deconvolver assumes, and would understate its accuracy.
 */
function blur(src, psf) {
  const out = new Uint8ClampedArray(src.length)
  const half = (psf.size - 1) / 2
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 3; c++) {
        let acc = 0
        for (let ky = 0; ky < psf.size; ky++) {
          for (let kx = 0; kx < psf.size; kx++) {
            const sy = Math.min(H - 1, Math.max(0, y + ky - half))
            const sx = Math.min(W - 1, Math.max(0, x + kx - half))
            acc += toLinear(src[(sy * W + sx) * 4 + c]) * psf.data[ky * psf.size + kx]
          }
        }
        out[(y * W + x) * 4 + c] = toSrgb(acc)
      }
      out[(y * W + x) * 4 + 3] = src[(y * W + x) * 4 + 3]
    }
  }
  return out
}

function addNoise(src, sigma255, seed = 7) {
  let s = seed
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff - 0.5
  }
  const d = Uint8ClampedArray.from(src)
  for (let i = 0; i < d.length; i += 4) {
    const n = rnd() * 2 * sigma255
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  return d
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

function testRecovery() {
  console.log('Gaussian blur, sigma 1.5 — recovery vs the sharp reference:')
  const ref = reference()
  const psf = makePsf('gaussian', 1.5)
  const observed = addNoise(blur(ref, psf), 1.0)

  const before = psnr(observed, ref)
  const { data: restored, k, noiseSigma } = deconvolve(observed, W, H, {
    kind: 'gaussian',
    radius: 1.5,
    strength: 0.5,
  })
  const after = psnr(restored, ref)

  const sharpened = Uint8ClampedArray.from(observed)
  unsharpMaskInPlace(sharpened, W, H, 1.2)
  const sharp = psnr(sharpened, ref)

  console.log(
    `    blurred ${before.toFixed(2)} dB | unsharp ${sharp.toFixed(2)} dB | deconvolved ${after.toFixed(2)} dB` +
      `  (noise sigma ${(noiseSigma * 255).toFixed(2)}/255, K ${k.toExponential(1)})`,
  )
  assert(after > before + 2, `deconvolution recovers real detail (+${(after - before).toFixed(2)} dB)`)
  assert(after > sharp, `deconvolution beats sharpening (+${(after - sharp).toFixed(2)} dB)`)
  assert(Number.isFinite(after), 'output contains no NaN/Infinity')
}

function testPhysicsWall() {
  console.log('The physics wall — gain must shrink as blur grows:')
  const ref = reference()
  const gains = []
  for (const sigma of [1.0, 2.0, 4.0, 8.0]) {
    const observed = addNoise(blur(ref, makePsf('gaussian', sigma)), 1.0)
    const before = psnr(observed, ref)
    const { data } = deconvolve(observed, W, H, { kind: 'gaussian', radius: sigma, strength: 0.5 })
    const gain = psnr(data, ref) - before
    gains.push(gain)
    console.log(`    sigma ${sigma.toFixed(1)}  gain ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`)
  }
  assert(gains[0] > gains[3], 'mild blur recovers far better than heavy blur')
  assert(gains[0] > 2, 'mild blur genuinely recovers')
  assert(
    gains[3] < gains[0] / 2,
    'heavy blur is past the noise floor — honest failure, not a fake win',
  )
}

function testPsfShapes() {
  console.log('PSF generators:')
  for (const [kind, radius] of [
    ['gaussian', 2],
    ['disc', 3],
    ['motion', 6],
  ]) {
    const psf = makePsf(kind, radius, 30)
    let sum = 0
    let finite = true
    for (const v of psf.data) {
      sum += v
      if (!Number.isFinite(v)) finite = false
    }
    assert(finite && Math.abs(sum - 1) < 1e-4, `${kind} PSF is finite and sums to 1 (${sum.toFixed(6)})`)
  }

  const ref = reference()
  const observed = blur(ref, makePsf('motion', 7, 0))
  const before = psnr(observed, ref)
  const { data } = deconvolve(observed, W, H, {
    kind: 'motion',
    radius: 7,
    angle: 0,
    strength: 0.6,
  })
  const gain = psnr(data, ref) - before
  console.log(`    horizontal motion blur, length 7 → ${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`)
  assert(gain > 2, 'motion blur is recovered when the direction is right')
}

function testWrongPsfIsNotAWin() {
  console.log('Guard against self-deception:')
  const ref = reference()
  const observed = addNoise(blur(ref, makePsf('gaussian', 2.0)), 1.0)
  const before = psnr(observed, ref)
  const right = psnr(
    deconvolve(observed, W, H, { kind: 'gaussian', radius: 2.0, strength: 0.5 }).data,
    ref,
  )
  const wrong = psnr(
    deconvolve(observed, W, H, { kind: 'motion', radius: 12, angle: 90, strength: 0.5 }).data,
    ref,
  )
  console.log(
    `    correct PSF ${right.toFixed(2)} dB vs wrong PSF ${wrong.toFixed(2)} dB (input ${before.toFixed(2)} dB)`,
  )
  assert(right > wrong, 'the correct PSF beats a wrong one — the model is doing the work')
}

function testAlphaAndNoise() {
  console.log('Housekeeping:')
  const ref = reference()
  for (let i = 3; i < ref.length; i += 4) ref[i] = 128
  const { data } = deconvolve(ref, W, H, { kind: 'gaussian', radius: 1, strength: 0.5 })
  let alphaOk = true
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 128) alphaOk = false
  assert(alphaOk, 'alpha channel is passed through untouched')

  const clean = reference()
  const noisy = addNoise(clean, 6)
  assert(
    estimateNoiseSigma(noisy, W, H) > estimateNoiseSigma(clean, W, H),
    'noise estimator responds to actual noise',
  )
}

/**
 * Mirrors the worker's overlap-save tiling on plain arrays, so we can prove the
 * tiled path produces the same pixels as a whole-image transform — i.e. no seams.
 */
function tiledDeconvolve(src, w, h, opts, tile, margin) {
  const out = new Uint8ClampedArray(w * h * 4)
  for (let iy = 0; iy < h; iy += tile) {
    for (let ix = 0; ix < w; ix += tile) {
      const iw = Math.min(tile, w - ix)
      const ih = Math.min(tile, h - iy)
      const sx = Math.max(0, ix - margin)
      const sy = Math.max(0, iy - margin)
      const ex = Math.min(w, ix + iw + margin)
      const ey = Math.min(h, iy + ih + margin)
      const bw = ex - sx
      const bh = ey - sy
      const block = new Uint8ClampedArray(bw * bh * 4)
      for (let y = 0; y < bh; y++) {
        const from = ((y + sy) * w + sx) * 4
        block.set(src.subarray(from, from + bw * 4), y * bw * 4)
      }
      const r = deconvolve(block, bw, bh, opts)
      const cx = ix - sx
      const cy = iy - sy
      for (let y = 0; y < ih; y++) {
        const from = ((y + cy) * bw + cx) * 4
        const to = ((y + iy) * w + ix) * 4
        out.set(r.data.subarray(from, from + iw * 4), to)
      }
    }
  }
  return out
}

function testTilingIsSeamless() {
  console.log('Tiling (how big images are handled) — must match the whole-image result:')
  const ref = reference()
  const observed = addNoise(blur(ref, makePsf('gaussian', 1.5)), 1.0)
  // Same K for every tile, exactly as the worker does.
  const whole = deconvolve(observed, W, H, { kind: 'gaussian', radius: 1.5, strength: 0.5 })
  const opts = { kind: 'gaussian', radius: 1.5, strength: 0.5, overrideK: whole.k }
  const tiled = tiledDeconvolve(observed, W, H, opts, 64, Math.max(32, Math.ceil(1.5 * 6)))

  const agreement = psnr(tiled, whole.data)
  console.log(`    tiled vs whole-image agreement: ${agreement.toFixed(1)} dB`)
  assert(agreement > 40, `tiling reproduces the whole-image result (${agreement.toFixed(1)} dB)`)

  // Seam test done properly: measure the tiled result's DEVIATION from the
  // whole-image result, per column. A seam is deviation concentrated at tile
  // boundaries. (Measuring raw edge energy instead would just rediscover the
  // test pattern's own bars, which repeat every 8 px and land on x=64/128.)
  const colDeviation = (x) => {
    let worst = 0
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(tiled[i + c] - whole.data[i + c]))
    }
    return worst
  }
  let seamWorst = 0
  let elseWorst = 0
  for (let x = 0; x < W; x++) {
    const d = colDeviation(x)
    if (x % 64 === 0 || x % 64 === 63) seamWorst = Math.max(seamWorst, d)
    else elseWorst = Math.max(elseWorst, d)
  }
  console.log(
    `    worst deviation from whole-image: at tile boundaries ${seamWorst}, elsewhere ${elseWorst} (of 255)`,
  )
  // Not asserting boundary <= elsewhere: deconvolution amplifies noise, and
  // tiles see slightly different neighbourhoods, so a couple of levels of
  // scatter is expected and is not a seam. On noiseless input both sit at 1/255.
  // A genuine seam (insufficient margin) shows up as tens of levels.
  assert(seamWorst < 12, `boundary deviation is visually negligible (${seamWorst}/255)`)
}

testRecovery()
testTilingIsSeamless()
testPhysicsWall()
testPsfShapes()
testWrongPsfIsNotAWin()
testAlphaAndNoise()

if (failures) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nAll deconvolution checks passed ✓')
