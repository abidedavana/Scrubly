import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

// Part one of the privacy guarantee: `connect-src 'none'` stops the page from
// opening any network connection.
//
// Important caveat, verified rather than assumed: this policy does NOT cover
// workers loaded from a same-origin https: URL — those take their policy from
// their own response headers, and GitHub Pages sends none. Since the workers are
// where file bytes are actually handled, the policy alone was protecting the
// wrong thread. Two changes close that: `worker-src 'self' blob:` plus loading
// the worker inline (?worker&inline) so it is a blob: worker and DOES inherit
// this policy, and src/workers/net-lockdown.ts, which deletes the network APIs
// inside the worker so the guarantee does not rest on CSP inheritance at all
// (Firefox has historically not inherited it).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'none'",
  // blob: is required for inlined workers (ours, and heic2any's internal one,
  // which was silently CSP-blocked in production before this was added).
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

// Inject the strict CSP into the *built* HTML only. The dev server needs a
// websocket for HMR, which `connect-src 'none'` would block.
function injectCsp(): Plugin {
  return {
    name: 'scrubly-inject-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  base: '/Scrubly/',
  plugins: [preact(), injectCsp()],
  build: {
    target: 'es2022',
    // No inline scripts keeps the CSP free of 'unsafe-inline'/hashes.
    modulePreload: { polyfill: false },
  },
})
