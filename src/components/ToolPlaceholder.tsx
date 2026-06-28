interface Props {
  label: string
  blurb: string
}

export function ToolPlaceholder({ label, blurb }: Props) {
  return (
    <section class="panel" aria-live="polite">
      <div class="dropzone dropzone--disabled">
        <p class="dropzone__title">{label}</p>
        <p class="dropzone__blurb">{blurb}</p>
        <span class="badge">Coming soon</span>
      </div>
    </section>
  )
}
