// Wiener deconvolution — genuine recovery of blurred detail.
//
// Unlike sharpening (which boosts what edges survived) or upscaling (which can
// only interpolate), deconvolution INVERTS a known forward model. A lens or a
// camera shake smears every point of the scene into a point-spread function;
// that smearing is a convolution, and convolution is invertible in the
// frequency domain. The information is still in the file, just spread out.
//
//   observed = true * psf + noise
//   estimate = observed x conj(H) / (|H|^2 + K)      (Wiener, K = noise/signal)
//
// The hard limit is physics, not implementation: wherever the PSF's transfer
// function falls below the noise floor, that spatial frequency is gone and no
// value of K brings it back. Recovery is strong for mild-to-moderate blur and
// tails off to nothing past roughly sigma 3-4 on 8-bit data.
//
// Four things this gets right that a naive implementation does not:
//  1. It works in LINEAR light. Deconvolving gamma-encoded values is wrong and
//     costs real quality plus visible edge ringing.
//  2. K is ESTIMATED from the image's own noise floor, not hardcoded. Too small
//     a K on quantised data amplifies noise catastrophically.
//  3. Borders are mirrored and tapered. The FFT treats the image as circular,
//     so a raw image rings along every edge.
//  4. The result is clamped in linear space before re-encoding.

// Explicit .ts extension so Node can run this module directly in the checks.
import { fft2d, nextPow2 } from './fft.ts'

export type PsfKind = 'gaussian' | 'disc' | 'motion'

export interface DeconvOptions {
  kind: PsfKind
  /** Gaussian sigma, defocus disc radius, or motion length, in pixels. */
  radius: number
  /** Motion direction in degrees. Ignored for other kinds. */
  angle?: number
  /** 0..1. Higher pushes harder (less regularisation) and risks ringing. */
  strength: number
}

export interface Psf {
  data: Float32Array
  size: number
}

// ---------- colour ----------

const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

const LINEAR_TO_SRGB_STEPS = 4096
const LINEAR_TO_SRGB = new Uint8ClampedArray(LINEAR_TO_SRGB_STEPS + 1)
for (let i = 0; i <= LINEAR_TO_SRGB_STEPS; i++) {
  const c = i / LINEAR_TO_SRGB_STEPS
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  LINEAR_TO_SRGB[i] = Math.round(s * 255)
}

function linearToSrgb(v: number): number {
  const c = v <= 0 ? 0 : v >= 1 ? 1 : v
  return LINEAR_TO_SRGB[(c * LINEAR_TO_SRGB_STEPS) | 0]
}

// ---------- point-spread functions ----------

export function makePsf(kind: PsfKind, radius: number, angleDeg = 0): Psf {
  const r = Math.max(0.3, radius)
  if (kind === 'gaussian') return gaussianPsf(r)
  if (kind === 'disc') return discPsf(r)
  return motionPsf(r, angleDeg)
}

function gaussianPsf(sigma: number): Psf {
  const half = Math.max(1, Math.ceil(sigma * 3))
  const size = half * 2 + 1
  const data = new Float32Array(size * size)
  const twoSigmaSq = 2 * sigma * sigma
  let sum = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - half
      const dy = y - half
      const v = Math.exp(-(dx * dx + dy * dy) / twoSigmaSq)
      data[y * size + x] = v
      sum += v
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= sum
  return { data, size }
}

/** Defocus: a uniform disc. Supersampled so the rim isn't harshly aliased. */
function discPsf(radius: number): Psf {
  const half = Math.max(1, Math.ceil(radius))
  const size = half * 2 + 1
  const data = new Float32Array(size * size)
  const SS = 4
  const rSq = radius * radius
  let sum = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const dx = x - half + (sx + 0.5) / SS - 0.5
          const dy = y - half + (sy + 0.5) / SS - 0.5
          if (dx * dx + dy * dy <= rSq) hits++
        }
      }
      const v = hits / (SS * SS)
      data[y * size + x] = v
      sum += v
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= sum || 1
  return { data, size }
}

/** Camera shake / subject motion: a line of the given length and angle. */
function motionPsf(length: number, angleDeg: number): Psf {
  const half = Math.max(1, Math.ceil(length / 2) + 1)
  const size = half * 2 + 1
  const data = new Float32Array(size * size)
  const rad = (angleDeg * Math.PI) / 180
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)
  const steps = Math.max(2, Math.ceil(length * 8))
  let sum = 0
  for (let s = 0; s < steps; s++) {
    const t = (s / (steps - 1) - 0.5) * length
    const px = half + dx * t
    const py = half + dy * t
    // Bilinear splat so the line isn't jagged.
    const x0 = Math.floor(px)
    const y0 = Math.floor(py)
    const fx = px - x0
    const fy = py - y0
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const xx = x0 + i
        const yy = y0 + j
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue
        const wgt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy)
        data[yy * size + xx] += wgt
        sum += wgt
      }
    }
  }
  for (let i = 0; i < data.length; i++) data[i] /= sum || 1
  return { data, size }
}

// ---------- noise ----------

/**
 * Immerkaer's fast noise estimator: convolve with a kernel that annihilates
 * locally-linear image content, leaving mostly noise. Returns sigma in 0..1.
 */
export function estimateNoiseSigma(data: Uint8ClampedArray, w: number, h: number): number {
  if (w < 3 || h < 3) return 0.01
  let acc = 0
  let n = 0
  const lum = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4
      const v =
        4 * lum(i) -
        2 * (lum(i - 4) + lum(i + 4) + lum(i - w * 4) + lum(i + w * 4)) +
        (lum(i - w * 4 - 4) + lum(i - w * 4 + 4) + lum(i + w * 4 - 4) + lum(i + w * 4 + 4))
      acc += Math.abs(v)
      n++
    }
  }
  const sigma255 = (Math.sqrt(Math.PI / 2) * acc) / (6 * n)
  return Math.max(0.0008, sigma255 / 255)
}

function signalStd(data: Uint8ClampedArray, w: number, h: number): number {
  let sum = 0
  let sumSq = 0
  const n = w * h
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255
    sum += v
    sumSq += v * v
  }
  const mean = sum / n
  return Math.sqrt(Math.max(1e-6, sumSq / n - mean * mean))
}

// ---------- padding ----------

function reflect(i: number, n: number): number {
  if (n === 1) return 0
  const period = 2 * n - 2
  let m = ((i % period) + period) % period
  return m < n ? m : period - m
}

// ---------- main ----------

export interface DeconvResult {
  data: Uint8ClampedArray<ArrayBuffer>
  noiseSigma: number
  k: number
  padW: number
  padH: number
}

export function deconvolve(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  opts: DeconvOptions,
  onProgress?: (fraction: number) => void,
): DeconvResult {
  const psf = makePsf(opts.kind, opts.radius, opts.angle ?? 0)
  const psfHalf = (psf.size - 1) / 2

  // Regularisation: start from the measured noise-to-signal ratio, then let the
  // user push it. Never let it reach zero — on quantised data that explodes.
  const sigma = estimateNoiseSigma(src, w, h)
  const nsr = (sigma / signalStd(src, w, h)) ** 2
  const push = Math.pow(10, (0.5 - clamp01(opts.strength)) * 3)
  const k = Math.min(1, Math.max(1e-5, nsr * push))

  const margin = Math.max(8, psfHalf * 2)
  const padW = nextPow2(w + margin * 2)
  const padH = nextPow2(h + margin * 2)
  const ox = (padW - w) >> 1
  const oy = (padH - h) >> 1

  // Optical transfer function: PSF centred on the origin with circular wrap, so
  // deconvolution introduces no spatial shift.
  const hRe = new Float32Array(padW * padH)
  const hIm = new Float32Array(padW * padH)
  for (let y = 0; y < psf.size; y++) {
    for (let x = 0; x < psf.size; x++) {
      const px = (((x - psfHalf) % padW) + padW) % padW
      const py = (((y - psfHalf) % padH) + padH) % padH
      hRe[py * padW + px] = psf.data[y * psf.size + x]
    }
  }
  fft2d(hRe, hIm, padW, padH, false)

  const out = new Uint8ClampedArray(w * h * 4)
  const re = new Float32Array(padW * padH)
  const im = new Float32Array(padW * padH)

  for (let c = 0; c < 3; c++) {
    // Mean of this channel in linear light, used as the value the border fades
    // to so the circular wrap has no discontinuity.
    let mean = 0
    for (let p = 0, i = c; p < w * h; p++, i += 4) mean += SRGB_TO_LINEAR[src[i]]
    mean /= w * h

    im.fill(0)
    for (let y = 0; y < padH; y++) {
      const sy = reflect(y - oy, h)
      const rowOff = y * padW
      // Cosine taper: 1 across the image, easing to 0 out in the pad band.
      const dy = y < oy ? oy - y : y >= oy + h ? y - (oy + h) + 1 : 0
      for (let x = 0; x < padW; x++) {
        const sx = reflect(x - ox, w)
        const dx = x < ox ? ox - x : x >= ox + w ? x - (ox + w) + 1 : 0
        const d = Math.max(dx, dy)
        const t = d === 0 ? 1 : d >= margin ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / margin))
        const v = SRGB_TO_LINEAR[src[(sy * w + sx) * 4 + c]]
        re[rowOff + x] = mean + (v - mean) * t
      }
    }

    fft2d(re, im, padW, padH, false)

    // Wiener: G * conj(H) / (|H|^2 + K)
    for (let i = 0; i < re.length; i++) {
      const hr = hRe[i]
      const hi = hIm[i]
      const denom = hr * hr + hi * hi + k
      const gr = re[i]
      const gi = im[i]
      re[i] = (gr * hr + gi * hi) / denom
      im[i] = (gi * hr - gr * hi) / denom
    }

    fft2d(re, im, padW, padH, true)

    for (let y = 0; y < h; y++) {
      const srcRow = (y + oy) * padW + ox
      const dstRow = y * w
      for (let x = 0; x < w; x++) {
        out[(dstRow + x) * 4 + c] = linearToSrgb(re[srcRow + x])
      }
    }

    onProgress?.((c + 1) / 3)
  }

  for (let p = 0, i = 3; p < w * h; p++, i += 4) out[i] = src[i]

  return { data: out, noiseSigma: sigma, k, padW, padH }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}
