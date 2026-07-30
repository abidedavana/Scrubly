import { useRef, useState } from 'preact/hooks'
import { Dropzone } from '../../components/Dropzone'
import { deblurImage } from '../../lib/image'
import type { DeblurOptions, OutputFormat } from '../../lib/image-types'
import { downloadBlob, formatBytes, replaceExt } from '../../lib/files'

type Kind = DeblurOptions['kind']

const FORMAT_EXT: Record<OutputFormat, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'disc', label: 'Out of focus', hint: 'Lens focus missed — set the blur radius in pixels.' },
  { id: 'motion', label: 'Motion / shake', hint: 'Camera or subject moved — set length and direction.' },
  { id: 'gaussian', label: 'General softness', hint: 'Soft overall — a good default if unsure.' },
]

interface Output {
  url: string
  blob: Blob
  name: string
  size: number
  width: number
  height: number
  noiseSigma: number
}

export function DeblurTool() {
  const [file, setFile] = useState<File | null>(null)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [kind, setKind] = useState<Kind>('disc')
  const [radius, setRadius] = useState(2)
  const [angle, setAngle] = useState(0)
  const [strength, setStrength] = useState(0.5)
  const [format, setFormat] = useState<OutputFormat>('image/png')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [out, setOut] = useState<Output | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [compare, setCompare] = useState(false)
  const runId = useRef(0)

  function reset() {
    setOut((prev) => {
      if (prev) URL.revokeObjectURL(prev.url)
      return null
    })
    setError(null)
  }

  function addFiles(files: File[]) {
    const img = files.find((f) => f.type.startsWith('image/'))
    if (!img) return
    reset()
    setSrcUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(img)
    })
    setFile(img)
  }

  async function run() {
    if (!file) return
    const id = ++runId.current
    setBusy(true)
    setProgress(0)
    setError(null)
    try {
      const r = await deblurImage(
        file,
        { kind, radius, angle, strength, format, quality: 0.92 },
        (f) => {
          if (runId.current === id) setProgress(f)
        },
      )
      if (runId.current !== id) return
      reset()
      setOut({
        url: URL.createObjectURL(r.blob),
        blob: r.blob,
        name: replaceExt(file.name, FORMAT_EXT[format]),
        size: r.blob.size,
        width: r.width,
        height: r.height,
        noiseSigma: r.noiseSigma,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not deblur this image.')
    } finally {
      if (runId.current === id) setBusy(false)
    }
  }

  const current = KINDS.find((k) => k.id === kind)!

  return (
    <section class="panel">
      <Dropzone
        accept="image/*"
        multiple={false}
        onFiles={addFiles}
        title={file ? `${file.name} — drop another to replace` : 'Drop a blurry photo here'}
        hint="Recovers detail that blur smeared out, by inverting the blur. Runs on your device."
      />

      <p class="field-note dz-note">
        This is real recovery, not invention: blur spreads each point of the scene over its
        neighbours, and that is reversible while the detail is still above the noise. It works well
        for mild-to-moderate blur and does progressively less as blur gets heavier — a badly blurred
        photo has genuinely lost the information. It cannot help a small, low-resolution image; use
        Images → Enlarge for that.
      </p>

      {file && (
        <>
          <div class="filebar">
            <span>{formatBytes(file.size)}</span>
            <button
              class="btn btn--ghost"
              type="button"
              onClick={() => {
                reset()
                setFile(null)
                setSrcUrl((p) => {
                  if (p) URL.revokeObjectURL(p)
                  return null
                })
              }}
            >
              Clear
            </button>
          </div>

          <div class="options">
            <label class="field">
              <span>What kind of blur?</span>
              <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as Kind)}>
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>

            <label class="field">
              <span>
                {kind === 'motion' ? 'Motion length' : 'Blur radius'}: {radius.toFixed(1)} px
              </span>
              <input
                type="range"
                min="0.5"
                max={kind === 'motion' ? '30' : '10'}
                step="0.5"
                value={radius}
                onInput={(e) => setRadius(parseFloat((e.target as HTMLInputElement).value))}
              />
            </label>

            {kind === 'motion' && (
              <label class="field">
                <span>Direction: {angle}°</span>
                <input
                  type="range"
                  min="0"
                  max="179"
                  step="1"
                  value={angle}
                  onInput={(e) => setAngle(parseInt((e.target as HTMLInputElement).value, 10))}
                />
              </label>
            )}

            <label class="field">
              <span>Strength: {Math.round(strength * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={strength}
                onInput={(e) => setStrength(parseFloat((e.target as HTMLInputElement).value))}
              />
            </label>

            <label class="field">
              <span>Save as</span>
              <select
                value={format}
                onChange={(e) => setFormat((e.target as HTMLSelectElement).value as OutputFormat)}
              >
                <option value="image/png">PNG (lossless)</option>
                <option value="image/jpeg">JPEG (.jpg)</option>
                <option value="image/webp">WebP (.webp)</option>
              </select>
            </label>

            <p class="field-note">
              {current.hint} Adjust the radius until edges look crisp without halos or ripples
              appearing — those mean you have gone too far. Lower Strength if the result looks noisy.
            </p>
          </div>

          <div class="run clean-run">
            <button class="btn btn--primary" type="button" disabled={busy} onClick={run}>
              {busy ? `Deblurring… ${Math.round(progress * 100)}%` : 'Deblur'}
            </button>
            {out && (
              <>
                <button class="btn" type="button" onClick={() => setCompare((c) => !c)}>
                  {compare ? 'Show result' : 'Compare with original'}
                </button>
                <button class="btn" type="button" onClick={() => downloadBlob(out.blob, out.name)}>
                  Download
                </button>
              </>
            )}
          </div>
        </>
      )}

      {error && (
        <p class="error" role="alert">
          {error}
        </p>
      )}

      {(out || srcUrl) && (
        <div class="deblur-preview">
          <img
            class="deblur-preview__img"
            src={compare || !out ? (srcUrl ?? '') : out.url}
            alt={compare || !out ? 'Original' : 'Deblurred result'}
          />
          <p class="deblur-preview__caption">
            {out
              ? compare
                ? 'Original'
                : `Deblurred — ${out.width}×${out.height}, ${formatBytes(out.size)} · measured noise ${(out.noiseSigma * 255).toFixed(1)}/255`
              : 'Original — pick a blur type and press Deblur'}
          </p>
        </div>
      )}
    </section>
  )
}
