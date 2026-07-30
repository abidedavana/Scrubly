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
          It's not just a promise. This site ships a strict <code>Content-Security-Policy</code> with{' '}
          <code>connect-src 'none'</code>, which stops the page opening any connection. That policy
          does not automatically cover Web Workers, which are where your file is actually processed —
          so the workers are loaded inline (making them inherit it) <em>and</em> the network APIs
          (<code>fetch</code>, <code>XMLHttpRequest</code>, <code>WebSocket</code>) are deleted inside
          them at startup. There is no networking function left for the file-handling code to call.
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
