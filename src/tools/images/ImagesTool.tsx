import { useState } from 'preact/hooks'
import { Dropzone } from '../../components/Dropzone'
import { ConvertOptions } from '../../components/ConvertOptions'
import { ResultsList } from '../../components/ResultsList'
import { encodeImages } from '../../lib/image'
import type { OutputFormat } from '../../lib/image-types'
import type { ResultItem } from '../../lib/convert-types'
import { formatBytes, replaceExt } from '../../lib/files'

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
  const [upscale, setUpscale] = useState(false)
  const [sharpen, setSharpen] = useState(1.2)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ResultItem[]>([])
  const [error, setError] = useState<string | null>(null)

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
        allowUpscale: resize && upscale,
        sharpen,
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

          <ConvertOptions
            format={format}
            onFormat={setFormat}
            quality={quality}
            onQuality={setQuality}
            resize={resize}
            onResize={setResize}
            maxDim={maxDim}
            onMaxDim={setMaxDim}
            upscale={upscale}
            onUpscale={setUpscale}
            sharpen={sharpen}
            onSharpen={setSharpen}
          />

          <div class="run">
            <button class="btn btn--primary" type="button" disabled={busy} onClick={run}>
              {busy ? 'Processing…' : `Process ${files.length} image${files.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      <ResultsList results={results} zipName="scrubly-images.zip" />
    </section>
  )
}
