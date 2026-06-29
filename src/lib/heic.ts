export function isHeic(file: File): boolean {
  const t = file.type.toLowerCase()
  if (t === 'image/heic' || t === 'image/heif') return true
  // iPhone exports sometimes arrive with an empty MIME type — fall back to extension.
  return /\.(heic|heif)$/i.test(file.name)
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}

// Decode HEIC/HEIF to a lossless PNG blob. heic2any is self-contained (libheif
// compiled to inlined WASM), so it makes no network requests and runs under our
// strict CSP. Lazy-imported so the ~1.4 MB decoder only loads on first HEIC use.
export async function decodeHeicToPng(file: Blob): Promise<Blob> {
  // Quick reject: every HEIF/HEIC file is ISO-BMFF with an 'ftyp' box at byte 4.
  // Without this, heic2any can hang indefinitely on non-HEIF/garbage input.
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const tag = head.length >= 8 ? String.fromCharCode(head[4], head[5], head[6], head[7]) : ''
  if (tag !== 'ftyp') {
    throw new Error('This file does not look like a HEIC/HEIF image.')
  }

  const { default: heic2any } = await import('heic2any')
  // Safety net in case libheif stalls on a corrupt-but-valid-looking file.
  const out = await withTimeout(
    heic2any({ blob: file, toType: 'image/png' }),
    60000,
    'HEIC decoding timed out — the file may be corrupt or an unsupported variant.',
  )
  return Array.isArray(out) ? out[0] : out
}
