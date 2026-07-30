import { useState } from 'preact/hooks'
import type { OutputFormat } from '../lib/image-types'

const DIM_MIN = 16
const DIM_MAX = 16384

interface Props {
  format: OutputFormat
  onFormat: (f: OutputFormat) => void
  quality: number
  onQuality: (q: number) => void
  resize: boolean
  onResize: (b: boolean) => void
  maxDim: number
  onMaxDim: (n: number) => void
  upscale: boolean
  onUpscale: (b: boolean) => void
  sharpen: number
  onSharpen: (n: number) => void
}

const SHARPEN_LEVELS = [
  { label: 'Off', value: 0 },
  { label: 'Light', value: 0.6 },
  { label: 'Medium', value: 1.2 },
  { label: 'Strong', value: 2 },
]

export function ConvertOptions({
  format,
  onFormat,
  quality,
  onQuality,
  resize,
  onResize,
  maxDim,
  onMaxDim,
  upscale,
  onUpscale,
  sharpen,
  onSharpen,
}: Props) {
  const lossy = format !== 'image/png'
  // Let the user type freely (a controlled number input that clamps per
  // keystroke corrupts entries like "500" into "1600"); the committed value is
  // clamped to [DIM_MIN, DIM_MAX] and the field snaps to it on blur.
  const [dimText, setDimText] = useState(String(maxDim))

  return (
    <div class="options">
      <label class="field">
        <span>Output format</span>
        <select
          value={format}
          onChange={(e) => onFormat((e.target as HTMLSelectElement).value as OutputFormat)}
        >
          <option value="image/jpeg">JPEG (.jpg)</option>
          <option value="image/png">PNG (.png)</option>
          <option value="image/webp">WebP (.webp)</option>
        </select>
      </label>

      {lossy && (
        <label class="field">
          <span>Quality: {Math.round(quality * 100)}%</span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            value={quality}
            onInput={(e) => onQuality(parseFloat((e.target as HTMLInputElement).value))}
          />
        </label>
      )}

      <label class="field field--check">
        <input
          type="checkbox"
          checked={resize}
          onChange={(e) => onResize((e.target as HTMLInputElement).checked)}
        />
        <span>Resize (longest edge)</span>
      </label>

      {resize && (
        <label class="field">
          <span>{upscale ? 'Target size (px)' : 'Max dimension (px)'}</span>
          <input
            type="number"
            min={DIM_MIN}
            max={DIM_MAX}
            value={dimText}
            onInput={(e) => {
              const raw = (e.target as HTMLInputElement).value
              setDimText(raw)
              const n = parseInt(raw, 10)
              if (!Number.isNaN(n)) onMaxDim(Math.min(DIM_MAX, Math.max(DIM_MIN, n)))
            }}
            onBlur={() => setDimText(String(maxDim))}
          />
        </label>
      )}

      {resize && (
        <label class="field field--check">
          <input
            type="checkbox"
            checked={upscale}
            aria-describedby="upscale-note"
            onChange={(e) => onUpscale((e.target as HTMLInputElement).checked)}
          />
          <span>Enlarge smaller images to this size</span>
        </label>
      )}

      {resize && upscale && (
        <label class="field">
          <span>Sharpen</span>
          <select
            value={String(sharpen)}
            onChange={(e) => onSharpen(Number((e.target as HTMLSelectElement).value))}
          >
            {SHARPEN_LEVELS.map((l) => (
              <option key={l.label} value={String(l.value)}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {resize && upscale && (
        <p class="field-note" id="upscale-note">
          Enlarging uses Lanczos resampling plus sharpening, which makes edges and text noticeably
          crisper than a plain resize — but no upscaler can recover detail the original never
          captured, so a small blurry photo will look smoother, not sharper.
          {format === 'image/png' &&
            ' Enlarged photos saved as PNG can get very large — JPEG or WebP is usually a better fit.'}
        </p>
      )}
    </div>
  )
}
