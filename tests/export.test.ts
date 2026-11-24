import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { finalizeInterior, interiorFilename, verifyInterior, type PageGeometry } from "@/lib/export/finalize";
import { getFont, missingGlyphs, registerFonts, textToPathData } from "@/lib/fonts";
import { getPageContext, layoutPuzzlePage } from "@/lib/layout";
import { isRectInside } from "@/lib/kdp";
import { createDesign, createProject, type Shape } from "@/lib/model";
import { runPreflight } from "@/lib/preflight";
import { buildPuzzleItems, parseThemes, STARTER_THEMES } from "@/lib/puzzles/themes";
import { measureText } from "@/lib/text-metrics";

beforeAll(() => {
  const dir = path.resolve(__dirname, "../public/fonts");
  const buffers: Record<string, ArrayBuffer> = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".woff"))) {
    const b = fs.readFileSync(path.join(dir, f));
    buffers[f.replace(".woff", "")] = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  registerFonts(buffers);
});

const glyphs = (t: string) => missingGlyphs(t);
const SETTINGS = { rows: 15, cols: 15, difficulty: "medium" as const, entriesPerPuzzle: 20 };

describe("fonts", () => {
  it("measures with real metrics once loaded", () => {
    const narrow = measureText("iiii", 1);
    const wide = measureText("WWWW", 1);
    expect(wide).toBeGreaterThan(narrow * 2);
    expect(measureText("TITLE", 1, "sans", 700)).toBeGreaterThan(measureText("TITLE", 1, "sans", 400));
  });

  it("outlines text into path data, centred on request", () => {
    const d = textToPathData("A", 1, 2, 0.5, "sans", 400, "middle");
    expect(d).toMatch(/^M[\d.-]+/);
    expect(d).not.toContain("NaN");
    const xs = [...d.matchAll(/[ML](-?[\d.]+)/g)].map((m) => Number(m[1]));
    const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(mid).toBeCloseTo(1, 1);
  });

  it("finds characters that the fonts cannot draw", () => {
    expect(glyphs("Café © 2026 – Puzzles")).toEqual([]);
    expect(glyphs("日本")).toEqual(["日", "本"]);
    expect(getFont("rounded", 700).names.fontFamily?.en).toBe("Nunito");
  });

  it("keeps puzzle pages inside the margins with real metrics", () => {
    const ctx = getPageContext("square", false, 120, 3);
    const l = layoutPuzzlePage({ rows: 15, cols: 15 }, Array(20).fill("STRAWBERRY"), "100. A Very Long Puzzle Title Indeed", ctx.recommended);
    expect(measureText(l.title.text, l.title.size, "sans", 700)).toBeLessThanOrEqual(ctx.recommended.widthIn + 1e-9);
    const gridRect = { xIn: l.grid.x, yIn: l.grid.y, widthIn: l.grid.cell * 15, heightIn: l.grid.cell * 15 };
    expect(isRectInside(gridRect, ctx.recommended)).toBe(true);
  });
});

describe("preflight", () => {
  const withFonts = { missingGlyphs: (t: string) => missingGlyphs(t) };

  function puzzleBook(count: number) {
    const { items } = buildPuzzleItems({ type: "word-search", settings: SETTINGS, bookSeed: "pf", puzzleCount: count, themes: parseThemes(STARTER_THEMES) });
    return createProject({ type: "word-search", title: "Word Search", author: "A. Author", puzzleSettings: SETTINGS, items });
  }

  const statusOf = (report: ReturnType<typeof runPreflight>, id: string) => report.checks.find((c) => c.id === id)?.status;

  it("passes a complete 100-puzzle book", () => {
    const report = runPreflight(puzzleBook(100), withFonts);
    expect(report.canExport).toBe(true);
    expect(report.checks.every((c) => c.status === "pass")).toBe(true);
    expect(report.pageCount).toBe(120);
  });

  it("blocks export without fonts and for too-short books", () => {
    expect(runPreflight(puzzleBook(100)).canExport).toBe(false);
    const short = runPreflight(puzzleBook(6), withFonts);
    expect(statusOf(short, "page-count")).toBe("fail");
    expect(short.canExport).toBe(false);
  });

  it("counts empty coloring designs as blank pages", () => {
    // 12 empty designs + backs = 24 blank pages in a row.
    const project = createProject({ type: "coloring", title: "C", author: "A", items: Array.from({ length: 12 }, (_, i) => createDesign(`D${i}`)) });
    const report = runPreflight(project, withFonts);
    expect(statusOf(report, "blank-pages")).toBe("fail");
  });

  it("fails art outside the KDP margin without bleed, but only warns with bleed", () => {
    const line = (x1: number, x2: number): Shape => ({ type: "path", id: "s", points: [x1, 5, x2, 5], strokeWidth: 0.03 });
    const designs = Array.from({ length: 12 }, (_, i) => ({ ...createDesign(`D${i}`), shapes: [line(2, 6)] }));
    designs[0]!.shapes.push(line(0.05, 1)); // too close to the edge
    const project = createProject({ type: "coloring", title: "C", author: "A", items: designs });
    const report = runPreflight(project, withFonts);
    expect(statusOf(report, "margins")).toBe("fail");
    expect(report.checks.find((c) => c.id === "margins")!.pages).toEqual([3]);
    expect(runPreflight({ ...project, hasBleed: true }, withFonts).canExport).toBe(true);
  });

  it("warns about hairlines and missing glyphs", () => {
    const designs = Array.from({ length: 12 }, (_, i) => ({
      ...createDesign(`D${i}`),
      shapes: [{ type: "path", id: "s", points: [2, 5, 6, 5], strokeWidth: 0.005 } as Shape],
    }));
    const report = runPreflight(createProject({ type: "coloring", title: "Ünïcode 日本", author: "A", items: designs }), withFonts);
    expect(statusOf(report, "line-weight")).toBe("warn");
    expect(statusOf(report, "fonts")).toBe("warn");
    expect(report.canExport).toBe(true);
  });

  it("fails puzzles with two possible answers", () => {
    const project = puzzleBook(100);
    const first = project.items[0]!;
    if (first.kind === "puzzle") first.puzzle = { ...first.puzzle!, ambiguous: [first.entries[0]!] };
    expect(statusOf(runPreflight(project, withFonts), "puzzles")).toBe("fail");
  });
});

describe("finalize and verify", () => {
  function geometry(pages: number, bleed: boolean): PageGeometry[] {
    return Array.from({ length: pages }, (_, i) => {
      const ctx = getPageContext("letter", bleed, pages, i + 1);
      return { page: ctx.page, trim: ctx.trim };
    });
  }

  async function fakeRender(g: PageGeometry[], opts: { font?: boolean; image?: boolean } = {}) {
    const doc = await PDFDocument.create();
    const font = opts.font ? await doc.embedFont(StandardFonts.Helvetica) : null;
    for (const p of g) {
      const page = doc.addPage([p.page.widthPt, p.page.heightPt]);
      page.drawLine({ start: { x: 50, y: 50 }, end: { x: 200, y: 200 }, thickness: 2 });
      if (font) page.drawText("hello", { x: 50, y: 300, font, size: 12 });
    }
    if (opts.image) {
      // 1×1 PNG
      const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const img = await doc.embedPng(png);
      doc.getPage(0).drawImage(img, { x: 10, y: 10, width: 10, height: 10 });
    }
    return doc.save();
  }

  it("sets trim boxes with bleed on the outside edge only", async () => {
    const g = geometry(24, true);
    const bytes = await finalizeInterior(await fakeRender(g), g, { title: "T", author: "A" });
    const doc = await PDFDocument.load(bytes);
    const [p1, p2] = doc.getPages();
    expect(p1!.getMediaBox()).toEqual({ x: 0, y: 0, width: 621, height: 810 });
    // Recto: gutter (no bleed) on the left -> trim starts at x=0.
    expect(p1!.getTrimBox()).toEqual({ x: 0, y: 9, width: 612, height: 792 });
    // Verso: gutter on the right -> trim starts after the left bleed.
    expect(p2!.getTrimBox()).toEqual({ x: 9, y: 9, width: 612, height: 792 });
    expect(doc.getTitle()).toBe("T");
    expect((await verifyInterior(bytes, g)).ok).toBe(true);
  });

  it("removes font objects and passes verification", async () => {
    const g = geometry(24, false);
    const raw = await fakeRender(g, { font: true });
    expect((await verifyInterior(raw, g)).checks.find((c) => c.label === "Fonts")!.ok).toBe(false);
    const bytes = await finalizeInterior(raw, g, { title: "T", author: "A" });
    const v = await verifyInterior(bytes, g);
    expect(v.checks.find((c) => c.label === "Fonts")!.ok).toBe(true);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPage(0).node.Resources()?.get(PDFName.of("Font"))).toBeUndefined();
  });

  it("flags raster images, wrong page counts and wrong sizes", async () => {
    const g = geometry(24, false);
    const withImage = await finalizeInterior(await fakeRender(g, { image: true }), g, { title: "T", author: "A" });
    expect((await verifyInterior(withImage, g)).checks.find((c) => c.label === "Vector artwork")!.ok).toBe(false);

    const ok = await finalizeInterior(await fakeRender(g), g, { title: "T", author: "A" });
    const v = await verifyInterior(ok, geometry(26, false));
    expect(v.checks.find((c) => c.label === "Page count")!.ok).toBe(false);
    const wrongSize = await verifyInterior(ok, geometry(24, true));
    expect(wrongSize.checks.find((c) => c.label === "Page size")!.ok).toBe(false);
  });

  it("refuses to finalize a render with the wrong number of pages", async () => {
    const g = geometry(24, false);
    await expect(finalizeInterior(await fakeRender(g), geometry(26, false), { title: "T", author: "A" })).rejects.toThrow(/expected 26/);
  });

  it("builds safe file names", () => {
    expect(interiorFilename("Crème Brûlée: Word Search!", "8.5x11", true)).toBe("creme-brulee-word-search-interior-8.5x11-bleed.pdf");
    expect(interiorFilename("???", "8.5x8.5", false)).toBe("book-interior-8.5x8.5.pdf");
  });
});
