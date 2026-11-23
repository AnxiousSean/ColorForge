/**
 * KDP preflight: everything that would get an interior rejected (fail) or
 * that is legal but risky (warn). Export is blocked while any check fails.
 */

import { artworkBounds } from "@/lib/geometry";
import {
  PAGE_LIMITS,
  isRectInside,
  validateBlankPages,
  validatePageCount,
  type PageSlot,
  type Rect,
} from "@/lib/kdp";
import { getPageContext } from "@/lib/layout";
import type { Project, Shape } from "@/lib/model";
import { pageLabel, resolveBook, type ResolvedBook, type ResolvedPage } from "@/lib/pages";
import type { BookFont, FontWeight } from "@/lib/text-metrics";

export type CheckStatus = "pass" | "warn" | "fail";

export interface PreflightCheck {
  id: string;
  title: string;
  status: CheckStatus;
  /** One line per finding; for a pass, what was confirmed. */
  details: string[];
  /** Pages the findings refer to. */
  pages?: number[];
}

export interface PreflightReport {
  checks: PreflightCheck[];
  canExport: boolean;
  pageCount: number;
  book: ResolvedBook;
}

/** 0.75 pt: thinner lines may break up or vanish in print. */
export const MIN_LINE_WEIGHT_IN = 0.75 / 72;

export interface PreflightOptions {
  /** Returns characters the font cannot draw; omitted when fonts are not loaded. */
  missingGlyphs?: (text: string, font: BookFont, weight: FontWeight) => string[];
}

const isInked = (shapes: readonly Shape[]) => shapes.some((s) => !s.erase);

/** A content page that will print nothing (empty design or puzzle) counts as blank for KDP. */
function printsNothing(page: ResolvedPage): boolean {
  if (page.kind === "design") return !isInked(page.item.shapes);
  if (page.kind === "puzzle") return !page.item.puzzle || page.item.puzzle.placements.length === 0;
  return page.kind === "blank";
}

const summarizePages = (pages: number[]) => (pages.length > 12 ? `${pages.slice(0, 12).join(", ")} and ${pages.length - 12} more` : pages.join(", "));

export function runPreflight(project: Project, options: PreflightOptions = {}): PreflightReport {
  const book = resolveBook(project);
  const pageCount = book.pages.length;
  const checks: PreflightCheck[] = [];
  const limits = PAGE_LIMITS[project.trimSize][project.paperType];

  // 1. Page count ----------------------------------------------------------
  const countIssues = validatePageCount(pageCount, project.paperType, project.trimSize);
  checks.push({
    id: "page-count",
    title: "Page count",
    status: countIssues.length ? "fail" : "pass",
    details: countIssues.length
      ? countIssues.map((i) => i.message)
      : [`${pageCount} pages: even, and within KDP's ${limits.min}–${limits.max} for this trim and paper.`],
  });

  // 2. Blank pages (empty designs count as blank) --------------------------
  const effective: PageSlot[] = book.pages.map((p) =>
    printsNothing(p) ? { kind: "filler", pageNumber: p.slot.pageNumber } : { kind: "content", pageNumber: p.slot.pageNumber, itemId: "x" },
  );
  const blankIssues = validateBlankPages(effective);
  const emptyContent = book.pages.filter((p) => (p.kind === "design" || p.kind === "puzzle") && printsNothing(p));
  checks.push({
    id: "blank-pages",
    title: "Blank pages",
    status: blankIssues.length ? "fail" : emptyContent.length ? "warn" : "pass",
    details: [
      ...blankIssues.map((i) => i.message),
      ...(emptyContent.length ? [`${emptyContent.length} ${project.type === "coloring" ? "design" : "puzzle"} page(s) are empty and will print blank.`] : []),
      ...(!blankIssues.length && !emptyContent.length ? ["No more than 4 blank pages in a row, and no more than 10 at the end."] : []),
    ],
    pages: [...blankIssues.flatMap((i) => i.pages ?? []), ...emptyContent.map((p) => p.slot.pageNumber)],
  });

  // 3. Margins and bleed ----------------------------------------------------
  const outsideKdp: number[] = [];
  const outsideRecommended: number[] = [];
  const intoBleed: number[] = [];
  for (const page of book.pages) {
    if (page.kind !== "design") continue;
    const bounds = artworkBounds(page.item.shapes);
    if (!bounds) continue;
    const ctx = getPageContext(project.trimSize, project.hasBleed, pageCount, page.slot.pageNumber);
    const onPage: Rect = { ...bounds, xIn: bounds.xIn + ctx.trim.xIn, yIn: bounds.yIn + ctx.trim.yIn };
    if (!isRectInside(onPage, ctx.trim)) intoBleed.push(page.slot.pageNumber);
    if (!isRectInside(onPage, ctx.kdpSafe)) outsideKdp.push(page.slot.pageNumber);
    else if (!isRectInside(onPage, ctx.recommended)) outsideRecommended.push(page.slot.pageNumber);
  }
  if (project.hasBleed) {
    // With bleed, art may run off the edge on purpose (backgrounds, frames).
    checks.push({
      id: "margins",
      title: "Margins",
      status: outsideKdp.length || outsideRecommended.length ? "warn" : "pass",
      details: outsideKdp.length
        ? [`Artwork reaches past the safe margin on page(s) ${summarizePages(outsideKdp)}. That is fine for backgrounds meant to run off the edge, but anything important there may be trimmed off.`]
        : outsideRecommended.length
          ? [`Artwork is close to the edge on page(s) ${summarizePages(outsideRecommended)} (inside KDP's limit).`]
          : ["All artwork is inside the recommended margins."],
      pages: [...outsideKdp, ...outsideRecommended],
    });
  } else {
    checks.push({
      id: "margins",
      title: "Margins",
      status: outsideKdp.length ? "fail" : outsideRecommended.length ? "warn" : "pass",
      details: [
        ...(outsideKdp.length ? [`Artwork is outside KDP's minimum margin on page(s) ${summarizePages(outsideKdp)}. KDP rejects this without bleed: move it inside the red line, or turn on bleed if it should run off the page.`] : []),
        ...(outsideRecommended.length ? [`Artwork is between the recommended and minimum margins on page(s) ${summarizePages(outsideRecommended)}. Allowed, but close to the edge.`] : []),
        ...(!outsideKdp.length && !outsideRecommended.length ? ["All artwork is inside the recommended margins."] : []),
      ],
      pages: [...outsideKdp, ...outsideRecommended],
    });
  }

  checks.push({
    id: "bleed",
    title: "Bleed setting",
    status: project.hasBleed && intoBleed.length === 0 ? "warn" : "pass",
    details: [
      project.hasBleed
        ? `Every page is ${pageSizeLabel(project, true)} with bleed on the top, bottom and outside edges. On KDP choose "Bleed (PDF only)".`
        : `Every page is exactly the trim size, ${pageSizeLabel(project, false)}. On KDP choose "No bleed".`,
      ...(project.hasBleed && intoBleed.length === 0 ? ["Bleed is on, but no artwork runs off the page. Turning bleed off gives a simpler file."] : []),
    ],
  });

  // 4. Line weight ----------------------------------------------------------
  const thin = book.pages.filter(
    (p) => p.kind === "design" && p.item.shapes.some((s) => !s.erase && s.type !== "text" && s.strokeWidth < MIN_LINE_WEIGHT_IN - 1e-9),
  );
  checks.push({
    id: "line-weight",
    title: "Line weight",
    status: thin.length ? "warn" : "pass",
    details: thin.length
      ? [`Lines thinner than 0.75 pt on page(s) ${summarizePages(thin.map((p) => p.slot.pageNumber))} may not print cleanly.`]
      : ["All lines are at least 0.75 pt."],
    pages: thin.map((p) => p.slot.pageNumber),
  });

  // 5. Puzzles --------------------------------------------------------------
  if (project.type !== "coloring") {
    const broken = book.pages.filter((p) => p.kind === "puzzle" && p.item.puzzle && p.item.puzzle.ambiguous.length > 0);
    const partial = book.pages.filter((p) => p.kind === "puzzle" && p.item.puzzle && p.item.puzzle.unplaced.length > 0);
    checks.push({
      id: "puzzles",
      title: "Puzzles",
      status: broken.length ? "fail" : partial.length ? "warn" : "pass",
      details: [
        ...broken.map((p) => `${pageLabel(p)}: a word appears more than once, so the puzzle has two answers. Shuffle it.`),
        ...partial.map((p) => `${pageLabel(p)}: some words did not fit and were left out of the word list.`),
        ...(!broken.length && !partial.length ? ["Every word is in its grid exactly once, and the answer key matches."] : []),
      ],
      pages: [...broken, ...partial].map((p) => p.slot.pageNumber),
    });
  }

  // 6. Text and fonts -------------------------------------------------------
  if (options.missingGlyphs) {
    const missing = new Set<string>();
    const add = (text: string, font: BookFont = "sans", weight: FontWeight = 400) => options.missingGlyphs!(text, font, weight).forEach((c) => missing.add(c));
    add(project.title, "sans", 700);
    add(`${project.subtitle} ${project.author}`);
    for (const p of book.pages) {
      if (p.kind === "puzzle") {
        add(p.heading, "sans", 700);
        p.item.puzzle?.placements.forEach((pl) => add(pl.display.toUpperCase()));
      }
      if (p.kind === "design") p.item.shapes.forEach((s) => s.type === "text" && add(s.text, s.font));
    }
    checks.push({
      id: "fonts",
      title: "Text and fonts",
      status: missing.size ? "warn" : "pass",
      details: missing.size
        ? [`These characters are not in the bundled fonts and would print as empty boxes: ${[...missing].join(" ")}`]
        : ["All text is converted to vector outlines: no fonts to embed, nothing for KDP to reject."],
    });
  } else {
    checks.push({ id: "fonts", title: "Text and fonts", status: "fail", details: ["The print fonts are not loaded yet. Reload the page and try again."] });
  }

  // 7. Front matter --------------------------------------------------------
  if (project.includeFrontMatter && !project.author.trim()) {
    checks.push({
      id: "front-matter",
      title: "Title & copyright pages",
      status: "warn",
      details: ["No author name: the copyright page will say “the author”. Add your name or pen name in Book details."],
    });
  }

  return { checks, canExport: checks.every((c) => c.status !== "fail"), pageCount, book };
}

function pageSizeLabel(project: Project, bleed: boolean): string {
  const ctx = getPageContext(project.trimSize, bleed, 24, 1);
  return `${ctx.page.widthIn}" × ${ctx.page.heightIn}"`;
}
