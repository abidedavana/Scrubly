import { useState } from 'preact/hooks'
import { Dropzone } from '../../components/Dropzone'
import { ConvertOptions } from '../../components/ConvertOptions'
import { ResultsList } from '../../components/ResultsList'
import { decodeHeicToPng, isHeic } from '../../lib/heic'
import { encodeImages } from '../../lib/image'
import type { OutputFormat } from '../../lib/image-types'
import type { ResultItem } from '../../lib/convert-types'
import { replaceExt } from '../../lib/files'

const FORMAT_EXT: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function HeicTool() {
  const [files, setFiles] = useState<File[]>([])
  const [format, setFormat] = useState<OutputFormat>('image/jpeg')
  const [quality, setQuality] = useState(0.9)
  const [resize, setResize] = useState(false)
  const [maxDim, setMaxDim] = useState(2048)
  const [upscale, setUpscale] = useState(false)
  const [sharpen, setSharpen] = useState(1.2)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [results, setResults] = useState<ResultItem[]>([])
  const [error, setError] = useState<string | null>(null)

  function addFiles(incoming: File[]) {
    const heics = incoming.filter(isHeic)
    if (heics.length) setFiles((prev) => [...prev, ...heics])
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
    setStatus(null)
  }

  async function run() {
    if (files.length === 0) return
    setBusy(true)
    setError(null)
    clearResults()
    setStatus(null)
    try {
      const items: ResultItem[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        setStatus(`Decoding ${i + 1} of ${files.length}…`)
        // Yield so the status paints before the (heavy, main-thread) HEIC decode.
        await new Promise((r) => setTimeout(r, 0))
        const png = await decodeHeicToPng(file)
        const pngFile = new File([png], file.name, { type: 'image/png' })
        const [enc] = await encodeImages([pngFile], {
          format,
          quality,
          maxDimension: resize ? maxDim : undefined,
          allowUpscale: resize && upscale,
          sharpen,
        })
        items.push({
          id: `${i}-${file.name}`,
          name: replaceExt(file.name, FORMAT_EXT[format]),
          originalSize: file.size,
          size: enc.blob.size,
          width: enc.width,
          height: enc.height,
          blob: enc.blob,
          url: URL.createObjectURL(enc.blob),
        })
        setResults([...items]) // progressive — show each as it finishes
      }
      setStatus(null)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not decode that HEIC file. It may be an unsupported variant.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section class="panel">
      <Dropzone
        accept=".heic,.heif,image/heic,image/heif"
        multiple
        onFiles={addFiles}
        title={
          files.length
            ? `${files.length} HEIC file${files.length > 1 ? 's' : ''} ready — drop more or click`
            : 'Drop HEIC photos here'
        }
        hint="Apple HEIC/HEIF photos converted to JPG or PNG, entirely on your device."
      />

      {files.length > 0 && (
        <>
          <div class="filebar">
            <span>{files.length} selected</span>
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
              {busy
                ? (status ?? 'Converting…')
                : `Convert ${files.length} HEIC file${files.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </>
      )}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      <ResultsList results={results} zipName="scrubly-heic.zip" />
    </section>
  )
}
