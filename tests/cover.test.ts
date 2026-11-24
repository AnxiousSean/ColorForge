import { describe, expect, it } from "vitest";
import { BARCODE_BOX, CAP_HALF, contrastRatio, getCoverGeometry, layoutCover, spineRotation } from "@/lib/cover";
import { isRectInside } from "@/lib/kdp";
import { DEFAULT_COVER, SCHEMA_VERSION, createDesign, createProject, migrateProject, type Project } from "@/lib/model";

const book = (patch: Partial<Project> = {}) => ({
  ...createProject({ type: "word-search", title: "Large Print Word Search", author: "Jamie Rivers" }),
  ...patch,
});

describe("cover geometry", () => {
  it("matches KDP's full-wrap formula", () => {
    const g = getCoverGeometry(book(), 120);
    expect(g.spineWidthIn).toBeCloseTo(120 * 0.002252, 6);
    expect(g.widthIn).toBeCloseTo(0.125 + 8.5 + 120 * 0.002252 + 8.5 + 0.125, 6);
    expect(g.heightIn).toBe(11.25);
    expect(g.trim).toEqual({ xIn: 0.125, yIn: 0.125, widthIn: g.widthIn - 0.25, heightIn: 11 });
  });

  it("puts the barcode box at the back cover's bottom-right, inside the safe area", () => {
    const g = getCoverGeometry(book(), 120);
    expect(g.barcode.widthIn).toBe(BARCODE_BOX.widthIn);
    expect(isRectInside(g.barcode, g.back)).toBe(true);
    expect(g.barcode.xIn + g.barcode.widthIn).toBeCloseTo(g.back.xIn + g.back.widthIn - 0.25);
    expect(g.barcode.yIn + g.barcode.heightIn).toBeCloseTo(g.back.yIn + g.back.heightIn - 0.25);
  });
});

describe("layoutCover", () => {
  it("keeps the front title, art and author inside the front safe area", () => {
    const l = layoutCover(book({ subtitle: "100 Themed Puzzles with Solutions for Adults and Seniors" }), 120);
    const fs = l.geometry.frontSafe;
    for (const b of [...l.title, ...l.subtitle, l.author!]) {
      expect(b.y).toBeLessThanOrEqual(fs.yIn + fs.heightIn + 1e-9);
      expect(b.y - b.size).toBeGreaterThanOrEqual(fs.yIn - 1e-9);
    }
    expect(isRectInside(l.artPanel, fs)).toBe(true);
    expect(l.author!.y - l.author!.size).toBeGreaterThan(l.artPanel.yIn + l.artPanel.heightIn);
  });

  it("only allows spine text from 80 pages", () => {
    expect(layoutCover(book(), 40).spine).toBeNull();
    expect(layoutCover(book(), 40).spineNote).toMatch(/more than 79 pages/);
    expect(layoutCover(book(), 120).spine).not.toBeNull();
    expect(layoutCover(book({ cover: { ...DEFAULT_COVER, showSpineText: false } }), 120).spine).toBeNull();
  });

  it("sizes spine text to fit the spine width and rotates about the spine centre", () => {
    const l = layoutCover(book(), 120);
    const s = l.spine!;
    const g = l.geometry;
    expect(s.size).toBeLessThanOrEqual(g.spineSafe.widthIn);
    expect(s.x).toBeCloseTo(g.spine.xIn + g.spine.widthIn / 2);
    const [, cx, cy] = spineRotation(s).match(/rotate\(90 ([\d.]+) ([\d.]+)\)/)!.map(Number);
    expect(cx).toBeCloseTo(g.spine.xIn + g.spine.widthIn / 2, 3);
    expect(cy).toBeCloseTo(g.spine.yIn + g.spine.heightIn / 2, 3);
    expect(s.y - s.size * CAP_HALF).toBeCloseTo(cy!, 3);
  });

  it("stops the blurb above the barcode box and reports overflow", () => {
    const short = layoutCover(book({ cover: { ...DEFAULT_COVER, blurb: "Relax and unwind." } }), 120);
    expect(short.blurb).toHaveLength(1);
    expect(short.blurbOverflow).toBe(false);
    const long = layoutCover(book({ cover: { ...DEFAULT_COVER, blurb: "Lots of fun puzzles to enjoy. ".repeat(200) } }), 120);
    expect(long.blurbOverflow).toBe(true);
    const lastLine = long.blurb.at(-1)!;
    expect(lastLine.y).toBeLessThan(long.geometry.barcode.yIn);
  });
});

describe("contrast", () => {
  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1);
    expect(contrastRatio("#1f4e79", "#ffffff")).toBeGreaterThan(4.5);
  });
});

describe("migration", () => {
  it("adds cover settings to version-1 projects", () => {
    const design = createDesign("D1");
    const v1 = { ...createProject({ type: "coloring", title: "Old", items: [design] }), schemaVersion: 1 } as Partial<Project>;
    delete v1.cover;
    const migrated = migrateProject(v1 as Project);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.cover).toEqual({ ...DEFAULT_COVER, artItemId: design.id });
  });
});
