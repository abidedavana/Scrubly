# Spec — Local File Studio (working title)

> A free, open-source, **100% in-browser** file utility. Nothing is ever uploaded.
> Leads with the two things privacy-first tools usually skip: **images** (especially HEIC) and **hidden metadata**.

## Naming (decide before launch — not blocking)
Candidates: **Scrubly**, **CleanShare**, **NoUpload**, **LocalFile**, **Sanctum**, **OffShore (offline)**. Placeholder used in docs: *Local File Studio*.

---

## 1. Principles (the product is these)
1. **The file never leaves the device.** No servers, no analytics, no third-party calls — at runtime, *zero* network requests after the page loads.
2. **The claim is verifiable, not promised.** A user can open DevTools → Network and watch nothing happen. We enforce it in code (CSP) so even a bug can't leak a file.
3. **Honest, no tricks.** No ads, no account, no "Pro" wall, no fake free trial. Every feature listed actually works; nothing is overpromised.
4. **Small and finished beats big and abandoned.** A tight v1 that's polished and shipped.

---

## 2. Non-negotiable constraints
- Pure front-end. Static assets only. Hostable on GitHub Pages at $0.
- **All third-party code self-hosted/bundled** — no runtime CDN, no remote fonts. (Required so the CSP below can be strict.)
- Heavy work runs in **Web Workers** so the UI never freezes; large WASM is **lazy-loaded** only when its tool is used.
- Works offline once loaded (bonus: ship a service worker → installable PWA, post-v1).

---

## 3. v1 feature set

### 3.1 Images — Convert / Resize / Compress  *(highest value, no giant WASM — build first)*
- **Convert** between JPG ⇄ PNG ⇄ WebP.
- **Resize** by max dimension / exact px / percentage, preserving aspect ratio; respect EXIF orientation.
- **Compress** with a quality slider and a live before/after size readout.
- **Batch**: drop many files, process all, download as a `.zip`.
- **Libraries / approach:**
  - Baseline: native `<canvas>` + `canvas.toBlob(type, quality)` — zero deps, covers convert/resize/basic compress.
  - Quality path: **jSquash** (`@jsquash/jpeg`, `@jsquash/png`, `@jsquash/webp`, `@jsquash/resize`) — the actual Squoosh WASM codecs (MozJPEG / OxiPNG / WebP). Much better size-at-quality than canvas. Run in a worker.
  - Decision: ship canvas baseline in Phase 1, swap encoders to jSquash once the flow works. Keep a single `encodeImage()` seam so the swap is local.
- **Edge cases:** huge images (cap canvas dimensions / warn), transparency (PNG/WebP keep alpha, JPG flattens to white — warn), animated formats out of scope for v1.

### 3.2 HEIC → JPG / PNG  *(the headline feature)*
- Decode Apple HEIC/HEIF and export JPG or PNG. Batch + zip download.
- **Why it matters:** browsers can't natively decode HEIC (it's HEVC, patent-encumbered) — this is *the* reason people hit sketchy sites. Owning this cleanly is the differentiator.
- **Library / approach:** a libheif-WASM wrapper — `heic-to` (modern) or `heic2any` / `libheif-js`. Pick one, wrap behind a `decodeHeic(file): ImageBitmap/Blob` seam.
  - The libheif WASM bundle is large (~2–3 MB). **Lazy-load it in a worker** only when the HEIC tool is first used. Show a one-time "loading decoder…" state.
  - After decode, reuse the same `encodeImage()` pipeline as §3.1 (so resize/quality come for free).
- **Edge cases:** multi-image HEIC (live photos / bursts) — export the primary image in v1, note others exist; 10/12-bit HDR HEIC — decode to 8-bit, acceptable for v1.

### 3.3 Clean — strip hidden metadata  *(the differentiator; lead the marketing with this)*
- **Images:** detect and show what's hidden ("⚠ This photo contains GPS location, camera model, timestamp"), then strip with one click.
  - **Read/inspect:** `exifr` (fast; reads EXIF, GPS, XMP, ICC). Used to *show* the user what's there — this transparency is the whole pitch.
  - **Strip — two modes:**
    - *Lossless* (default): `piexifjs` removes the EXIF block without re-encoding pixels → no quality loss.
    - *Bulletproof*: re-encode through canvas → drops **all** metadata categories, guaranteed clean (lossy).
  - Show a verifiable "before/after": re-run `exifr` on the output and display "0 metadata fields remaining."
- **PDFs:** clear document metadata — Title/Author/Subject/Keywords/Creator/Producer/CreationDate/ModDate **and** XMP — via `pdf-lib`. (Reworded from the original pitch: PDFs carry *metadata*, not a real "edit history" — that's an Office-doc thing, deliberately out of scope.)
- **Batch + zip.** Same drop-many flow.

### 3.4 PDF — Merge / Split
- **Merge:** drop multiple PDFs, reorder by drag, combine into one. `pdf-lib`.
- **Split:** select page ranges / extract pages → one or many output PDFs. `pdf-lib` for the cut; **`pdfjs-dist`** to render page thumbnails so users pick pages visually.
- **Edge cases:** encrypted/password PDFs (detect, prompt or refuse gracefully); very large PDFs (process in worker, show progress).

---

## 4. Deferred (v1.1+) — explicitly not in v1
- **PDF compress.** The honest hard one. Real compression = downsample/re-encode embedded images (à la Ghostscript). Options when we get to it:
  - *Lite (preferred):* extract images, downsample via canvas/jSquash, rebuild with pdf-lib — and **label it "lite," stating what it does**.
  - *Heavy:* Ghostscript-WASM — powerful but a large, fiddly bundle. Only if Lite underwhelms.
- PWA / offline install (service worker).
- More image formats (AVIF encode via jSquash, TIFF, animated WebP/GIF).
- PDF rotate / delete pages / reorder (cheap to add once merge/split exist).

---

## 5. Tech stack (committed)
| Concern | Choice | Why |
|---|---|---|
| Build | **Vite** | Fast dev, static output, first-class WASM + worker support |
| Language | **TypeScript** | Correctness + strong portfolio signal |
| UI | **Preact** + JSX | React ergonomics, ~4 KB, tiny bundle. *(Vanilla TS is the simpler fallback if you'd rather.)* |
| Styling | Plain CSS + custom properties | Light/dark via variables; no framework needed |
| Concurrency | **Web Workers** + **Comlink** | Keep UI responsive; Comlink makes worker calls read like async functions |
| Zip (batch download) | **client-zip** | Tiny, streaming, no-dep |
| Tests | **Vitest** (unit) + **Playwright** (1–2 e2e smokes) | Prove metadata-strip correctness; CV signal |

**Core libraries:** `pdf-lib`, `pdfjs-dist`, `exifr`, `piexifjs`, `@jsquash/*`, libheif wrapper (`heic-to`/`heic2any`).

---

## 6. Architecture
```
UI (Preact, main thread)
  └─ thin tool components: dropzone → options → run → preview → download
        │  (Comlink)
        ▼
Workers (one per heavy domain, WASM lazy-loaded inside)
  ├─ image.worker   → canvas/jSquash encode, resize, convert
  ├─ heic.worker    → libheif-wasm decode (loaded on first HEIC use)
  ├─ meta.worker    → exifr read, piexif/canvas strip, pdf-lib metadata clear
  └─ pdf.worker     → pdf-lib merge/split (+ pdfjs thumbnails on main thread)
```
- **Seams to keep swappable:** `encodeImage()`, `decodeHeic()`, `stripImageMeta()`, `readMeta()`. Encoders/decoders can change without touching UI.
- **Data flow:** `File` → `ArrayBuffer`/`ImageBitmap` → worker → result `Blob` → object URL for download. Nothing persisted; revoke URLs after download.
- **Lazy loading:** dynamic `import()` per tool so the HEIC/jSquash WASM isn't in the initial bundle. Initial load stays small; decoders fetch on demand from same-origin.

---

## 7. The privacy proof (this is the product's credibility — build it in, don't bolt it on)
1. **Strict CSP** via `<meta http-equiv="Content-Security-Policy">` (and headers where possible):
   `default-src 'self'; connect-src 'none'; img-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'`
   → `connect-src 'none'` means **the browser itself blocks any upload/fetch**. A bug *cannot* leak a file. This is the killer detail: the guarantee is enforced, not promised.
2. **"How to verify" panel:** plain-language steps — open DevTools → Network → use the tool → see zero requests. Plus "this whole app is static; read the source on GitHub."
3. **No analytics, no fonts-from-CDN, no telemetry.** Anything that would need `connect-src` is banned by design.
4. **After-strip proof:** re-scan cleaned files and show "0 metadata fields remaining" so cleaning is demonstrably real.

---

## 8. UX / information architecture
- **Single page**, tool cards / tabs: **Images** · **HEIC** · **Clean** · **PDF**.
- Each tool: large **drag-and-drop zone** (also click-to-pick, paste-to-add), **options panel**, **Run**, **preview** (before/after where it makes sense), **Download** (single file or zip for batches).
- **Always-visible privacy strip:** "Your files never leave this device — [verify]".
- States handled explicitly: empty, loading-decoder, processing (progress), success, error (bad/corrupt/encrypted file), unsupported format.
- **Accessible:** keyboard-operable dropzones, ARIA live region for progress/results, visible focus, prefers-color-scheme dark/light, responsive down to mobile.

---

## 9. Repo layout
```
/ (repo root)
├─ index.html                 # CSP meta lives here
├─ vite.config.ts             # base = "/<repo-name>/" for Pages
├─ package.json
├─ tsconfig.json
├─ public/                    # favicon, og image, static assets
├─ src/
│  ├─ main.tsx                # app shell, routing between tools
│  ├─ ui/                     # Dropzone, OptionsPanel, Preview, DownloadButton, PrivacyBar, VerifyPanel
│  ├─ tools/
│  │  ├─ images/             # convert/resize/compress UI
│  │  ├─ heic/
│  │  ├─ clean/
│  │  └─ pdf/                # merge, split
│  ├─ workers/
│  │  ├─ image.worker.ts
│  │  ├─ heic.worker.ts
│  │  ├─ meta.worker.ts
│  │  └─ pdf.worker.ts
│  ├─ lib/                    # encodeImage, decodeHeic, readMeta, stripMeta, zip helpers (the seams)
│  └─ styles/
├─ tests/                     # vitest unit + playwright e2e
├─ .github/workflows/deploy.yml
├─ README.md  LICENSE  NOTICE
```

---

## 10. Deployment
- **GitHub Pages via GitHub Actions** (`actions/configure-pages` → build → `actions/upload-pages-artifact` → `actions/deploy-pages`).
- Set Vite `base: "/<repo-name>/"` (or `"/"` + a custom domain via `CNAME`).
- Ship a "hello world" to Pages in Phase 0 so deploy is proven before features pile up.
- Note: GitHub Pages can't set HTTP response headers, so CSP rides in the `<meta>` tag (works for our needs). A custom domain on Cloudflare Pages/Netlify later could add real header-level CSP + COOP/COEP if we ever need cross-origin isolation for threads.

---

## 11. Testing
- **Vitest:** the correctness-critical bits — `stripImageMeta` actually removes GPS (assert `exifr` finds nothing after), PDF metadata cleared, convert/resize output dimensions/format correct.
- **Playwright:** 1–2 smoke flows — drop a fixture image → convert → download; drop a HEIC → get a JPG. Also assert **no network requests** during a run (Playwright can intercept) — doubles as a privacy regression test.

---

## 12. Licensing & attribution
- **Our code: MIT** (friendliest for a portfolio/open-source story).
- `NOTICE` file crediting third-party licenses: libheif (LGPL/MIT components), MozJPEG (BSD), OxiPNG, pdf-lib (MIT), pdf.js (Apache-2.0), exifr (MIT), Comlink (Apache-2.0). Verify each at integration time and list versions.

---

## 13. Explicit non-goals (say no on purpose)
- No server, no account, no cloud sync, no sharing links.
- No "edit history" claim for PDFs (not a real thing there).
- No PDF compress in v1 (it's v1.1, done honestly).
- No video/audio, no OCR, no animated-format editing in v1.
- No analytics or telemetry, ever.
