# 🧼 Scrubly

**File tools that never see your files.**

Convert HEIC photos, compress and resize images, merge and split PDFs, and scrub
hidden metadata — all **100% in your browser**. No upload, no account, no catch.

🔗 **Live:** https://abidedavana.github.io/Scrubly/

---

## What it is

Scrubly is a free, open-source toolkit for the everyday file chores you'd normally
trust to a sketchy website — converting iPhone HEIC photos, compressing and resizing
images, merging and splitting PDFs, and stripping the hidden personal data (GPS
location, device info, author names) baked into your files.

Everything runs locally with WebAssembly, so your files never leave your device. And
because it's enforced in the browser, the privacy isn't a promise you have to trust —
it's something you can **verify**.

## Features

- 📷 **HEIC → JPG/PNG** — open those iPhone photos anywhere, instantly.
- 🗜️ **Compress, resize & convert images** — JPG, PNG, WebP, with a quality slider.
- 📄 **Merge & split PDFs** — combine, reorder, and extract pages.
- 🧹 **Clean before you share** — one click strips GPS location, device info, and other
  hidden metadata from photos and PDFs.
- 🔒 **Nothing is ever uploaded** — 100% in-browser, enforced by a strict
  Content-Security-Policy. Open DevTools and watch: zero network requests.
- 🆓 **Free & open source** — no account, no ads, no paywall. MIT licensed.

## Why you can trust it

1. Open DevTools (F12) → **Network** tab.
2. Use any tool on a file.
3. See **zero upload requests** — the file never leaves your device.

The site ships a strict `Content-Security-Policy` with `connect-src 'none'`, so the page
cannot open a network connection.

That alone is not enough, and it's worth being precise about why. A Web Worker loaded
from a normal same-origin URL **does not inherit the page's CSP** — it takes its policy
from its own HTTP response headers, and static hosts like GitHub Pages send none. Since
the workers are exactly where your file bytes are processed, the policy was guarding the
wrong thread. Two things fix it:

1. The file-handling workers are **loaded inline as `blob:` workers**, which *do* inherit
   the page policy.
2. `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `RTCPeerConnection` and
   `sendBeacon` are **deleted inside the worker** before any other code runs
   ([`net-lockdown.ts`](src/workers/net-lockdown.ts)). This doesn't depend on CSP
   inheritance — Firefox has historically not implemented it — so the guarantee holds
   regardless of engine.

There is no networking API left for the code that touches your file to call.

## Status

🚧 **Early development.** Live so far: the app shell, the privacy guarantee, the
deployment pipeline, the **Images** tool (convert / resize / compress in a Web
Worker, with batch + zip download), **HEIC → JPG/PNG** (Apple HEIC/HEIF decoded
in-browser via a lazy-loaded WASM decoder), and **Clean** (strip GPS/EXIF from photos
and metadata from PDFs, with a before/after proof). More tools are landing next. See
[`BUILD_PLAN.md`](BUILD_PLAN.md) for the roadmap and [`SPEC.md`](SPEC.md) for the
design.

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 0 | Scaffold, CSP, deploy pipeline | ✅ |
| 1 | Images: convert / resize / compress | ✅ |
| 2 | HEIC → JPG/PNG | ✅ |
| 3 | Clean: strip metadata | ✅ |
| 4 | PDF: merge / split | ⏳ |
| 5 | Polish & launch | ⏳ |

## Tech stack

Vite · TypeScript · Preact · Web Workers — static front-end, hosted free on GitHub
Pages. No server, no database, nothing to breach.

## Local development

```bash
npm install
npm run dev        # start the dev server
npm run build      # production build → dist/
npm run typecheck  # type-check without emitting
npm test           # verify metadata stripping actually removes GPS/EXIF + PDF metadata
```

## License

[MIT](LICENSE) © 2026 abidedavana. Third-party components are listed in
[NOTICE](NOTICE).
