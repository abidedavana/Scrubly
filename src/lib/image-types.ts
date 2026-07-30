// Shared types for the image pipeline. Kept separate from the worker module so
// the main thread can import them as types without pulling in worker code.

export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp'

export interface EncodeOptions {
  format: OutputFormat
  /** 0..1 — ignored for PNG (lossless). */
  quality: number
  /** Longest-edge target in px. Omit to keep original dimensions. */
  maxDimension?: number
  /**
   * When set, images smaller than maxDimension are enlarged to it (high-quality
   * resample). Otherwise maxDimension only ever shrinks.
   */
  allowUpscale?: boolean
}

export interface EncodeResult {
  blob: Blob
  width: number
  height: number
}

export interface ImageWorkerApi {
  encodeImage(file: Blob, opts: EncodeOptions): Promise<EncodeResult>
}
