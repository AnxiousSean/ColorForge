/**
 * Book types and their publishing defaults. Each profile is a ready-to-go
 * starting point, so a new book needs only a title, a theme, and content.
 */

import {
  buildPageSequence,
  validateSequence,
  type KdpIssue,
  type PageItem,
  type PageSlot,
  type PaperType,
  type TrimSizeId,
} from "@/lib/kdp";
import type { Difficulty } from "@/lib/puzzles/search-grid";

export type BookType = "coloring" | "word-search" | "number-search";

export interface BookProfile {
  type: BookType;
  label: string;
  trimSize: TrimSizeId;
  /**
   * Bleed is off for every type. Line art and puzzle grids sit inside the
   * margins anyway, and without bleed a whole class of KDP rejections
   * (artwork short of the bleed edge, wrong page size) cannot happen.
   */
  hasBleed: false;
  paperType: PaperType;
  /** Coloring books print single-sided; puzzle books print on both sides. */
  backingPages: boolean;
  hasAnswerKey: boolean;
  /** Solutions per answer-key page, per trim size. */
  answersPerPage: Record<TrimSizeId, number>;
  puzzle?: { rows: number; cols: number; entriesPerPuzzle: number; difficulty: Difficulty };
  /** Content pieces in a typical book of this type, a sensible first target. */
  typicalContentCount: number;
}

export const BOOK_PROFILES: Readonly<Record<BookType, BookProfile>> = {
  coloring: {
    type: "coloring",
    label: "Coloring book",
    trimSize: "letter",
    hasBleed: false,
    paperType: "white",
    backingPages: true,
    hasAnswerKey: false,
    answersPerPage: { letter: 0, square: 0 },
    typicalContentCount: 50,
  },
  "word-search": {
    type: "word-search",
    label: "Word search (large print)",
    trimSize: "letter",
    hasBleed: false,
    paperType: "white",
    backingPages: false,
    hasAnswerKey: true,
    answersPerPage: { letter: 6, square: 4 },
    puzzle: { rows: 15, cols: 15, entriesPerPuzzle: 20, difficulty: "medium" },
    typicalContentCount: 100,
  },
  "number-search": {
    type: "number-search",
    label: "Number search (large print)",
    trimSize: "letter",
    hasBleed: false,
    paperType: "white",
    backingPages: false,
    hasAnswerKey: true,
    answersPerPage: { letter: 6, square: 4 },
    puzzle: { rows: 15, cols: 15, entriesPerPuzzle: 20, difficulty: "medium" },
    typicalContentCount: 100,
  },
};

export type PageRole = "title" | "copyright" | "design" | "puzzle" | "answer-key";

export interface PlannedPage extends PageItem {
  role: PageRole;
  /** Index of the design or puzzle, or the indexes of the puzzles an answer-key page solves. */
  contentIndexes?: number[];
}

export interface BookPlan {
  items: PlannedPage[];
  slots: PageSlot[];
  issues: KdpIssue[];
}

export interface PlanOptions {
  type: BookType;
  contentCount: number;
  trimSize?: TrimSizeId;
  paperType?: PaperType;
  /** Overrides the profile, e.g. a coloring book printed double-sided. */
  backingPages?: boolean;
  includeFrontMatter?: boolean;
  padToMinimum?: boolean;
}

/**
 * The page layout for a whole book: front matter, then content, then (for
 * puzzles) an answer key starting on a right-hand page. Comes with every
 * page-count and blank-page issue already checked.
 */
export function planBook(options: PlanOptions): BookPlan {
  const profile = BOOK_PROFILES[options.type];
  const trimSize = options.trimSize ?? profile.trimSize;
  const paperType = options.paperType ?? profile.paperType;
  const backing = options.backingPages ?? profile.backingPages;
  const items: PlannedPage[] = [];

  if (options.includeFrontMatter ?? true) {
    items.push({ id: "title", role: "title", addBackingPage: false, startOnRecto: true });
    items.push({ id: "copyright", role: "copyright", addBackingPage: false });
  }

  const contentRole: PageRole = options.type === "coloring" ? "design" : "puzzle";
  for (let i = 0; i < options.contentCount; i++) {
    items.push({
      id: `${contentRole}-${i + 1}`,
      role: contentRole,
      addBackingPage: backing,
      // Single-sided art must sit on right-hand pages so its back is the blank.
      startOnRecto: backing && i === 0,
      contentIndexes: [i],
    });
  }

  const perPage = profile.answersPerPage[trimSize];
  if (profile.hasAnswerKey && perPage > 0) {
    for (let start = 0, page = 0; start < options.contentCount; start += perPage, page++) {
      const indexes = Array.from({ length: Math.min(perPage, options.contentCount - start) }, (_, k) => start + k);
      items.push({
        id: `answers-${page + 1}`,
        role: "answer-key",
        addBackingPage: false,
        startOnRecto: page === 0,
        contentIndexes: indexes,
      });
    }
  }

  const slots = buildPageSequence(items, { padToMinimum: options.padToMinimum ?? true });
  return { items, slots, issues: validateSequence(slots, paperType, trimSize) };
}
