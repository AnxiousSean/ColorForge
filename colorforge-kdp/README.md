# ColorForge KDP

A browser-based studio for making coloring book interiors that pass Amazon KDP's print checks.
Everything runs on the client: no server, no upload limits.

## Status

- [x] Step 1: Scaffolding and the KDP math module (`lib/kdp.ts`), with unit tests
- [ ] Step 2: Dashboard, page manager, SVG editor (pen, eraser, symmetry), margin and bleed overlay
- [ ] Step 3: Vector PDF export engine
- [ ] Step 4: Preflight report, image-to-line-art tracing, polish

## Scripts

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # unit tests (Vitest)
npm run typecheck
npm run build
```
