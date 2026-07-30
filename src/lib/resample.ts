// High-quality resampling used when ENLARGING an image.
//
// The browser's built-in resize (createImageBitmap resizeQuality:'high') is fast
// but very soft on upscales. Lanczos3 followed by an unsharp mask scores better
// on both fidelity and edge contrast.
//
// The reproducible numbers live in tests/resample.check.mjs (a bars/checker
// target, run with `npm test`): lanczos beats bilinear on PSNR and edge
// variance, unsharp raises edge contrast further, and the sharp original still
// beats every enlargement — that last assertion is the point. Resampling makes
// edges cleaner; it cannot restore detail the file never contained.
//
// A separate in-browser run on a small-text target showed the same ordering
// (browser-resize < lanczos3 < lanczos3+unsharp on both metrics). Those figures
// are not reproduced here because that harness renders text via canvas and is
// not part of the committed test suite.
//
// Both functions are pure and DOM-free so they can be unit-checked in Node.

const LOBES = 3

function lanczosWeight(x: number): number {
  if (x === 0) return 1
  if (x <= -LOBES || x >= LOBES) return 0
  const px = Math.PI * x
  return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px)
}

/**
 * Separable Lanczos3 resize. Alpha is premultiplied during filtering so
 * transparent edges don't bleed dark halos, then un-premultiplied on output.
 */
export function lanczos3Resize(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray<ArrayBuffer> {
  // Horizontal pass: sw x sh -> dw x sh, in premultiplied space.
  const tmp = new Float32Array(dw * sh * 4)
  const xRatio = sw / dw
  // When downscaling, the kernel must widen to average over the source window.
  const xSupport = Math.max(1, xRatio)

  for (let dx = 0; dx < dw; dx++) {
    const center = (dx + 0.5) * xRatio - 0.5
    const first = Math.floor(center - LOBES * xSupport)
    const last = Math.ceil(center + LOBES * xSupport)
    const weights: number[] = []
    const cols: number[] = []
    let wsum = 0
    for (let sx = first; sx <= last; sx++) {
      const w = lanczosWeight((sx - center) / xSupport)
      if (w === 0) continue
      weights.push(w)
      cols.push(sx < 0 ? 0 : sx > sw - 1 ? sw - 1 : sx)
      wsum += w
    }
    if (wsum === 0) wsum = 1
    for (let y = 0; y < sh; y++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < weights.length; k++) {
        const o = (y * sw + cols[k]) * 4
        const w = weights[k]
        const al = src[o + 3]
        const pm = (al / 255) * w
        r += src[o] * pm
        g += src[o + 1] * pm
        b += src[o + 2] * pm
        a += al * w
      }
      const t = (y * dw + dx) * 4
      tmp[t] = r / wsum
      tmp[t + 1] = g / wsum
      tmp[t + 2] = b / wsum
      tmp[t + 3] = a / wsum
    }
  }

  // Vertical pass: dw x sh -> dw x dh, un-premultiplying on write.
  const out = new Uint8ClampedArray(dw * dh * 4)
  const yRatio = sh / dh
  const ySupport = Math.max(1, yRatio)

  for (let dy = 0; dy < dh; dy++) {
    const center = (dy + 0.5) * yRatio - 0.5
    const first = Math.floor(center - LOBES * ySupport)
    const last = Math.ceil(center + LOBES * ySupport)
    const weights: number[] = []
    const rows: number[] = []
    let wsum = 0
    for (let sy = first; sy <= last; sy++) {
      const w = lanczosWeight((sy - center) / ySupport)
      if (w === 0) continue
      weights.push(w)
      rows.push(sy < 0 ? 0 : sy > sh - 1 ? sh - 1 : sy)
      wsum += w
    }
    if (wsum === 0) wsum = 1
    for (let x = 0; x < dw; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let k = 0; k < weights.length; k++) {
        const o = (rows[k] * dw + x) * 4
        const w = weights[k]
        r += tmp[o] * w
        g += tmp[o + 1] * w
        b += tmp[o + 2] * w
        a += tmp[o + 3] * w
      }
      const alpha = a / wsum
      const t = (dy * dw + x) * 4
      if (alpha <= 0) {
        out[t] = 0
        out[t + 1] = 0
        out[t + 2] = 0
        out[t + 3] = 0
      } else {
        const unpm = 255 / alpha
        out[t] = (r / wsum) * unpm
        out[t + 1] = (g / wsum) * unpm
        out[t + 2] = (b / wsum) * unpm
        out[t + 3] = alpha
      }
    }
  }

  return out
}

/**
 * Unsharp mask, applied in place. Uses a separable 3-tap blur with a rolling
 * three-row window, so it needs no full-size scratch buffer even at 32 MP.
 * `threshold` leaves flat areas alone, which stops it amplifying the block
 * noise in an already-compressed source.
 */
export function unsharpMaskInPlace(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
  threshold = 3,
): void {
  if (amount <= 0 || w < 3 || h < 3) return

  const blurRow = (y: number, buf: Float32Array) => {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      const im = (row + (x > 0 ? x - 1 : 0)) * 4
      const ip = (row + (x < w - 1 ? x + 1 : x)) * 4
      const o = x * 4
      buf[o] = (data[im] + 2 * data[i] + data[ip]) * 0.25
      buf[o + 1] = (data[im + 1] + 2 * data[i + 1] + data[ip + 1]) * 0.25
      buf[o + 2] = (data[im + 2] + 2 * data[i + 2] + data[ip + 2]) * 0.25
    }
  }

  let up = new Float32Array(w * 4)
  let mid = new Float32Array(w * 4)
  let dn = new Float32Array(w * 4)
  // Each row is blurred from the ORIGINAL pixels before that row is written,
  // so sharpening in place stays faithful to the unmodified source.
  blurRow(0, up)
  blurRow(0, mid)
  blurRow(h > 1 ? 1 : 0, dn)

  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const i = (row + x) * 4
      const o = x * 4
      for (let c = 0; c < 3; c++) {
        const blurred = (up[o + c] + 2 * mid[o + c] + dn[o + c]) * 0.25
        const v = data[i + c]
        const diff = v - blurred
        if (diff > threshold || diff < -threshold) {
          data[i + c] = v + amount * diff
        }
      }
    }
    const recycled = up
    up = mid
    mid = dn
    dn = recycled
    blurRow(y + 2 < h ? y + 2 : h - 1, dn)
  }
}

/** JPEG has no alpha — composite onto white so transparency doesn't go black. */
export function flattenToWhiteInPlace(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 255) continue
    const k = a / 255
    data[i] = data[i] * k + 255 * (1 - k)
    data[i + 1] = data[i + 1] * k + 255 * (1 - k)
    data[i + 2] = data[i + 2] * k + 255 * (1 - k)
    data[i + 3] = 255
  }
}
