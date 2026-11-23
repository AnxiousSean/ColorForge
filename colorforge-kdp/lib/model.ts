/**
 * Project data model: everything persisted to IndexedDB.
 *
 * Artwork coordinates are in inches relative to the TRIM box's top-left
 * corner (not the PDF page). The trim box moves when bleed is toggled or a
 * page switches sides, and storing art in trim space means it never moves
 * with it.
 */

import { BOOK_PROFILES, planBook, type BookPlan, type BookType } from "@/lib/book-types";
import type { PaperType, TrimSizeId } from "@/lib/kdp";
import type { Difficulty, SearchEntry, SearchPuzzle } from "@/lib/puzzles/search-grid";
import { FONT_FAMILIES, cssFontStack, type BookFont } from "@/lib/text-metrics";

export const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Vector shapes
// ---------------------------------------------------------------------------

interface ShapeBase {
  id: string;
  /** Stroke width in inches. */
  strokeWidth: number;
  /**
   * White "paint" from the eraser. It stays a vector in the PDF and prints
   * as paper, so line art is never rasterised.
   */
  erase?: boolean;
}

export interface PathShape extends ShapeBase {
  type: "path";
  /** Flat list of x, y pairs. */
  points: number[];
}

export interface EllipseShape extends ShapeBase {
  type: "ellipse";
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Radians, about the centre. */
  rotation?: number;
}

export interface RectShape extends ShapeBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, about the centre. */
  rotation?: number;
}

export interface PolygonShape extends ShapeBase {
  type: "polygon";
  cx: number;
  cy: number;
  radius: number;
  sides: number;
  /** Radians. */
  rotation: number;
}

export interface TextShape extends ShapeBase {
  type: "text";
  x: number;
  /** Baseline. */
  y: number;
  text: string;
  /** Font size in inches (cap-to-descender height). */
  fontSize: number;
  font: BookFont;
}

export type Shape = PathShape | EllipseShape | RectShape | PolygonShape | TextShape;

export type { BookFont } from "@/lib/text-metrics";

/** Fonts the export engine bundles and turns into vector outlines. */
export const BOOK_FONTS: Readonly<Record<BookFont, { label: string; css: string }>> = {
  sans: { label: FONT_FAMILIES.sans.label, css: cssFontStack("sans") },
  serif: { label: FONT_FAMILIES.serif.label, css: cssFontStack("serif") },
  rounded: { label: FONT_FAMILIES.rounded.label, css: cssFontStack("rounded") },
};

// ---------------------------------------------------------------------------
// Content items and projects
// ---------------------------------------------------------------------------

export interface DesignItem {
  kind: "design";
  id: string;
  name: string;
  addBackingPage: boolean;
  shapes: Shape[];
}

export interface PuzzleItem {
  kind: "puzzle";
  id: string;
  /** Printed heading, usually the theme. */
  title: string;
  entries: SearchEntry[];
  seed: string;
  /** Cached generated grid; regenerated whenever entries, seed, or settings change. */
  puzzle: SearchPuzzle | null;
}

export type ContentItem = DesignItem | PuzzleItem;

export interface PuzzleSettings {
  rows: number;
  cols: number;
  difficulty: Difficulty;
  entriesPerPuzzle: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  type: BookType;
  title: string;
  subtitle: string;
  author: string;
  trimSize: TrimSizeId;
  hasBleed: boolean;
  paperType: PaperType;
  seed: string;
  includeFrontMatter: boolean;
  puzzleSettings: PuzzleSettings | null;
  items: ContentItem[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  type: BookType;
  title: string;
  author: string;
  trimSize: TrimSizeId;
  contentCount: number;
  pageCount: number;
  issueCount: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Factories and derived data
// ---------------------------------------------------------------------------

export function newId(prefix = "id"): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export interface NewProjectInput {
  type: BookType;
  title: string;
  subtitle?: string;
  author?: string;
  trimSize?: TrimSizeId;
  seed?: string;
  puzzleSettings?: Partial<PuzzleSettings>;
  items?: ContentItem[];
}

export function createProject(input: NewProjectInput): Project {
  const profile = BOOK_PROFILES[input.type];
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newId("book"),
    type: input.type,
    title: input.title.trim() || "Untitled book",
    subtitle: input.subtitle?.trim() ?? "",
    author: input.author?.trim() ?? "",
    trimSize: input.trimSize ?? profile.trimSize,
    hasBleed: profile.hasBleed,
    paperType: profile.paperType,
    seed: input.seed ?? newId("seed"),
    includeFrontMatter: true,
    puzzleSettings: profile.puzzle ? { ...profile.puzzle, ...input.puzzleSettings } : null,
    items: input.items ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDesign(name: string, addBackingPage = true): DesignItem {
  return { kind: "design", id: newId("design"), name, addBackingPage, shapes: [] };
}

export function planProject(project: Project): BookPlan {
  return planBook({
    type: project.type,
    trimSize: project.trimSize,
    paperType: project.paperType,
    includeFrontMatter: project.includeFrontMatter,
    content: project.items.map((item) => ({
      id: item.id,
      addBackingPage: item.kind === "design" ? item.addBackingPage : undefined,
    })),
  });
}

export function summarize(project: Project): ProjectSummary {
  const plan = planProject(project);
  return {
    id: project.id,
    type: project.type,
    title: project.title,
    author: project.author,
    trimSize: project.trimSize,
    contentCount: project.items.length,
    pageCount: plan.slots.length,
    issueCount: plan.issues.filter((i) => i.severity === "error").length,
    updatedAt: project.updatedAt,
  };
}
