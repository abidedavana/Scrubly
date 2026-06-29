// Trust-critical check for Scrubly's "Clean" tool: prove that GPS/EXIF is actually
// removed from images and that identifying metadata is removed from PDFs.
//
// Runs in Node (no browser) against the same libraries the app uses. The JPEG
// fixture is produced in the browser once (a guaranteed-valid JPEG) and pasted in
// below, then geotagged here via piexif so we can prove the strip removes it.
//
//   node tests/metadata.check.mjs

import exifr from 'exifr'
import piexif from 'piexifjs'
import { PDFDocument, PDFName } from 'pdf-lib'

// A valid baseline JPEG (2x2, no metadata), generated in-browser via OffscreenCanvas.
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAZEAEBAQEBAQAAAAAAAAAAAAACAQADETH/xAAVAQEBAAAAAAAAAAAAAAAAAAAHCP/EABwRAAIABwAAAAAAAAAAAAAAAAABAgMEMjRysf/aAAwDAQACEQMRAD8Al3TouvRNqtq1JK+22/bbmZjiG1Ff0eNK1XD/2Q=='

let failures = 0
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg)
  else {
    console.error('  ✗', msg)
    failures++
  }
}

const b64ToBytes = (b64) => new Uint8Array(Buffer.from(b64, 'base64'))
const bytesToBin = (u8) => {
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return s
}
const binToBytes = (s) => {
  const u8 = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff
  return u8
}

async function testImage() {
  console.log('Image — JPEG GPS/EXIF:')
  const base = bytesToBin(b64ToBytes(JPEG_B64))
  const exifObj = {
    '0th': { [piexif.ImageIFD.Make]: 'TestMake', [piexif.ImageIFD.Model]: 'TestModel' },
    GPS: {
      [piexif.GPSIFD.GPSLatitudeRef]: 'N',
      [piexif.GPSIFD.GPSLatitude]: piexif.GPSHelper.degToDmsRational(37.7749),
      [piexif.GPSIFD.GPSLongitudeRef]: 'W',
      [piexif.GPSIFD.GPSLongitude]: piexif.GPSHelper.degToDmsRational(122.4194),
    },
  }
  const geotagged = binToBytes(piexif.insert(piexif.dump(exifObj), base))

  const before = await exifr.parse(geotagged, { gps: true })
  assert(before && typeof before.latitude === 'number', 'GPS present before strip')
  assert(before && before.Make === 'TestMake', 'camera make present before strip')

  // Same operation the app performs: piexif.remove on the JPEG.
  const cleaned = binToBytes(piexif.remove(bytesToBin(geotagged)))
  const after = await exifr.parse(cleaned, { gps: true })
  assert(!after || after.latitude === undefined, 'GPS removed after strip')
  assert(!after || after.Make === undefined, 'camera make removed after strip')
}

async function testPdf() {
  console.log('PDF — Info metadata:')
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.setTitle('Secret Title')
  doc.setAuthor('Jane Doe')
  doc.setProducer('Acrobat Pro')
  const bytes = await doc.save()

  const before = await PDFDocument.load(bytes, { updateMetadata: false })
  assert(before.getAuthor() === 'Jane Doe', 'author present before strip')
  assert(before.getTitle() === 'Secret Title', 'title present before strip')

  // Same operation the app performs.
  const doc2 = await PDFDocument.load(bytes, { updateMetadata: false })
  doc2.setTitle('')
  doc2.setAuthor('')
  doc2.setSubject('')
  doc2.setKeywords([])
  doc2.setCreator('')
  doc2.setProducer('')
  try {
    doc2.catalog.delete(PDFName.of('Metadata'))
  } catch {}
  const stripped = await doc2.save({ updateFieldAppearances: false })

  const after = await PDFDocument.load(stripped, { updateMetadata: false })
  assert(!after.getAuthor(), 'author removed after strip')
  assert(!after.getTitle(), 'title removed after strip')
  assert(!after.getProducer(), 'producer removed after strip')
}

async function main() {
  if (JPEG_B64 === '__FIXTURE__') {
    console.error('Fixture not set — paste a base64 JPEG into JPEG_B64.')
    process.exit(2)
  }
  await testImage()
  await testPdf()
  if (failures) {
    console.error(`\n${failures} check(s) FAILED`)
    process.exit(1)
  }
  console.log('\nAll metadata checks passed ✓')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
