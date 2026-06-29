// Shared result shape for the image/HEIC conversion tools.
export interface ResultItem {
  id: string
  name: string
  originalSize: number
  size: number
  width: number
  height: number
  blob: Blob
  url: string
}
