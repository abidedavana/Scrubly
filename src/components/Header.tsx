const REPO_URL = 'https://github.com/abidedavana/Scrubly'

export function Header() {
  return (
    <header class="header">
      <div class="container header__inner">
        <span class="brand">
          <span class="brand__mark" aria-hidden="true">🧼</span>
          <span class="brand__name">Scrubly</span>
        </span>
        <p class="brand__tagline">File tools that never see your files.</p>
        <a class="header__gh" href={REPO_URL} target="_blank" rel="noopener noreferrer">
          GitHub ↗
        </a>
      </div>
    </header>
  )
}
