import { downloadZip } from 'client-zip'

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

/** Swap a filename's extension, e.g. photo.png + "jpg" → photo.jpg */
export function replaceExt(name: string, ext: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base}.${ext}`
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadAllZip(
  entries: { name: string; input: Blob }[],
  zipName: string,
): Promise<void> {
  const blob = await downloadZip(entries).blob()
  downloadBlob(blob, zipName)
}
