/**
 * KDP book math: pure, dependency-free functions.
 *
 * Every layout, preflight, and export decision in the app goes through this
 * module, so it is the one place that has to match Amazon KDP's print specs.
 *
 * Units and coordinates
 * - Lengths ending in `In` are inches, `Pt` are PDF points (72 per inch),
 *   `Px` are raster pixels at a given DPI.
 * - Rectangles use the PDF *page* coordinate space (the trim plus any bleed),
 *   with the origin at the top-left. SVG and the editor use the same
 *   convention. The export engine flips Y for pdf-lib, whose origin is
 *   bottom-left.
 *
 * Page sides
 * - Page 1 is a right-hand page (recto). Odd pages are recto, with the gutter
 *   (spine) on the LEFT. Even pages are verso, with the gutter on the RIGHT.
 * - Bleed is added to the top, bottom, and OUTSIDE edges only, never the
 *   gutter. So on a recto page the extra 0.125" sits on the right, and on a
 *   verso page it sits on the left. Every page in the PDF has the same size.
 *
 * Margins
 * - KDP measures margins from the edge of the PDF page. With bleed, the
 *   0.375" outside margin therefore includes the 0.125" bleed strip, leaving
 *   0.25" of safe space inside the trim line. The gutter edge never has bleed,
 *   so the gutter margin is measured from the trim (spine) edge.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PT_PER_INCH = 72;
export const BLEED_IN = 0.125;
export const MIN_DPI = 300;
export const MIN_INTERIOR_PAGES = 24;
export const MAX_INTERIOR_FILE_BYTES = 650 * 1024 * 1024;

/** KDP minimum top, bottom, and outside margins. */
export const OUTSIDE_MARGIN_IN = {
  noBleed: 0.25,
  bleed: 0.375,
} as const;

/** KDP minimum inside (gutter) margin, by total interior page count. */
export const GUTTER_TABLE: ReadonlyArray<{ maxPages: number; gutterIn: number }> = [
  { maxPages: 150, gutterIn: 0.375 },
  { maxPages: 300, gutterIn: 0.5 },
  { maxPages: 500, gutterIn: 0.625 },
  { maxPages: 700, gutterIn: 0.75 },
  { maxPages: Number.POSITIVE_INFINITY, gutterIn: 0.875 },
];

/** KDP needs more than 79 pages before it allows text on the spine. */
export const MIN_PAGES_FOR_SPINE_TEXT = 80;

export type TrimSizeId = "letter" | "square";

export interface TrimSize {
  id: TrimSizeId;
  label: string;
  widthIn: number;
  heightIn: number;
}

export const TRIM_SIZES: Readonly<Record<TrimSizeId, TrimSize>> = {
  letter: { id: "letter", label: '8.5" × 11" (US Letter)', widthIn: 8.5, heightIn: 11 },
  square: { id: "square", label: '8.5" × 8.5" (Square)', widthIn: 8.5, heightIn: 8.5 },
};

export const DEFAULT_TRIM_SIZE: TrimSizeId = "letter";

export type PaperType = "white" | "cream" | "standard-color" | "premium-color";

export interface PaperSpec {
  id: PaperType;
  label: string;
  /** Thickness per page in inches. Used to work out the spine width. */
  thicknessPerPageIn: number;
}

export const PAPER_TYPES: Readonly<Record<PaperType, PaperSpec>> = {
  white: { id: "white", label: "Black ink, white paper", thicknessPerPageIn: 0.002252 },
  cream: { id: "cream", label: "Black ink, cream paper", thicknessPerPageIn: 0.0025 },
  "standard-color": { id: "standard-color", label: "Standard color, white paper", thicknessPerPageIn: 0.002252 },
  "premium-color": { id: "premium-color", label: "Premium color, white paper", thicknessPerPageIn: 0.002347 },
};

/**
 * KDP page-count limits per trim size and paper, from KDP's Trim Size
 * Specifications table (8.5" x 11" row). The 8.5" x 8.5" square trim falls
 * in the same large-trim band.
 */
export const PAGE_LIMITS: Readonly<Record<TrimSizeId, Record<PaperType, { min: number; max: number }>>> = {
  letter: {
    white: { min: 24, max: 590 },
    cream: { min: 24, max: 550 },
    "standard-color": { min: 72, max: 600 },
    "premium-color": { min: 24, max: 590 },
  },
  square: {
    white: { min: 24, max: 590 },
    cream: { min: 24, max: 550 },
    "standard-color": { min: 72, max: 600 },
    "premium-color": { min: 24, max: 590 },
  },
};

/** KDP rejects more than 4 blank pages in a row at the start or middle... */
export const MAX_CONSECUTIVE_BLANK_PAGES = 4;
/** ...or more than 10 blank pages in a row at the end. */
export const MAX_TRAILING_BLANK_PAGES = 10;

export const DEFAULT_PAPER_TYPE: PaperType = "white";

// ---------------------------------------------------------------------------
// Shared types and unit helpers
// ---------------------------------------------------------------------------

export interface Dimensions {
  widthIn: number;
  heightIn: number;
  widthPt: number;
  heightPt: number;
}

export interface Rect {
  xIn: number;
  yIn: number;
  widthIn: number;
  heightIn: number;
}

export type PageSide = "recto" | "verso";

export const inToPt = (inches: number): number => inches * PT_PER_INCH;
export const ptToIn = (points: number): number => points / PT_PER_INCH;

/**
 * Converts inches to whole pixels. Rounds UP, so the result is never below
 * the requested DPI.
 */
export function inToPx(inches: number, dpi: number = MIN_DPI): number {
  // Strip float noise first (e.g. 8.5 * 300 = 2550.0000000000005) so it
  // does not push an exact value up by one pixel.
  return Math.ceil(Number((inches * dpi).toFixed(6)));
}

function dims(widthIn: number, heightIn: number): Dimensions {
  return { widthIn, heightIn, widthPt: inToPt(widthIn), heightPt: inToPt(heightIn) };
}

function assertPageCount(pageCount: number): void {
  if (!Number.isInteger(pageCount) || pageCount < 0) {
    throw new RangeError(`Page count must be a non-negative integer, got ${pageCount}`);
  }
}

function assertPageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new RangeError(`Page number must be a positive integer (1-based), got ${pageNumber}`);
  }
}

export function getTrimSize(trimSize: TrimSizeId): TrimSize {
  const trim = TRIM_SIZES[trimSize];
  if (!trim) throw new RangeError(`Unknown trim size: ${String(trimSize)}`);
  return trim;
}

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

/**
 * Size of one interior PDF page. With bleed, the width grows by one bleed
 * strip (outside edge only) and the height grows by two (top and bottom).
 *
 *   letter, no bleed -> 8.5   × 11    in (612 × 792 pt)
 *   letter, bleed    -> 8.625 × 11.25 in (621 × 810 pt)
 */
export function getPageDimensions(trimSize: TrimSizeId, hasBleed: boolean): Dimensions {
  const trim = getTrimSize(trimSize);
  const bleed = hasBleed ? BLEED_IN : 0;
  return dims(trim.widthIn + bleed, trim.heightIn + bleed * 2);
}

/** Raster size of a full page at `dpi`, e.g. 2550 × 3300 for letter at 300 DPI. */
export function getRasterSize(
  trimSize: TrimSizeId,
  hasBleed: boolean,
  dpi: number = MIN_DPI,
): { widthPx: number; heightPx: number; dpi: number } {
  if (dpi < MIN_DPI) throw new RangeError(`DPI must be at least ${MIN_DPI}, got ${dpi}`);
  const page = getPageDimensions(trimSize, hasBleed);
  return { widthPx: inToPx(page.widthIn, dpi), heightPx: inToPx(page.heightIn, dpi), dpi };
}

/** Odd pages are recto (right-hand, gutter on the left). Even pages are verso. */
export function getPageSide(pageNumber: number): PageSide {
  assertPageNumber(pageNumber);
  return pageNumber % 2 === 1 ? "recto" : "verso";
}

/**
 * Where the trim (final cut) rectangle sits inside the PDF page. Without
 * bleed it fills the page. With bleed it is inset by the bleed on the top
 * and on the outside edge, which is the left edge for verso pages.
 */
export function getTrimBox(trimSize: TrimSizeId, hasBleed: boolean, pageNumber: number): Rect {
  const trim = getTrimSize(trimSize);
  const side = getPageSide(pageNumber);
  const bleed = hasBleed ? BLEED_IN : 0;
  return {
    xIn: side === "verso" ? bleed : 0,
    yIn: bleed,
    widthIn: trim.widthIn,
    heightIn: trim.heightIn,
  };
}

// ---------------------------------------------------------------------------
// Margins and safe area
// ---------------------------------------------------------------------------

export interface Margins {
  topIn: number;
  bottomIn: number;
  outsideIn: number;
  /** Inside margin, on the spine side. */
  gutterIn: number;
}

/**
 * Minimum gutter for a book with `pageCount` interior pages. Counts above
 * KDP's printable maximum get the largest gutter; preflight reports them
 * separately as an error.
 */
export function getGutterMargin(pageCount: number): number {
  assertPageCount(pageCount);
  const row = GUTTER_TABLE.find((r) => pageCount <= r.maxPages);
  // The table ends with Infinity, so a row is always found.
  return row!.gutterIn;
}

/**
 * KDP minimum margins, measured from the edge of the PDF page (see the
 * module header for why that matters once bleed is on).
 */
export function getSafeMargins(pageCount: number, hasBleed: boolean): Margins {
  const outside = hasBleed ? OUTSIDE_MARGIN_IN.bleed : OUTSIDE_MARGIN_IN.noBleed;
  return {
    topIn: outside,
    bottomIn: outside,
    outsideIn: outside,
    gutterIn: getGutterMargin(pageCount),
  };
}

/** Extra room on top of KDP's minimums, measured from the trim line. */
export const COMFORT_OUTSIDE_FROM_TRIM_IN = 0.5;
export const COMFORT_GUTTER_EXTRA_IN = 0.125;

/**
 * The margins the app lays content out to by default. KDP's minimums
 * (`getSafeMargins`) are the hard limit; this adds breathing room so:
 * - small trim drift at the printer never clips a line,
 * - colorers can reach artwork near the spine,
 * - puzzle grids are not squeezed into the binding.
 * Content between the two lines only triggers a preflight warning.
 */
export function getRecommendedMargins(pageCount: number, hasBleed: boolean): Margins {
  const outside = COMFORT_OUTSIDE_FROM_TRIM_IN + (hasBleed ? BLEED_IN : 0);
  return {
    topIn: outside,
    bottomIn: outside,
    outsideIn: outside,
    gutterIn: getGutterMargin(pageCount) + COMFORT_GUTTER_EXTRA_IN,
  };
}

/**
 * The area of a page where artwork is guaranteed not to be cut off or lost
 * in the binding. Everything a user draws must fit inside it unless it is
 * deliberately full-bleed artwork.
 */
export function getSafeArea(
  trimSize: TrimSizeId,
  hasBleed: boolean,
  pageCount: number,
  pageNumber: number,
  level: "kdp-minimum" | "recommended" = "kdp-minimum",
): Rect {
  const page = getPageDimensions(trimSize, hasBleed);
  const m = level === "recommended" ? getRecommendedMargins(pageCount, hasBleed) : getSafeMargins(pageCount, hasBleed);
  const left = getPageSide(pageNumber) === "recto" ? m.gutterIn : m.outsideIn;
  return {
    xIn: left,
    yIn: m.topIn,
    widthIn: page.widthIn - m.gutterIn - m.outsideIn,
    heightIn: page.heightIn - m.topIn - m.bottomIn,
  };
}

/** True if `inner` fits entirely inside `outer`, with a little float tolerance. */
export function isRectInside(inner: Rect, outer: Rect, epsilonIn = 1e-6): boolean {
  return (
    inner.xIn >= outer.xIn - epsilonIn &&
    inner.yIn >= outer.yIn - epsilonIn &&
    inner.xIn + inner.widthIn <= outer.xIn + outer.widthIn + epsilonIn &&
    inner.yIn + inner.heightIn <= outer.yIn + outer.heightIn + epsilonIn
  );
}

// ---------------------------------------------------------------------------
// Page sequencing (content pages, blank backing pages, filler)
// ---------------------------------------------------------------------------

export interface PageItem {
  id: string;
  /**
   * Print a blank page behind this item. Coloring designs default to true so
   * markers cannot bleed through; puzzle books turn it off.
   */
  addBackingPage?: boolean;
  /** Always start this item on a right-hand page (e.g. the title page). */
  startOnRecto?: boolean;
}

export type PageSlot =
  | { kind: "content"; pageNumber: number; itemId: string }
  /** Intentional blank behind a single-sided design. */
  | { kind: "backing"; pageNumber: number; itemId: string }
  /** Blank page added for parity, the KDP minimum, or recto alignment. */
  | { kind: "filler"; pageNumber: number };

export interface PageSequenceOptions {
  /**
   * Add blank pages at the end until the book has at least `minPages`.
   * Never adds more than KDP's trailing-blank limit allows; preflight
   * reports any remaining shortfall.
   */
  padToMinimum?: boolean;
  minPages?: number;
}

const isBlank = (s: PageSlot) => s.kind !== "content";

/**
 * Lays out the physical interior pages, in order. 20 coloring designs with
 * backing pages make 40 pages. The total is always rounded up to even.
 */
export function buildPageSequence(items: readonly PageItem[], options: PageSequenceOptions = {}): PageSlot[] {
  const slots: PageSlot[] = [];
  const next = () => slots.length + 1;

  for (const item of items) {
    if (item.startOnRecto && next() % 2 === 0) slots.push({ kind: "filler", pageNumber: next() });
    slots.push({ kind: "content", pageNumber: next(), itemId: item.id });
    if (item.addBackingPage !== false) slots.push({ kind: "backing", pageNumber: next(), itemId: item.id });
  }

  let target = getFinalPageCount(slots.length);
  if (options.padToMinimum && slots.length > 0) {
    const minPages = options.minPages ?? MIN_INTERIOR_PAGES;
    const trailing = countTrailingBlanks(slots);
    // Keep the padded total even while staying within the trailing limit.
    let maxPadded = slots.length + Math.max(0, MAX_TRAILING_BLANK_PAGES - trailing);
    if (maxPadded % 2 !== 0) maxPadded -= 1;
    target = Math.max(target, Math.min(getFinalPageCount(minPages), maxPadded));
  }
  while (slots.length < target) slots.push({ kind: "filler", pageNumber: next() });
  return slots;
}

/** Rounds a raw page count up to even, and optionally up to the KDP minimum. */
export function getFinalPageCount(rawPageCount: number, padToMinimum = false): number {
  assertPageCount(rawPageCount);
  const floor = padToMinimum ? Math.max(rawPageCount, MIN_INTERIOR_PAGES) : rawPageCount;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Number of interior pages the given items produce. */
export function countInteriorPages(items: readonly PageItem[], options: PageSequenceOptions = {}): number {
  return buildPageSequence(items, options).length;
}

function countTrailingBlanks(slots: readonly PageSlot[]): number {
  let n = 0;
  for (let i = slots.length - 1; i >= 0 && isBlank(slots[i]!); i--) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Validation (used by preflight)
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning";

export interface KdpIssue {
  code: "below-minimum" | "odd-count" | "above-maximum" | "blank-run" | "trailing-blanks" | "no-content";
  severity: IssueSeverity;
  message: string;
  /** Pages the issue applies to, if it is page-specific. */
  pages?: number[];
}

export function validatePageCount(
  pageCount: number,
  paperType: PaperType = DEFAULT_PAPER_TYPE,
  trimSize: TrimSizeId = DEFAULT_TRIM_SIZE,
): KdpIssue[] {
  assertPageCount(pageCount);
  const paper = PAPER_TYPES[paperType];
  const limits = PAGE_LIMITS[getTrimSize(trimSize).id][paperType];
  const issues: KdpIssue[] = [];

  if (pageCount < limits.min) {
    issues.push({
      code: "below-minimum",
      severity: "error",
      message: `KDP needs at least ${limits.min} interior pages for ${paper.label.toLowerCase()}; this book has ${pageCount}.`,
    });
  }
  if (pageCount % 2 !== 0) {
    issues.push({ code: "odd-count", severity: "error", message: `Page count must be even; this book has ${pageCount}.` });
  }
  if (pageCount > limits.max) {
    issues.push({
      code: "above-maximum",
      severity: "error",
      message: `KDP allows at most ${limits.max} pages at this trim size for ${paper.label.toLowerCase()}; this book has ${pageCount}.`,
    });
  }
  return issues;
}

/**
 * KDP rejects manuscripts with more than 4 blank pages in a row at the start
 * or middle, or more than 10 at the end.
 */
export function validateBlankPages(slots: readonly PageSlot[]): KdpIssue[] {
  if (slots.length === 0) return [];
  if (slots.every(isBlank)) {
    return [{ code: "no-content", severity: "error", message: "The book has no content pages." }];
  }

  const issues: KdpIssue[] = [];
  const trailing = countTrailingBlanks(slots);
  const body = slots.slice(0, slots.length - trailing);

  let run: number[] = [];
  const flush = () => {
    if (run.length > MAX_CONSECUTIVE_BLANK_PAGES) {
      issues.push({
        code: "blank-run",
        severity: "error",
        message: `Pages ${run[0]}–${run[run.length - 1]} are ${run.length} blank pages in a row; KDP allows at most ${MAX_CONSECUTIVE_BLANK_PAGES}.`,
        pages: [...run],
      });
    }
    run = [];
  };
  for (const s of body) {
    if (isBlank(s)) run.push(s.pageNumber);
    else flush();
  }
  flush();

  if (trailing > MAX_TRAILING_BLANK_PAGES) {
    issues.push({
      code: "trailing-blanks",
      severity: "error",
      message: `The book ends with ${trailing} blank pages; KDP allows at most ${MAX_TRAILING_BLANK_PAGES}. Add more content instead of padding.`,
      pages: slots.slice(slots.length - trailing).map((s) => s.pageNumber),
    });
  }
  return issues;
}

/** Every page-count and blank-page check for a laid-out book. */
export function validateSequence(
  slots: readonly PageSlot[],
  paperType: PaperType = DEFAULT_PAPER_TYPE,
  trimSize: TrimSizeId = DEFAULT_TRIM_SIZE,
): KdpIssue[] {
  return [...validatePageCount(slots.length, paperType, trimSize), ...validateBlankPages(slots)];
}

// ---------------------------------------------------------------------------
// Cover math
// ---------------------------------------------------------------------------

/** Spine width in inches: page count × paper thickness per page. */
export function calculateSpineWidth(pageCount: number, paperType: PaperType = DEFAULT_PAPER_TYPE): number {
  assertPageCount(pageCount);
  const paper = PAPER_TYPES[paperType];
  if (!paper) throw new RangeError(`Unknown paper type: ${String(paperType)}`);
  return pageCount * paper.thicknessPerPageIn;
}

export interface CoverLayout extends Dimensions {
  spineWidthIn: number;
  /** Where each panel of the full wrap sits, top-left origin, bleed included. */
  backCover: Rect;
  spine: Rect;
  frontCover: Rect;
  allowsSpineText: boolean;
}

/**
 * Full paperback cover wrap: bleed + back + spine + front + bleed across,
 * and trim height + top and bottom bleed down. Covers always have bleed.
 */
export function getCoverLayout(
  trimSize: TrimSizeId,
  pageCount: number,
  paperType: PaperType = DEFAULT_PAPER_TYPE,
): CoverLayout {
  const trim = getTrimSize(trimSize);
  const spineWidthIn = calculateSpineWidth(pageCount, paperType);
  const widthIn = BLEED_IN * 2 + trim.widthIn * 2 + spineWidthIn;
  const heightIn = trim.heightIn + BLEED_IN * 2;

  const panel = (xIn: number, widthIn: number): Rect => ({ xIn, yIn: BLEED_IN, widthIn, heightIn: trim.heightIn });

  return {
    ...dims(widthIn, heightIn),
    spineWidthIn,
    backCover: panel(BLEED_IN, trim.widthIn),
    spine: panel(BLEED_IN + trim.widthIn, spineWidthIn),
    frontCover: panel(BLEED_IN + trim.widthIn + spineWidthIn, trim.widthIn),
    allowsSpineText: pageCount >= MIN_PAGES_FOR_SPINE_TEXT,
  };
}
