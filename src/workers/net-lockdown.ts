// Defence in depth for the threads that actually touch user files.
//
// Why this exists: the page's Content-Security-Policy does NOT reliably govern
// Web Workers. A worker loaded from a same-origin https: URL takes its policy
// from its own response headers, and GitHub Pages sends none — so `connect-src
// 'none'` on the document leaves the worker completely unpoliced. Verified in
// Chrome: under our production CSP, fetch() from the page is blocked while
// fetch() from the worker succeeds and can read a response body.
//
// Shipping the worker as a blob: worker makes it inherit the document policy in
// Chromium, but Firefox has historically not inherited CSP into workers
// (w3c/webappsec-csp#336), so inheritance alone is not something to rely on.
// This module removes the network primitives outright, which depends on no
// engine's goodwill: there is no API left to call, so no code path — ours or a
// dependency's — can send a file anywhere.
//
// Import this FIRST, before anything else, in every worker that handles files.

const REMOVED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'RTCPeerConnection',
  'webkitRTCPeerConnection',
  'importScripts',
  'Request',
  'Response',
] as const

function blocked(name: string): () => never {
  return () => {
    throw new Error(
      `Scrubly: ${name} is disabled in this worker — files are never sent anywhere.`,
    )
  }
}

export function lockdownNetwork(): void {
  const g = globalThis as unknown as Record<string, unknown>

  for (const name of REMOVED) {
    if (!(name in g)) continue
    try {
      Object.defineProperty(g, name, {
        value: blocked(name),
        writable: false,
        configurable: false,
      })
    } catch {
      // Non-configurable in this engine — fall back to a plain overwrite.
      try {
        g[name] = blocked(name)
      } catch {
        /* nothing more we can do; the blob:-worker CSP is the backstop */
      }
    }
  }

  // sendBeacon lives on the worker's navigator and is a classic exfil path.
  try {
    const nav = (globalThis as unknown as { navigator?: Record<string, unknown> }).navigator
    if (nav && typeof nav.sendBeacon === 'function') {
      Object.defineProperty(nav, 'sendBeacon', {
        value: blocked('navigator.sendBeacon'),
        writable: false,
        configurable: false,
      })
    }
  } catch {
    /* ignore */
  }
}

lockdownNetwork()
