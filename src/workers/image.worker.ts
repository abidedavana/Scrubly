// MUST be first: strips fetch/XHR/WebSocket/etc before any other code runs.
import './net-lockdown'
import * as Comlink from 'comlink'
import type { EncodeOptions, EncodeResult, ImageWorkerApi } from '../lib/image-types'
import { flattenToWhiteInPlace, lanczos3Resize, unsharpMaskInPlace } from '../lib/resample'

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

const api: ImageWorkerApi = { encodeImage }
Comlink.expose(api)
