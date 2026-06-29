import * as Comlink from 'comlink'
import type { EncodeOptions, EncodeResult, ImageWorkerApi } from '../lib/image-types'

// Decode → (resize) → re-encode, entirely in the worker via OffscreenCanvas so
// the UI never blocks. No network, no WASM (yet) — pure browser canvas.
async function encodeImage(file: Blob, opts: EncodeOptions): Promise<EncodeResult> {
  const bitmap = await createImageBitmap(file)

  let width = bitmap.width
  let height = bitmap.height
  const longest = Math.max(width, height)
  if (opts.maxDimension && longest > opts.maxDimension) {
    const scale = opts.maxDimension / longest
    width = Math.max(1, Math.round(width * scale))
    height = Math.max(1, Math.round(height * scale))
  }

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas is not available in this browser.')
  }

  // JPEG has no alpha channel — flatten transparency onto white instead of black.
  if (opts.format === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await canvas.convertToBlob({
    type: opts.format,
    quality: opts.format === 'image/png' ? undefined : opts.quality,
  })

  return { blob, width, height }
}

const api: ImageWorkerApi = { encodeImage }
Comlink.expose(api)
