import { defineConfig, type Plugin } from 'vite'
import preact from '@preact/preset-vite'

// The privacy guarantee, enforced (not just promised): with `connect-src 'none'`
// the browser itself blocks any upload/fetch, so a bug can't leak a file.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'none'",
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
