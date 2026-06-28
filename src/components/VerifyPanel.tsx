export function VerifyPanel() {
  return (
    <details class="verify">
      <summary class="verify__summary">How do I know nothing is uploaded?</summary>
      <div class="verify__body">
        <ol>
          <li>
            Open your browser's <strong>Developer Tools</strong> (F12) and select the{' '}
            <strong>Network</strong> tab.
          </li>
          <li>Use any tool here on a file.</li>
          <li>
            Watch the Network tab — you'll see <strong>no upload requests</strong>. The file never
            leaves your device.
          </li>
        </ol>
        <p>
          It's not just a promise: this site ships a strict <code>Content-Security-Policy</code> with{' '}
          <code>connect-src 'none'</code>, so the browser itself <em>blocks</em> any network request.
          And it's open source —{' '}
          <a
            href="https://github.com/abidedavana/Scrubly"
            target="_blank"
            rel="noopener noreferrer"
          >
            read the code
          </a>
          .
        </p>
      </div>
    </details>
  )
}
