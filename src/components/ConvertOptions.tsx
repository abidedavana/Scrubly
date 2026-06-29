import type { OutputFormat } from '../lib/image-types'

interface Props {
  format: OutputFormat
  onFormat: (f: OutputFormat) => void
  quality: number
  onQuality: (q: number) => void
  resize: boolean
  onResize: (b: boolean) => void
  maxDim: number
  onMaxDim: (n: number) => void
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
}: Props) {
  const lossy = format !== 'image/png'
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
          <span>Max dimension (px)</span>
          <input
            type="number"
            min="16"
            max="20000"
            value={maxDim}
            onInput={(e) =>
              onMaxDim(Math.max(16, parseInt((e.target as HTMLInputElement).value, 10) || 16))
            }
          />
        </label>
      )}
    </div>
  )
}
