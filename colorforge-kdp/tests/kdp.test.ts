import { describe, expect, it } from "vitest";
import {
  buildPageSequence,
  calculateSpineWidth,
  countInteriorPages,
  getCoverLayout,
  getFinalPageCount,
  getGutterMargin,
  getPageDimensions,
  getPageSide,
  getRasterSize,
  getSafeArea,
  getSafeMargins,
  getTrimBox,
  inToPx,
  isRectInside,
  validatePageCount,
  type DesignRef,
} from "@/lib/kdp";

const designs = (n: number, addBackingPage = true): DesignRef[] =>
  Array.from({ length: n }, (_, i) => ({ id: `d${i + 1}`, addBackingPage }));

describe("getPageDimensions", () => {
  it("letter without bleed is 8.5 × 11 in / 612 × 792 pt", () => {
    expect(getPageDimensions("letter", false)).toEqual({ widthIn: 8.5, heightIn: 11, widthPt: 612, heightPt: 792 });
  });

  it("letter with bleed is exactly 8.625 × 11.25 in (outside edge only on width)", () => {
    expect(getPageDimensions("letter", true)).toEqual({ widthIn: 8.625, heightIn: 11.25, widthPt: 621, heightPt: 810 });
  });

  it("square with bleed is 8.625 × 8.75 in", () => {
    expect(getPageDimensions("square", true)).toEqual({ widthIn: 8.625, heightIn: 8.75, widthPt: 621, heightPt: 630 });
  });

  it("rejects unknown trim sizes", () => {
    // @ts-expect-error testing runtime guard
    expect(() => getPageDimensions("a4", false)).toThrow(RangeError);
  });
});

describe("raster sizing", () => {
  it("letter at 300 DPI is 2550 × 3300 px", () => {
    expect(getRasterSize("letter", false)).toEqual({ widthPx: 2550, heightPx: 3300, dpi: 300 });
  });

  it("rounds bleed sizes up so the output never drops below 300 DPI", () => {
    // 8.625 × 300 = 2587.5 -> 2588
    expect(getRasterSize("letter", true)).toEqual({ widthPx: 2588, heightPx: 3375, dpi: 300 });
  });

  it("refuses DPI below 300", () => {
    expect(() => getRasterSize("letter", false, 150)).toThrow(RangeError);
  });

  it("is not pushed up by floating-point noise", () => {
    expect(inToPx(8.5, 300)).toBe(2550);
    expect(inToPx(0.1 * 3, 1000)).toBe(300);
  });
});

describe("page sides and trim box", () => {
  it("odd pages are recto, even pages are verso", () => {
    expect(getPageSide(1)).toBe("recto");
    expect(getPageSide(2)).toBe("verso");
    expect(getPageSide(41)).toBe("recto");
    expect(() => getPageSide(0)).toThrow(RangeError);
  });

  it("puts bleed on the outside edge: right of recto, left of verso", () => {
    expect(getTrimBox("letter", true, 1)).toEqual({ xIn: 0, yIn: 0.125, widthIn: 8.5, heightIn: 11 });
    expect(getTrimBox("letter", true, 2)).toEqual({ xIn: 0.125, yIn: 0.125, widthIn: 8.5, heightIn: 11 });
  });

  it("fills the page when there is no bleed", () => {
    expect(getTrimBox("letter", false, 2)).toEqual({ xIn: 0, yIn: 0, widthIn: 8.5, heightIn: 11 });
  });
});

describe("margins", () => {
  it.each([
    [24, 0.375],
    [150, 0.375],
    [151, 0.5],
    [300, 0.5],
    [301, 0.625],
    [500, 0.625],
    [501, 0.75],
    [700, 0.75],
    [701, 0.875],
    [828, 0.875],
    [2000, 0.875],
  ])("gutter for %i pages is %f in", (pages, gutter) => {
    expect(getGutterMargin(pages)).toBe(gutter);
  });

  it("uses 0.375 in outside margins with bleed and 0.25 in without", () => {
    expect(getSafeMargins(40, true)).toEqual({ topIn: 0.375, bottomIn: 0.375, outsideIn: 0.375, gutterIn: 0.375 });
    expect(getSafeMargins(40, false)).toEqual({ topIn: 0.25, bottomIn: 0.25, outsideIn: 0.25, gutterIn: 0.375 });
  });

  it("rejects invalid page counts", () => {
    expect(() => getGutterMargin(-1)).toThrow(RangeError);
    expect(() => getGutterMargin(2.5)).toThrow(RangeError);
  });
});

describe("getSafeArea", () => {
  it("puts the gutter margin on the left of recto pages", () => {
    const area = getSafeArea("letter", true, 40, 1);
    expect(area.xIn).toBe(0.375);
    expect(area.yIn).toBe(0.375);
    expect(area.widthIn).toBeCloseTo(8.625 - 0.375 - 0.375);
    expect(area.heightIn).toBeCloseTo(11.25 - 0.75);
  });

  it("puts the gutter margin on the right of verso pages", () => {
    const area = getSafeArea("letter", true, 400, 2); // gutter 0.625
    expect(area.xIn).toBe(0.375);
    expect(area.xIn + area.widthIn).toBeCloseTo(8.625 - 0.625);
  });

  it("keeps the safe area inside the trim on both sides", () => {
    for (const page of [1, 2]) {
      expect(isRectInside(getSafeArea("square", true, 24, page), getTrimBox("square", true, page))).toBe(true);
    }
  });
});

describe("isRectInside", () => {
  const outer = { xIn: 0, yIn: 0, widthIn: 10, heightIn: 10 };
  it("detects containment and overflow", () => {
    expect(isRectInside({ xIn: 1, yIn: 1, widthIn: 8, heightIn: 8 }, outer)).toBe(true);
    expect(isRectInside({ xIn: 0, yIn: 0, widthIn: 10, heightIn: 10 }, outer)).toBe(true);
    expect(isRectInside({ xIn: 5, yIn: 5, widthIn: 6, heightIn: 1 }, outer)).toBe(false);
  });
});

describe("page sequencing", () => {
  it("20 designs with backing pages make a 40-page PDF", () => {
    const seq = buildPageSequence(designs(20));
    expect(seq).toHaveLength(40);
    expect(seq.filter((p) => p.kind === "design")).toHaveLength(20);
    // Designs land on recto pages, blanks on verso.
    expect(seq.every((p) => (p.kind === "design") === (p.pageNumber % 2 === 1))).toBe(true);
  });

  it("numbers pages from 1 in order", () => {
    expect(buildPageSequence(designs(3)).map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("respects per-design backing toggles and rounds up to even", () => {
    const seq = buildPageSequence([{ id: "a" }, { id: "b", addBackingPage: false }]);
    expect(seq.map((p) => p.kind)).toEqual(["design", "backing", "design", "filler"]);
  });

  it("pads to the 24-page minimum only when asked", () => {
    expect(countInteriorPages(designs(5))).toBe(10);
    const padded = buildPageSequence(designs(5), { padToMinimum: true });
    expect(padded).toHaveLength(24);
    expect(padded.slice(10).every((p) => p.kind === "filler")).toBe(true);
  });

  it("handles an empty book", () => {
    expect(buildPageSequence([])).toEqual([]);
    expect(getFinalPageCount(0, true)).toBe(24);
  });
});

describe("validatePageCount", () => {
  it("passes a valid book", () => {
    expect(validatePageCount(40)).toEqual([]);
  });

  it("flags short, odd, and oversized books", () => {
    expect(validatePageCount(10).map((i) => i.code)).toEqual(["below-minimum"]);
    expect(validatePageCount(25).map((i) => i.code)).toEqual(["odd-count"]);
    expect(validatePageCount(830).map((i) => i.code)).toEqual(["above-maximum"]);
  });

  it("applies the paper-specific minimum for standard colour", () => {
    expect(validatePageCount(40, "standard-color").map((i) => i.code)).toEqual(["below-minimum"]);
  });
});

describe("cover math", () => {
  it("spine width is page count × paper thickness", () => {
    expect(calculateSpineWidth(100, "white")).toBeCloseTo(0.2252, 6);
    expect(calculateSpineWidth(100, "cream")).toBeCloseTo(0.25, 6);
    expect(calculateSpineWidth(100, "premium-color")).toBeCloseTo(0.2347, 6);
  });

  it("builds a full wrap with bleed on all four sides", () => {
    const cover = getCoverLayout("letter", 100, "white");
    expect(cover.widthIn).toBeCloseTo(0.125 + 8.5 + 0.2252 + 8.5 + 0.125, 6);
    expect(cover.heightIn).toBe(11.25);
    expect(cover.frontCover.xIn).toBeCloseTo(0.125 + 8.5 + 0.2252, 6);
    expect(cover.allowsSpineText).toBe(true);
  });

  it("disallows spine text below 80 pages", () => {
    expect(getCoverLayout("square", 48).allowsSpineText).toBe(false);
  });
});
