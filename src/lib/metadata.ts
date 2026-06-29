// Pure (DOM-free) metadata read/strip helpers so the privacy-critical logic can be
// unit-checked outside the browser. The browser layer (CleanTool) wraps these with
// File/Blob handling and routes non-JPEG images through the canvas re-encode worker.

export interface ImageMetaSummary {
  hasAny: boolean
  gps: { lat: number; lng: number } | null
  camera: string | null
  software: string | null
  takenAt: string | null
  /** Count of other notable EXIF/XMP fields present. */
  otherCount: number
}

export interface PdfMetaSummary {
  hasAny: boolean
  title: string | null
  author: string | null
  subject: string | null
  keywords: string | null
  creator: string | null
  producer: string | null
  hasXmp: boolean
}

const PRIMARY_KEYS = new Set([
  'latitude',
  'longitude',
  'GPSLatitude',
  'GPSLongitude',
  'Make',
  'Model',
  'Software',
  'DateTimeOriginal',
  'CreateDate',
])

export async function readImageMeta(bytes: Uint8Array): Promise<ImageMetaSummary> {
  const { default: exifr } = await import('exifr')
  let data: Record<string, unknown> | undefined
  try {
    data = await exifr.parse(bytes, { gps: true, xmp: true, iptc: true, tiff: true })
  } catch {
    data = undefined
  }
  if (!data) {
    return { hasAny: false, gps: null, camera: null, software: null, takenAt: null, otherCount: 0 }
  }

  const lat = typeof data.latitude === 'number' ? data.latitude : null
  const lng = typeof data.longitude === 'number' ? data.longitude : null
  const make = typeof data.Make === 'string' ? data.Make.trim() : ''
  const model = typeof data.Model === 'string' ? data.Model.trim() : ''
  const camera = make || model ? `${make} ${model}`.trim() : null
  const software = typeof data.Software === 'string' ? data.Software : null
  const taken = data.DateTimeOriginal ?? data.CreateDate
  const takenAt = taken ? String(taken) : null

  const otherCount = Object.keys(data).filter((k) => !PRIMARY_KEYS.has(k)).length
  const hasAny = !!(lat !== null || camera || software || takenAt || otherCount > 0)

  return {
    hasAny,
    gps: lat !== null && lng !== null ? { lat, lng } : null,
    camera,
    software,
    takenAt,
    otherCount,
  }
}

function bytesToBinaryString(u8: Uint8Array): string {
  let s = ''
  const chunk = 0x8000
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)))
  }
  return s
}

function binaryStringToBytes(s: string): Uint8Array {
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff
  return u8
}

/** Losslessly remove the EXIF block (incl. GPS) from a JPEG. Does not re-encode pixels. */
export async function stripJpegExif(bytes: Uint8Array): Promise<Uint8Array> {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) {
    throw new Error('Not a JPEG image.')
  }
  const { default: piexif } = await import('piexifjs')
  const cleaned = piexif.remove(bytesToBinaryString(bytes))
  return binaryStringToBytes(cleaned)
}

export async function readPdfMeta(bytes: Uint8Array): Promise<PdfMetaSummary> {
  const { PDFDocument, PDFName } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const str = (v: string | undefined) => (v && v.length ? v : null)
  const title = str(doc.getTitle())
  const author = str(doc.getAuthor())
  const subject = str(doc.getSubject())
  const keywords = str(doc.getKeywords())
  const creator = str(doc.getCreator())
  const producer = str(doc.getProducer())
  const hasXmp = !!doc.catalog.get(PDFName.of('Metadata'))
  const hasAny = !!(title || author || subject || keywords || creator || producer || hasXmp)
  return { hasAny, title, author, subject, keywords, creator, producer, hasXmp }
}

/** Clear identifying document metadata (Info dict text fields + XMP stream). */
export async function stripPdfMetadata(bytes: Uint8Array): Promise<Uint8Array> {
  const { PDFDocument, PDFName } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  doc.setTitle('')
  doc.setAuthor('')
  doc.setSubject('')
  doc.setKeywords([])
  doc.setCreator('')
  doc.setProducer('')
  // Remove the XMP metadata stream from the document catalog.
  try {
    doc.catalog.delete(PDFName.of('Metadata'))
  } catch {
    /* no XMP present */
  }
  return doc.save({ updateFieldAppearances: false })
}
