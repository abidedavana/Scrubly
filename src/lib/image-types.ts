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
  /**
   * Unsharp-mask strength applied after an enlarge, 0 = off. Around 1.2 makes
   * upscaled text read noticeably crisper; above ~2 starts to show halos.
   */
  sharpen?: number
}

export interface EncodeResult {
  blob: Blob
  width: number
  height: number
}

export interface DeblurOptions {
  kind: 'gaussian' | 'disc' | 'motion'
  /** Gaussian sigma, defocus disc radius, or motion length, in pixels. */
  radius: number
  /** Motion direction in degrees. */
  angle?: number
  /** 0..1 — higher pushes harder and risks ringing. */
  strength: number
  format: OutputFormat
  quality: number
}

export interface DeblurResult extends EncodeResult {
  /** Measured noise level of the input, 0..1. */
  noiseSigma: number
  /** Regularisation actually used. */
  k: number
}

export interface ImageWorkerApi {
  encodeImage(file: Blob, opts: EncodeOptions): Promise<EncodeResult>
  deblurImage(
    file: Blob,
    opts: DeblurOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<DeblurResult>
}
