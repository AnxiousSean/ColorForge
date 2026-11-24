/**
 * Resolves each physical page of a book to what should be drawn on it.
 */

import { BOOK_PROFILES, type BookPlan, type PlannedPage } from "@/lib/book-types";
import type { PageSlot } from "@/lib/kdp";
import { planProject, type ContentItem, type DesignItem, type Project, type PuzzleItem } from "@/lib/model";

export type ResolvedPage =
  | { kind: "blank"; slot: PageSlot; reason: "backing" | "filler" }
  | { kind: "title"; slot: PageSlot }
  | { kind: "copyright"; slot: PageSlot }
  | { kind: "design"; slot: PageSlot; item: DesignItem; index: number }
  | { kind: "puzzle"; slot: PageSlot; item: PuzzleItem; index: number; heading: string }
  | { kind: "answer-key"; slot: PageSlot; puzzles: Array<{ item: PuzzleItem; index: number; heading: string }>; perPage: number };

export interface ResolvedBook {
  plan: BookPlan;
  pages: ResolvedPage[];
}

/** The printed heading of a puzzle, numbered by its position in the book. */
export function puzzleHeading(project: Project, item: PuzzleItem, index: number): string {
  const n = index + 1;
  if (project.type === "number-search" && /^Puzzle \d+$/.test(item.title)) return `Puzzle ${n}`;
  return `${n}. ${item.title}`;
}

export function resolveBook(project: Project): ResolvedBook {
  const plan = planProject(project);
  const byId = new Map<string, PlannedPage>(plan.items.map((i) => [i.id, i]));
  const items = new Map<string, ContentItem>(project.items.map((i) => [i.id, i]));
  const perPage = BOOK_PROFILES[project.type].answersPerPage[project.trimSize];

  const pages = plan.slots.map((slot): ResolvedPage => {
    if (slot.kind === "backing") return { kind: "blank", slot, reason: "backing" };
    if (slot.kind === "filler") return { kind: "blank", slot, reason: "filler" };
    const planned = byId.get(slot.itemId);
    switch (planned?.role) {
      case "title":
        return { kind: "title", slot };
      case "copyright":
        return { kind: "copyright", slot };
      case "design": {
        const item = items.get(slot.itemId);
        if (item?.kind === "design") return { kind: "design", slot, item, index: planned.contentIndexes![0]! };
        break;
      }
      case "puzzle": {
        const item = items.get(slot.itemId);
        const index = planned.contentIndexes![0]!;
        if (item?.kind === "puzzle") return { kind: "puzzle", slot, item, index, heading: puzzleHeading(project, item, index) };
        break;
      }
      case "answer-key": {
        const puzzles = planned.contentIndexes!.flatMap((index) => {
          const item = project.items[index];
          return item?.kind === "puzzle" ? [{ item, index, heading: puzzleHeading(project, item, index) }] : [];
        });
        return { kind: "answer-key", slot, puzzles, perPage };
      }
    }
    return { kind: "blank", slot, reason: "filler" };
  });

  return { plan, pages };
}

export function pageLabel(page: ResolvedPage): string {
  switch (page.kind) {
    case "blank":
      return page.reason === "backing" ? "Blank back" : "Blank";
    case "title":
      return "Title page";
    case "copyright":
      return "Copyright";
    case "design":
      return page.item.name;
    case "puzzle":
      return page.heading;
    case "answer-key":
      return `Answers ${page.puzzles[0] ? page.puzzles[0].index + 1 : ""}–${page.puzzles.at(-1) ? page.puzzles.at(-1)!.index + 1 : ""}`;
  }
}
