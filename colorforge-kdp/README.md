# ColorForge KDP

A browser-based studio for publishing KDP-ready **coloring books, word search books and number
search books**, fast enough to ship one book a day. Everything runs on the client: no server, no
upload limits.

## Publishing decisions (built into the code)

| Decision | Choice | Why |
| --- | --- | --- |
| Bleed | **Off** by default for every book type | Line art and puzzle grids don't need it, and it rules out a whole class of rejections. Still available per book. |
| Margins | KDP minimums are the hard limit (error). Layout uses **recommended** margins: 0.5" from trim, plus 0.125" extra gutter (warning only if crossed). | Room for printer trim drift, reaching art near the spine, and grids clear of the binding. |
| Page limits | From KDP's trim-size table: 8.5" × 11" white 24–590, cream 24–550, standard colour 72–600, premium colour 24–590. | The first draft's 828 cap only applies to smaller trims. |
| Blank pages | Max 4 blank pages in a row mid-book and 10 at the end (KDP rule). Padding to 24 pages is automatic but never breaks this; below that, preflight asks for more content. | Padding a thin book with blanks gets rejected and draws bad reviews. |
| Single-sided | Coloring: ON (each design on a right-hand page, blank back). Puzzles: OFF (double-sided). | Marker bleed-through vs. page economy. |
| Answer key | Puzzle books get one automatically, starting on a right-hand page (6 per page for letter, 4 for square). | Readers expect it. |
| Reproducibility | Every book stores a seed and the same seed rebuilds the same puzzles. | Fixing a rejection or reprinting never changes content. |
| Fonts | Bundled OFL fonts (Atkinson Hyperlegible, Lora, Nunito) preview on screen and are converted to vector outlines in the PDF. | KDP requires embedded fonts; a PDF with no fonts at all cannot fail that check. |
| Spine text | Allowed from 80 pages. | KDP rule. |

## Roadmap

- [x] Step 1: Scaffolding, KDP math (`lib/kdp.ts`), book profiles and page planner (`lib/book-types.ts`),
      seeded word search and number search engine (`lib/puzzles/search-grid.ts`)
- [x] Step 2: Dashboard + "New book" wizard, IndexedDB autosave, page manager (drag-and-drop,
      blank-back toggles, spread view), SVG coloring editor (pen, line, rectangle, ellipse, polygon,
      text, white-paint eraser, shape eraser, symmetry/mandala, undo/redo, zoom), margin and bleed
      overlay with live margin warnings, puzzle editor, and puzzle / answer-key / title / copyright
      page renderers
- [x] Step 3: Vector PDF export. Pages render through svg2pdf.js + jsPDF and are finalized with pdf-lib
      (trim/bleed boxes, metadata, unused-font removal). Text is outlined with the bundled fonts, preflight
      blocks failing books, and the finished file is re-read and verified before download.
- [ ] Step 4: Preflight report, image-to-line-art tracing, cover wrap export, built-in themed word lists

## How it fits together

```
lib/         pure logic, unit-tested (no React)
  kdp.ts         book math: page sizes, bleed, margins, page sequencing, KDP rules
  book-types.ts  book profiles + planBook(): front matter, content, answer key
  model.ts       project / design / puzzle data model (art stored in trim-space inches)
  geometry.ts    smoothing, bounds, hit-testing, symmetry transforms
  layout.ts      where everything goes on puzzle, answer, title and copyright pages
  pages.ts       maps each physical page to what is drawn on it
  storage.ts     IndexedDB persistence
  fonts.ts       bundled fonts: exact metrics + text-to-outline
  preflight.ts   KDP checks that gate export
  export/        interior.ts (browser render pipeline), finalize.ts (pdf-lib boxes + verification)
  puzzles/       seeded word/number search engine + theme parsing
store/       Zustand: projects (autosave) and editor (tools, undo/redo)
components/  render/PageSvg.tsx is the single renderer for previews, thumbnails and (Step 3) PDF
app/         static routes: /, /book?id=, /book/edit?id=&item=
```

## Export pipeline

```
PageSvg (outlined text)  ->  svg2pdf.js  ->  jsPDF page (exact KDP size)
                                   x every page, vector only
pdf-lib: MediaBox/BleedBox/TrimBox per page, strip unused fonts, metadata
verify: page count, sizes, trim boxes, 0 fonts, 0 raster images, <= 650 MB
```

A 120-page large-print word search book exports in about 7 seconds (8 MB).

## Scripts

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (Vitest)
npm run typecheck
npm run build
```
