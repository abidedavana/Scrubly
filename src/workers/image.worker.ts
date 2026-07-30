// MUST be first: strips fetch/XHR/WebSocket/etc before any other code runs.
import './net-lockdown'
import * as Comlink from 'comlink'
import type {
  DeblurOptions,
  DeblurResult,
  EncodeOptions,
  EncodeResult,
  ImageWorkerApi,
} from '../lib/image-types'
import { flattenToWhiteInPlace, lanczos3Resize, unsharpMaskInPlace } from '../lib/resample'
import {
  blockSizeForPad,
  deconvolve,
  estimateNoiseSigma,
  makePsf,
  signalStd,
} from '../lib/deconvolve.ts'

// Engines limit canvases by SIDE and by total AREA, and the area cap bites
// first for near-square images (Chromium 16384², Firefox ~125 MP, iOS Safari
// lower still). 64 MP keeps the output canvas inside all modern limits.
const MAX_CANVAS_SIDE = 16384
const MAX_OUTPUT_PIXELS = 64 * 1024 * 1024

// Ceiling for the pure-JS Lanczos path. ~56 ms/MP measured, and it allocates a
// full-size output buffer, so hand very large targets back to the native
// resizer rather than stalling the worker.
const MAX_HQ_PIXELS = 32 * 1024 * 1024

// Decode → (resize) → re-encode, entirely in the worker via OffscreenCanvas so
// the UI never blocks. No network, no WASM — pure browser canvas.
async function encodeImage(file: Blob, opts: EncodeOptions): Promise<EncodeResult> {
  let bitmap = await createImageBitmap(file)
  try {
    let width = bitmap.width
    let height = bitmap.height
    const longest = Math.max(width, height)
    let target = Math.min(opts.maxDimension ?? 0, MAX_CANVAS_SIDE)
    const wantsResize =
      target > 0 && (longest > target || (!!opts.allowUpscale && longest < target))

    if (wantsResize) {
      // Relative area of the image at longest-side = 1, so the area cap can be
      // translated into a per-image maximum target side.
      const relArea = (bitmap.width / longest) * (bitmap.height / longest)
      target = Math.min(target, Math.floor(Math.sqrt(MAX_OUTPUT_PIXELS / relArea)))
      const scale = target / longest
      width = Math.max(1, Math.round(bitmap.width * scale))
      height = Math.max(1, Math.round(bitmap.height * scale))
    }

    const enlarging = width > bitmap.width || height > bitmap.height
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Canvas is not available in this browser.')
    }

    // Enlarging is where the browser's resizer looks softest, so do it properly
    // in JS: Lanczos3 plus an optional unsharp pass.
    if (enlarging && width * height <= MAX_HQ_PIXELS) {
      const srcCanvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const srcCtx = srcCanvas.getContext('2d')
      if (!srcCtx) throw new Error('Canvas is not available in this browser.')
      srcCtx.drawImage(bitmap, 0, 0)
      const src = srcCtx.getImageData(0, 0, bitmap.width, bitmap.height)

      const scaled = lanczos3Resize(src.data, bitmap.width, bitmap.height, width, height)
      if (opts.sharpen && opts.sharpen > 0) {
        unsharpMaskInPlace(scaled, width, height, opts.sharpen)
      }
      if (opts.format === 'image/jpeg') flattenToWhiteInPlace(scaled)
      ctx.putImageData(new ImageData(scaled, width, height), 0, 0)
    } else {
      if (wantsResize && (width !== bitmap.width || height !== bitmap.height)) {
        // Resample from the ALREADY-DECODED bitmap (not the file — that would
        // decode the source a second time and double peak memory).
        try {
          const resized = await createImageBitmap(bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: 'high',
          })
          bitmap.close()
          bitmap = resized
        } catch {
          /* drawImage fallback below handles the scale */
        }
      }
      // JPEG has no alpha channel — flatten transparency onto white, not black.
      if (opts.format === 'image/jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(bitmap, 0, 0, width, height)
    }

    const blob = await canvas.convertToBlob({
      type: opts.format,
      quality: opts.format === 'image/png' ? undefined : opts.quality,
    })

    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

// Deconvolution is FFT-based, so a whole-image transform on a big photo would
// need gigabytes: a 10000x8000 frame pads to 16384x8192, which is ~1 GB per
// float plane. Instead we walk the image in overlapping tiles. Each tile is
// deconvolved with real neighbouring pixels filling its margin, then only the
// interior is kept — the margin absorbs the edge ringing and is discarded, so
// the result is seam-free. This is overlap-save, and it makes cost scale
// linearly with megapixels instead of exploding.
// The block handed to the FFT is sized to land exactly on a power of two, so no
// transform capacity is wasted on padding. A 1024-wide block with a 32px margin
// yields a 960px interior: 0.92 MP of output per 1024x1024 transform, against
// 0.26 MP if we had used a round 512 tile and let it pad up to 1024.
const BLOCK = 1024
// Whole-image work below this size — one transform is cheaper than tiling.
const TILE_THRESHOLD = 4 * 1024 * 1024

/** Sampled from a few regions so noise is measured once for the whole image. */
function sampleGlobalK(
  ctx: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  strength: number,
): { k: number; sigma: number } {
  const S = Math.min(512, bitmap.width, bitmap.height)
  const probe = new OffscreenCanvas(S, S)
  const pctx = probe.getContext('2d', { willReadFrequently: true })!
  // Centre crop is representative enough and avoids vignetting at the corners.
  pctx.drawImage(
    bitmap,
    ((bitmap.width - S) / 2) | 0,
    ((bitmap.height - S) / 2) | 0,
    S,
    S,
    0,
    0,
    S,
    S,
  )
  const d = pctx.getImageData(0, 0, S, S)
  const sigma = estimateNoiseSigma(d.data, S, S)
  const std = signalStd(d.data, S, S)
  const nsr = (sigma / std) ** 2
  const s = strength < 0 ? 0 : strength > 1 ? 1 : strength
  const k = Math.min(1, Math.max(1e-5, nsr * Math.pow(10, (0.5 - s) * 3)))
  void ctx
  return { k, sigma }
}

async function deblurImage(
  file: Blob,
  opts: DeblurOptions,
  onProgress?: (fraction: number) => void,
): Promise<DeblurResult> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = bitmap
    const out = new OffscreenCanvas(width, height)
    const outCtx = out.getContext('2d', { willReadFrequently: true })
    if (!outCtx) throw new Error('Canvas is not available in this browser.')

    const psfRadius = opts.kind === 'motion' ? opts.radius / 2 : opts.radius
    const core = {
      kind: opts.kind,
      radius: opts.radius,
      angle: opts.angle,
      strength: opts.strength,
    }

    let noiseSigma = 0
    let k = 0

    if (width * height <= TILE_THRESHOLD) {
      outCtx.drawImage(bitmap, 0, 0)
      const src = outCtx.getImageData(0, 0, width, height)
      const r = deconvolve(src.data, width, height, core, onProgress)
      noiseSigma = r.noiseSigma
      k = r.k
      if (opts.format === 'image/jpeg') flattenToWhiteInPlace(r.data)
      outCtx.putImageData(new ImageData(r.data, width, height), 0, 0)
    } else {
      // Measure noise once, globally, so every tile is filtered identically.
      const g = sampleGlobalK(outCtx, bitmap, opts.strength)
      noiseSigma = g.sigma
      k = g.k

      // Margin must comfortably exceed the PSF's reach or ringing leaks inward.
      const margin = Math.max(32, Math.ceil(psfRadius * 6))
      // Size the block so deconvolve's own padding lands exactly on BLOCK.
      const psf = makePsf(opts.kind, opts.radius, opts.angle ?? 0)
      const block = blockSizeForPad(BLOCK, psf)
      const TILE = block - margin * 2
      if (TILE < 64) throw new Error('Blur radius is too large to process this image in tiles.')
      const tileCanvas = new OffscreenCanvas(block, block)
      const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true })!
      const cols = Math.ceil(width / TILE)
      const rows = Math.ceil(height / TILE)
      const total = cols * rows
      let done = 0

      for (let ty = 0; ty < rows; ty++) {
        for (let tx = 0; tx < cols; tx++) {
          const ix = tx * TILE
          const iy = ty * TILE
          const iw = Math.min(TILE, width - ix)
          const ih = Math.min(TILE, height - iy)

          // Source region including margin, clamped to the image.
          const sx = Math.max(0, ix - margin)
          const sy = Math.max(0, iy - margin)
          const ex = Math.min(width, ix + iw + margin)
          const ey = Math.min(height, iy + ih + margin)
          const bw = ex - sx
          const bh = ey - sy

          tileCtx.clearRect(0, 0, block, block)
          tileCtx.drawImage(bitmap, sx, sy, bw, bh, 0, 0, bw, bh)
          const blockData = tileCtx.getImageData(0, 0, bw, bh)

          const r = deconvolve(blockData.data, bw, bh, { ...core, overrideK: k })
          if (opts.format === 'image/jpeg') flattenToWhiteInPlace(r.data)

          // Keep only the interior — the margin carried the edge artefacts.
          const cropX = ix - sx
          const cropY = iy - sy
          const interior = new Uint8ClampedArray(iw * ih * 4)
          for (let y = 0; y < ih; y++) {
            const from = ((y + cropY) * bw + cropX) * 4
            interior.set(r.data.subarray(from, from + iw * 4), y * iw * 4)
          }
          outCtx.putImageData(new ImageData(interior, iw, ih), ix, iy)

          done++
          onProgress?.(done / total)
        }
      }
    }

    const blob = await out.convertToBlob({
      type: opts.format,
      quality: opts.format === 'image/png' ? undefined : opts.quality,
    })
    return { blob, width, height, noiseSigma, k }
  } finally {
    bitmap.close()
  }
}

const api: ImageWorkerApi = { encodeImage, deblurImage }
Comlink.expose(api)
