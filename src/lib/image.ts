import * as Comlink from 'comlink'
// Inlined as a blob: worker on purpose. A worker loaded from a same-origin
// https: URL does NOT inherit the document's CSP (it takes the policy from its
// own response headers, and GitHub Pages sends none), which left the thread
// that handles every file completely unpoliced. A blob: worker DOES inherit it.
// See src/workers/net-lockdown.ts for the belt-and-braces half of this.
import ImageWorker from '../workers/image.worker.ts?worker&inline'
import type {
  DeblurOptions,
  DeblurResult,
  EncodeOptions,
  EncodeResult,
  ImageWorkerApi,
} from './image-types'

// Single lazily-created worker. The `encodeImage` seam keeps the encoder
// swappable (canvas now, jSquash codecs later) without touching the UI.
let api: Comlink.Remote<ImageWorkerApi> | null = null

function getApi(): Comlink.Remote<ImageWorkerApi> {
  if (!api) {
    api = Comlink.wrap<ImageWorkerApi>(new ImageWorker())
  }
  return api
}

export interface NamedResult extends EncodeResult {
  name: string
}

export async function deblurImage(
  file: File,
  opts: DeblurOptions,
  onProgress?: (fraction: number) => void,
): Promise<DeblurResult> {
  return getApi().deblurImage(file, opts, onProgress ? Comlink.proxy(onProgress) : undefined)
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
