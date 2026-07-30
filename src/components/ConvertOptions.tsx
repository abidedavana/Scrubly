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
}

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
        <p class="field-note" id="upscale-note">
          Enlarging uses a high-quality resample, so zoomed images stay smooth instead of blocky —
          but it can't add detail the original never captured.
          {format === 'image/png' &&
            ' Enlarged photos saved as PNG can get very large — JPEG or WebP is usually a better fit.'}
        </p>
      )}
    </div>
  )
}
