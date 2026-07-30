// Minimal iterative radix-2 Cooley-Tukey FFT, enough for 2D image convolution.
// Pure and DOM-free so the deconvolution maths can be checked in Node.
//
// Twiddle factors are precomputed per transform length and cached — accumulating
// them incrementally inside the butterfly loop drifts badly by the time you
// reach 2048-point transforms.

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array }>()

function twiddles(n: number): { cos: Float64Array; sin: Float64Array } {
  const hit = twiddleCache.get(n)
  if (hit) return hit
  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    const a = (-2 * Math.PI * i) / n
    cos[i] = Math.cos(a)
    sin[i] = Math.sin(a)
  }
  const entry = { cos, sin }
  twiddleCache.set(n, entry)
  return entry
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

/** In-place complex FFT of a power-of-two length buffer. */
export function fft1d(re: Float32Array, im: Float32Array, n: number, inverse: boolean): void {
  if (n < 2) return

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }

  const { cos, sin } = twiddles(n)
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t]
        // Conjugate the twiddle for the inverse transform.
        const wi = inverse ? -sin[t] : sin[t]
        const a = i + k
        const b = a + half
        const xr = re[b] * wr - im[b] * wi
        const xi = re[b] * wi + im[b] * wr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
      }
    }
  }

  if (inverse) {
    const inv = 1 / n
    for (let i = 0; i < n; i++) {
      re[i] *= inv
      im[i] *= inv
    }
  }
}

/**
 * In-place 2D FFT over a row-major w x h buffer. Both dimensions must be
 * powers of two.
 */
export function fft2d(
  re: Float32Array,
  im: Float32Array,
  w: number,
  h: number,
  inverse: boolean,
): void {
  const rowRe = new Float32Array(w)
  const rowIm = new Float32Array(w)
  for (let y = 0; y < h; y++) {
    const o = y * w
    rowRe.set(re.subarray(o, o + w))
    rowIm.set(im.subarray(o, o + w))
    fft1d(rowRe, rowIm, w, inverse)
    re.set(rowRe, o)
    im.set(rowIm, o)
  }

  const colRe = new Float32Array(h)
  const colIm = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colRe[y] = re[y * w + x]
      colIm[y] = im[y * w + x]
    }
    fft1d(colRe, colIm, h, inverse)
    for (let y = 0; y < h; y++) {
      re[y * w + x] = colRe[y]
      im[y * w + x] = colIm[y]
    }
  }
}
