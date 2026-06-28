# Build plan — Local File Studio

Companion to [SPEC.md](SPEC.md). Ordered to **de-risk early**: prove deployment first, then ship the highest-value / lowest-WASM features before the heavy ones. Each phase ends with something working and deployed.

**Guiding rule:** keep `main` deployable at all times. Every phase is a real, usable increment.

---

## Phase 0 — Scaffold & prove deployment *(do this first, end-to-end)*
**Goal:** an empty-but-real app live on GitHub Pages with the privacy guarantee already enforced.
- [ ] `npm create vite@latest` → Preact + TypeScript. `git init`, first commit.
- [ ] App shell: header, tab nav (Images / HEIC / Clean / PDF as empty placeholders), footer.
- [ ] `PrivacyBar` + `VerifyPanel` ("how to confirm nothing uploads").
- [ ] Add the **strict CSP** `<meta>` to `index.html` (see SPEC §7). Confirm the app still loads with `connect-src 'none'`.
- [ ] Set `base` in `vite.config.ts`. Add `.github/workflows/deploy.yml` (build → upload-pages-artifact → deploy-pages).
- [ ] Push → confirm it's **live on Pages**. Drop in MIT `LICENSE`, stub `README`, `NOTICE`.

**Done when:** the live URL loads, tabs switch, DevTools→Network shows nothing beyond same-origin static assets.

---

## Phase 1 — Images: convert / resize / compress *(highest value, no big WASM)*
**Goal:** the everyday image tool, fully working, batch + zip.
- [ ] `Dropzone` (drag-drop, click, paste; multi-file), `OptionsPanel`, `Preview` (before/after + size), `DownloadButton`.
- [ ] `image.worker.ts` + Comlink. `encodeImage()` seam — **canvas baseline first** (`toBlob`), convert/resize/quality.
- [ ] Respect EXIF orientation on load. Transparency warnings (JPG flatten).
- [ ] Batch → `client-zip` download.
- [ ] Swap encoders to **jSquash** (`@jsquash/jpeg|png|webp|resize`) behind the same seam; compare size/quality, keep the better path.
- [ ] Vitest: output format + dimensions correct.

**Done when:** drop mixed images → convert/resize/compress → download single or zip; UI never freezes on large files.

---

## Phase 2 — HEIC → JPG / PNG *(headline feature)*
**Goal:** the thing people google sketchy sites for.
- [ ] `heic.worker.ts`: integrate libheif wrapper (`heic-to` / `heic2any` / `libheif-js`), behind `decodeHeic()` seam.
- [ ] **Lazy-load** the WASM only on first HEIC use; "loading decoder…" state.
- [ ] Pipe decoded image into the Phase-1 `encodeImage()` pipeline (resize/quality reused for free).
- [ ] Batch + zip. Handle multi-image HEIC (export primary, note extras).
- [ ] Smoke test with real iPhone HEIC fixtures.

**Done when:** drop HEIC(s) → get JPG/PNG; initial page bundle stays small (WASM loads on demand).

---

## Phase 3 — Clean: strip metadata *(the differentiator — market with this)*
**Goal:** show people the hidden data, then remove it, verifiably.
- [ ] `meta.worker.ts`. `readMeta()` via **exifr** → render "what's hidden" (GPS, camera, timestamp, XMP).
- [ ] `stripImageMeta()`: **lossless** (`piexifjs`) default + **bulletproof** (canvas re-encode) option.
- [ ] **After-strip proof:** re-run `exifr`, show "0 metadata fields remaining."
- [ ] PDF metadata clear via `pdf-lib` (Info dict + XMP).
- [ ] Batch + zip.
- [ ] Vitest: GPS present before → absent after (image **and** PDF). This is the trust-critical test.

**Done when:** a real geotagged photo shows its location, one click removes it, and the re-scan proves it's gone.

---

## Phase 4 — PDF: merge / split
**Goal:** the PDF basics, no server.
- [ ] `pdf.worker.ts` with `pdf-lib`. **Merge:** multi-drop + drag-reorder → combine.
- [ ] **Split:** page-range selection; `pdfjs-dist` thumbnails for visual page picking; export one or many.
- [ ] Detect encrypted PDFs → graceful message. Progress for large files.
- [ ] Vitest: merged page count = sum; split ranges correct.

**Done when:** merge several PDFs into one (reordered) and split a PDF by pages, all in-browser.

---

## Phase 5 — Polish & launch
**Goal:** make it feel finished and tell the story.
- [ ] Empty/loading/error/unsupported states for every tool; friendly copy.
- [ ] Accessibility pass (keyboard, ARIA live regions, focus, contrast); responsive/mobile.
- [ ] Dark/light via `prefers-color-scheme`.
- [ ] Playwright smokes incl. **"no network during processing"** assertion (privacy regression guard).
- [ ] **README**: the privacy story, screenshots/GIF, "how to verify no uploads," tech stack, local-dev steps. `NOTICE` finalized with versions.
- [ ] Pick the real name + favicon + OG image. Tag **v1.0**, announce.

**Done when:** a stranger can use every tool without confusion, and the README sells the "I built the file tool that never sees your files" story.

---

## v1.1 — PDF compress (honest)
- [ ] *Lite:* extract embedded images → downsample via canvas/jSquash → rebuild with `pdf-lib`. **Label it "lite," state what it does.**
- [ ] Only escalate to Ghostscript-WASM if Lite underwhelms (large bundle — measure first).

---

## Sequencing rationale (why this order)
- **Phase 0 first** so deployment + CSP are never a late surprise.
- **Images before HEIC** because they share the `encodeImage()` pipeline and need no giant WASM — HEIC then becomes "decode + reuse."
- **Clean after the image pipeline** because the canvas re-encode strip reuses it.
- **PDF last among features** — independent of the image pipeline, easy to slot in.
- Each phase is independently shippable, so you can stop after any phase with a real, usable, CV-worthy tool.

## Definition of done (whole project)
Live on Pages · zero runtime network calls (CSP-enforced + Playwright-verified) · every listed feature works on real files · README tells the story · MIT + NOTICE in place.
