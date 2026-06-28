export type ToolId = 'images' | 'heic' | 'clean' | 'pdf'

export interface Tool {
  id: ToolId
  label: string
  blurb: string
}

interface Props {
  tools: Tool[]
  active: ToolId
  onSelect: (id: ToolId) => void
}

export function TabNav({ tools, active, onSelect }: Props) {
  return (
    <nav class="tabnav" aria-label="File tools">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          class={`tab ${t.id === active ? 'tab--active' : ''}`}
          aria-current={t.id === active ? 'page' : undefined}
          onClick={() => onSelect(t.id)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  )
}
