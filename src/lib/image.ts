import * as Comlink from 'comlink'
import type { EncodeOptions, EncodeResult, ImageWorkerApi } from './image-types'

// Single lazily-created worker. The `encodeImage` seam keeps the encoder
// swappable (canvas now, jSquash codecs later) without touching the UI.
let api: Comlink.Remote<ImageWorkerApi> | null = null

function getApi(): Comlink.Remote<ImageWorkerApi> {
  if (!api) {
    const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), {
      type: 'module',
    })
    api = Comlink.wrap<ImageWorkerApi>(worker)
  }
  return api
}

export interface NamedResult extends EncodeResult {
  name: string
}

export async function encodeImages(files: File[], opts: EncodeOptions): Promise<NamedResult[]> {
  const worker = getApi()
  const out: NamedResult[] = []
  for (const file of files) {
    const r = await worker.encodeImage(file, opts)
    out.push({ ...r, name: file.name })
  }
  return out
}
