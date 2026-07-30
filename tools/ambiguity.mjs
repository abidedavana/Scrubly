// Is reconstruction of tiny text a solvable problem, or a guess?
//
// Renders DIFFERENT strings, degrades each the way a small/compressed image
// does, and measures how different the degraded versions are from each other.
//
// If two different originals produce (near-)identical degraded pixels, then no
// algorithm — however good — can tell which one it was looking at. It can only
// pick the more likely one. That is not a quality ceiling that better models
// eventually break through; it is many-to-one information loss.
//
//   node tools/ambiguity.mjs

import { renderTextExport as renderText, down2, blockify } from './text-legibility-lib.mjs'

const VARIANTS = ['4291-8837', '4231-8837', '4291-8637', '4291-8837', '4791-8837']

function diffStats(a, b) {
  let maxAbs = 0
  let sum = 0
  let n = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.abs(a.data[i] - b.data[i])
    if (d > maxAbs) maxAbs = d
    sum += d
    n++
  }
  return { maxAbs, mean: sum / n }
}

function addNoise(img, sigma, seed) {
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

// The question is not "are the pixels different" but "is the difference caused
// by the DIGITS bigger than the difference caused by NOISE". If noise dominates,
// the two originals are statistically indistinguishable and any reconstruction
// is a guess dressed up as an answer.
console.log('Signal (which digit it is) vs noise (sensor/compression), after degradation.')
console.log('SNR below ~1 means the digit identity is buried and cannot be recovered.\n')

for (const xh of [3, 4, 6, 10]) {
  console.log(`letter height ${xh}px in the file:`)
  for (const sigma of [0, 2, 4]) {
    const a1 = addNoise(blockify(down2(renderText(VARIANTS[0], xh * 2)), 0.55), sigma, 11)
    const a2 = addNoise(blockify(down2(renderText(VARIANTS[0], xh * 2)), 0.55), sigma, 999)
    const noiseOnly = diffStats(a1, a2).mean

    let sig = 0
    let count = 0
    for (const v of VARIANTS) {
      if (v === VARIANTS[0]) continue
      const b = addNoise(blockify(down2(renderText(v, xh * 2)), 0.55), sigma, 11)
      sig += diffStats(a1, b).mean
      count++
    }
    sig /= count
    const snr = noiseOnly > 0.001 ? sig / noiseOnly : Infinity
    const verdict =
      sigma === 0
        ? '(noiseless — unrealistic)'
        : snr < 1
          ? 'BURIED — the digit is unrecoverable'
          : snr < 2
            ? 'marginal — a model would be guessing often'
            : 'recoverable in principle'
    console.log(
      `   noise sigma ${sigma}/255:  digit signal ${sig.toFixed(2)}  vs noise ${noiseOnly.toFixed(
        2,
      )}   SNR ${snr === Infinity ? 'inf' : snr.toFixed(2).padStart(5)}   ${verdict}`,
    )
  }
  console.log()
}
