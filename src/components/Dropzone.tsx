import { useRef, useState } from 'preact/hooks'

interface Props {
  accept?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
  title?: string
  hint?: string
}

export function Dropzone({
  accept = 'image/*',
  multiple = true,
  onFiles,
  title = 'Drop files here',
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  function emit(list: FileList | null) {
    if (!list || list.length === 0) return
    onFiles(Array.from(list))
  }

  return (
    <div
      class={`dz ${over ? 'dz--over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        emit(e.dataTransfer?.files ?? null)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const el = e.target as HTMLInputElement
          emit(el.files)
          el.value = '' // allow re-selecting the same file
        }}
      />
      <p class="dz__title">{title}</p>
      {hint && <p class="dz__hint">{hint}</p>}
      <p class="dz__or">or click to browse</p>
    </div>
  )
}
