import { useState } from 'preact/hooks'
import { Dropzone } from '../../components/Dropzone'
import {
  readImageMeta,
  readPdfMeta,
  stripJpegExif,
  stripPdfMetadata,
  type ImageMetaSummary,
  type PdfMetaSummary,
} from '../../lib/metadata'
import { encodeImages } from '../../lib/image'
import { bytesToBlob, downloadAllZip, downloadBlob } from '../../lib/files'

type Kind = 'image' | 'pdf'

interface Entry {
  id: string
  file: File
  kind: Kind
  scanning: boolean
  meta: ImageMetaSummary | PdfMetaSummary | null
  cleaned: { blob: Blob; url: string; size: number; ok: boolean } | null
  error: string | null
}

let seq = 0

function classify(file: File): Kind | null {
  const t = file.type.toLowerCase()
  if (t === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf'
  if (
    t === 'image/jpeg' ||
    t === 'image/png' ||
    t === 'image/webp' ||
    /\.(jpe?g|png|webp)$/i.test(file.name)
  ) {
    return 'image'
  }
  return null
}

function imageFindings(m: ImageMetaSummary): string[] {
  const f: string[] = []
  if (m.gps) f.push(`📍 GPS location (${m.gps.lat.toFixed(4)}, ${m.gps.lng.toFixed(4)})`)
  if (m.camera) f.push(`📷 ${m.camera}`)
  if (m.takenAt) f.push(`🕓 ${m.takenAt}`)
  if (m.software) f.push(`🛠 ${m.software}`)
  if (m.otherCount > 0) f.push(`+${m.otherCount} more field${m.otherCount > 1 ? 's' : ''}`)
  return f
}

function pdfFindings(m: PdfMetaSummary): string[] {
  const f: string[] = []
  if (m.author) f.push(`👤 Author: ${m.author}`)
  if (m.title) f.push(`📄 Title: ${m.title}`)
  if (m.creator) f.push(`🛠 Creator: ${m.creator}`)
  if (m.producer) f.push(`🛠 Producer: ${m.producer}`)
  if (m.subject) f.push(`📝 ${m.subject}`)
  if (m.keywords) f.push(`🏷 ${m.keywords}`)
  if (m.hasXmp) f.push('📦 XMP metadata')
  return f
}

export function CleanTool() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [busy, setBusy] = useState(false)

  function update(id: string, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)))
  }

  async function scan(entry: Entry) {
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer())
      const meta = entry.kind === 'pdf' ? await readPdfMeta(bytes) : await readImageMeta(bytes)
      update(entry.id, { meta, scanning: false })
    } catch {
      update(entry.id, { scanning: false, error: 'Could not read this file.' })
    }
  }

  function addFiles(incoming: File[]) {
    const next: Entry[] = []
    for (const file of incoming) {
      const kind = classify(file)
      if (!kind) continue
      next.push({ id: `f${seq++}`, file, kind, scanning: true, meta: null, cleaned: null, error: null })
    }
    if (!next.length) return
    setEntries((prev) => [...prev, ...next])
    next.forEach(scan)
  }

  function reset() {
    setEntries((prev) => {
      prev.forEach((e) => e.cleaned && URL.revokeObjectURL(e.cleaned.url))
      return []
    })
  }

  async function cleanOne(entry: Entry): Promise<void> {
    const bytes = new Uint8Array(await entry.file.arrayBuffer())
    let blob: Blob
    if (entry.kind === 'pdf') {
      blob = bytesToBlob(await stripPdfMetadata(bytes), 'application/pdf')
    } else {
      const t = entry.file.type.toLowerCase()
      if (t === 'image/jpeg' || /\.jpe?g$/i.test(entry.file.name)) {
        blob = bytesToBlob(await stripJpegExif(bytes), 'image/jpeg')
      } else {
        // PNG/WebP carry metadata in chunks — re-encode through the canvas worker to drop it.
        const fmt = t === 'image/webp' ? 'image/webp' : 'image/png'
        const [enc] = await encodeImages([entry.file], { format: fmt, quality: 0.95 })
        blob = enc.blob
      }
    }
    // Proof: re-read the cleaned output and confirm nothing notable remains.
    const outBytes = new Uint8Array(await blob.arrayBuffer())
    const after = entry.kind === 'pdf' ? await readPdfMeta(outBytes) : await readImageMeta(outBytes)
    update(entry.id, {
      cleaned: { blob, url: URL.createObjectURL(blob), size: blob.size, ok: !after.hasAny },
    })
  }

  async function cleanAll() {
    setBusy(true)
    try {
      for (const e of entries) {
        if (!e.cleaned && !e.error) {
          await cleanOne(e).catch(() => update(e.id, { error: 'Could not clean this file.' }))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const cleanedEntries = entries.filter((e) => e.cleaned)
  const anyToClean = entries.some((e) => !e.cleaned && !e.error)

  return (
    <section class="panel">
      <Dropzone
        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
        multiple
        onFiles={addFiles}
        title={entries.length ? 'Drop more files or click' : 'Drop images or PDFs to clean'}
        hint="See the hidden data in your photos and PDFs — GPS location, device, author — then remove it with one click. All on your device."
      />

      {entries.length > 0 && (
        <>
          <div class="filebar">
            <span>
              {entries.length} file{entries.length > 1 ? 's' : ''}
            </span>
            <button class="btn btn--ghost" type="button" onClick={reset}>
              Clear
            </button>
          </div>

          <ul class="entries">
            {entries.map((e) => {
              const findings = e.meta
                ? e.kind === 'pdf'
                  ? pdfFindings(e.meta as PdfMetaSummary)
                  : imageFindings(e.meta as ImageMetaSummary)
                : []
              return (
                <li class="entry" key={e.id}>
                  <div class="entry__main">
                    <span class="entry__name">{e.file.name}</span>
                    {e.scanning && <span class="entry__note">Scanning…</span>}
                    {e.error && <span class="entry__note entry__note--err">{e.error}</span>}
                    {!e.scanning && !e.error && e.meta && (
                      <span class="findings">
                        {e.cleaned ? (
                          <span class={`chip ${e.cleaned.ok ? 'chip--ok' : 'chip--warn'}`}>
                            {e.cleaned.ok ? '✓ Cleaned — no metadata remaining' : '✓ Cleaned'}
                          </span>
                        ) : findings.length ? (
                          findings.map((f, i) => (
                            <span class="chip chip--warn" key={i}>
                              {f}
                            </span>
                          ))
                        ) : (
                          <span class="chip chip--ok">No hidden metadata found</span>
                        )}
                      </span>
                    )}
                  </div>
                  {e.cleaned && (
                    <button
                      class="btn"
                      type="button"
                      onClick={() => downloadBlob(e.cleaned!.blob, e.file.name)}
                    >
                      Download
                    </button>
                  )}
                </li>
              )
            })}
          </ul>

          <div class="run clean-run">
            {anyToClean && (
              <button class="btn btn--primary" type="button" disabled={busy} onClick={cleanAll}>
                {busy ? 'Cleaning…' : 'Clean all'}
              </button>
            )}
            {cleanedEntries.length > 1 && (
              <button
                class="btn"
                type="button"
                onClick={() =>
                  downloadAllZip(
                    cleanedEntries.map((e) => ({ name: e.file.name, input: e.cleaned!.blob })),
                    'scrubly-cleaned.zip',
                  )
                }
              >
                Download all (.zip)
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
