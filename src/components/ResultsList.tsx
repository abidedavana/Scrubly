import type { ResultItem } from '../lib/convert-types'
import { downloadAllZip, downloadBlob, formatBytes } from '../lib/files'

interface Props {
  results: ResultItem[]
  zipName: string
}

export function ResultsList({ results, zipName }: Props) {
  if (results.length === 0) return null
  return (
    <div class="results">
      <div class="results__head">
        <h2>
          Done — {results.length} file{results.length > 1 ? 's' : ''}
        </h2>
        {results.length > 1 && (
          <button
            class="btn btn--primary"
            type="button"
            onClick={() =>
              downloadAllZip(
                results.map((r) => ({ name: r.name, input: r.blob })),
                zipName,
              )
            }
          >
            Download all (.zip)
          </button>
        )}
      </div>
      <ul class="results__list">
        {results.map((r) => {
          const pct = r.originalSize > 0 ? Math.round((1 - r.size / r.originalSize) * 100) : 0
          return (
            <li class="result" key={r.id}>
              <img class="result__thumb" src={r.url} alt="" loading="lazy" />
              <div class="result__meta">
                <span class="result__name">{r.name}</span>
                <span class="result__sizes">
                  {formatBytes(r.originalSize)} → {formatBytes(r.size)}{' '}
                  <em class={pct >= 0 ? 'good' : 'bad'}>{pct >= 0 ? `−${pct}%` : `+${-pct}%`}</em> ·{' '}
                  {r.width}×{r.height}
                </span>
              </div>
              <button class="btn" type="button" onClick={() => downloadBlob(r.blob, r.name)}>
                Download
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
