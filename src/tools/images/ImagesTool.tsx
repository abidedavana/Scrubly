import { useState } from 'preact/hooks'
import { Dropzone } from '../../components/Dropzone'
import { encodeImages } from '../../lib/image'
import type { OutputFormat } from '../../lib/image-types'
import { downloadAllZip, downloadBlob, formatBytes, replaceExt } from '../../lib/files'

interface ResultItem {
  id: string
  name: string
  originalSize: number
  size: number
  width: number
  height: number
  blob: Blob
  url: string
}

const FORMAT_EXT: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function ImagesTool() {
  const [files, setFiles] = useState<File[]>([])
  const [format, setFormat] = useState<OutputFormat>('image/jpeg')
  const [quality, setQuality] = useState(0.8)
  const [resize, setResize] = useState(false)
  const [maxDim, setMaxDim] = useState(2048)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ResultItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const lossy = format !== 'image/png'
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)

  function addFiles(incoming: File[]) {
    const images = incoming.filter((f) => f.type.startsWith('image/'))
    if (images.length) setFiles((prev) => [...prev, ...images])
  }

  function clearResults() {
    setResults((prev) => {
      prev.forEach((r) => URL.revokeObjectURL(r.url))
      return []
    })
  }

  function reset() {
    clearResults()
    setFiles([])
    setError(null)
  }

  async function run() {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    clearResults()
    try {
      const out = await encodeImages(files, {
        format,
        quality,
        maxDimension: resize ? maxDim : undefined,
      })
      const items: ResultItem[] = out.map((r, i) => ({
        id: `${i}-${r.name}`,
        name: replaceExt(files[i].name, FORMAT_EXT[format]),
        originalSize: files[i].size,
        size: r.blob.size,
        width: r.width,
        height: r.height,
        blob: r.blob,
        url: URL.createObjectURL(r.blob),
      }))
      setResults(items)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while processing.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="panel">
      <Dropzone
        accept="image/*"
        multiple
        onFiles={addFiles}
        title={
          files.length
            ? `${files.length} image${files.length > 1 ? 's' : ''} ready — drop more or click`
            : 'Drop images here'
        }
        hint="JPG, PNG, WebP, GIF, BMP — converted, resized and compressed entirely on your device."
      />

      {files.length > 0 && (
        <>
          <div class="filebar">
            <span>
              {files.length} selected · {formatBytes(totalSize)}
            </span>
            <button class="btn btn--ghost" type="button" onClick={reset}>
              Clear
            </button>
          </div>

          <div class="options">
            <label class="field">
              <span>Output format</span>
              <select
                value={format}
                onChange={(e) => setFormat((e.target as HTMLSelectElement).value as OutputFormat)}
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
                  onInput={(e) => setQuality(parseFloat((e.target as HTMLInputElement).value))}
                />
              </label>
            )}

            <label class="field field--check">
              <input
                type="checkbox"
                checked={resize}
                onChange={(e) => setResize((e.target as HTMLInputElement).checked)}
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
                    setMaxDim(Math.max(16, parseInt((e.target as HTMLInputElement).value, 10) || 16))
                  }
                />
              </label>
            )}
          </div>

          <div class="run">
            <button class="btn btn--primary" type="button" disabled={busy} onClick={run}>
              {busy
                ? 'Processing…'
                : `Process ${files.length} image${files.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div class="results">
          <div class="results__head">
            <h2>
              Done — {results.length} file{results.length > 1 ? 's' : ''}
            </h2>
            {results.length > 1 && (
              <button
                class="btn btn--primary"
                type="button"
                onClick={() =>
                  downloadAllZip(
                    results.map((r) => ({ name: r.name, input: r.blob })),
                    'scrubly-images.zip',
                  )
                }
              >
                Download all (.zip)
              </button>
            )}
          </div>
          <ul class="results__list">
            {results.map((r) => {
              const pct = r.originalSize > 0 ? Math.round((1 - r.size / r.originalSize) * 100) : 0
              return (
                <li class="result" key={r.id}>
                  <img class="result__thumb" src={r.url} alt="" loading="lazy" />
                  <div class="result__meta">
                    <span class="result__name">{r.name}</span>
                    <span class="result__sizes">
                      {formatBytes(r.originalSize)} → {formatBytes(r.size)}{' '}
                      <em class={pct >= 0 ? 'good' : 'bad'}>
                        {pct >= 0 ? `−${pct}%` : `+${-pct}%`}
                      </em>{' '}
                      · {r.width}×{r.height}
                    </span>
                  </div>
                  <button class="btn" type="button" onClick={() => downloadBlob(r.blob, r.name)}>
                    Download
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}
