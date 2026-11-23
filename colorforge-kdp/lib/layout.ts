/**
 * Page layout: where every element of a page goes, in PDF-page inches
 * (top-left origin). Pure functions shared by the on-screen preview and the
 * PDF export, so what you see is exactly what prints.
 */

import {
  getPageDimensions,
  getPageSide,
  getSafeArea,
  getTrimBox,
  type Dimensions,
  type PageSide,
  type Rect,
  type TrimSizeId,
} from "@/lib/kdp";
import { TEXT_WIDTH_FACTOR } from "@/lib/geometry";
import type { SearchPuzzle } from "@/lib/puzzles/search-grid";

export interface PageContext {
  pageNumber: number;
  pageCount: number;
  side: PageSide;
  page: Dimensions;
  trim: Rect;
  /** KDP hard minimum: crossing it is a preflight error. */
  kdpSafe: Rect;
  /** Where the app lays content out. */
  recommended: Rect;
  hasBleed: boolean;
}

export function getPageContext(trimSize: TrimSizeId, hasBleed: boolean, pageCount: number, pageNumber: number): PageContext {
  return {
    pageNumber,
    pageCount,
    side: getPageSide(pageNumber),
    page: getPageDimensions(trimSize, hasBleed),
    trim: getTrimBox(trimSize, hasBleed, pageNumber),
    kdpSafe: getSafeArea(trimSize, hasBleed, pageCount, pageNumber, "kdp-minimum"),
    recommended: getSafeArea(trimSize, hasBleed, pageCount, pageNumber, "recommended"),
    hasBleed,
  };
}

export interface TextBox {
  text: string;
  /** Anchor x: the centre of the text when `anchor` is "middle". */
  x: number;
  /** Baseline. */
  y: number;
  size: number;
  anchor: "start" | "middle";
  weight?: "normal" | "bold";
}

export const estimateTextWidth = (text: string, size: number) => text.length * size * TEXT_WIDTH_FACTOR;

/** Greedy word wrap using the approximate width model. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (line && estimateTextWidth(candidate, size) > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest size (up to `max`) at which `text` fits in `width` on one line. */
export function fitTextSize(text: string, width: number, max: number, min = max * 0.5): number {
  const natural = width / Math.max(1, text.length * TEXT_WIDTH_FACTOR);
  return Math.max(min, Math.min(max, natural));
}

// ---------------------------------------------------------------------------
// Puzzle pages
// ---------------------------------------------------------------------------

export interface GridLayout {
  x: number;
  y: number;
  cell: number;
  rows: number;
  cols: number;
  letterSize: number;
}

export interface PuzzlePageLayout {
  title: TextBox;
  grid: GridLayout;
  words: TextBox[];
}

/** How far the rounded grid frame sits outside the letters, in cells. */
export const FRAME_RATIO = 0.18;

/** Large-print sizes, in inches. */
const PUZZLE = {
  titleMax: 0.34,
  gap: 0.22,
  wordSize: 0.2,
  wordRow: 0.3,
  maxCell: 0.55,
  letterRatio: 0.58,
};

export function layoutPuzzlePage(puzzle: Pick<SearchPuzzle, "rows" | "cols">, words: readonly string[], title: string, area: Rect): PuzzlePageLayout {
  const titleSize = fitTextSize(title, area.widthIn, PUZZLE.titleMax);
  const titleBox: TextBox = {
    text: title,
    x: area.xIn + area.widthIn / 2,
    y: area.yIn + titleSize,
    size: titleSize,
    anchor: "middle",
    weight: "bold",
  };

  const columns = words.length <= 8 ? 2 : words.length <= 21 ? 3 : 4;
  const colWidth = area.widthIn / columns;
  const longest = words.reduce((m, w) => Math.max(m, w.length), 1);
  const wordSize = Math.min(PUZZLE.wordSize, (colWidth * 0.92) / (longest * TEXT_WIDTH_FACTOR));
  const wordRows = Math.ceil(words.length / columns);
  const wordBlock = wordRows * PUZZLE.wordRow;

  const top = titleBox.y + PUZZLE.gap;
  const available = area.yIn + area.heightIn - top - PUZZLE.gap - wordBlock;
  const cell = Math.min(
    PUZZLE.maxCell,
    area.widthIn / (puzzle.cols + FRAME_RATIO * 2),
    available / (puzzle.rows + FRAME_RATIO * 2),
  );
  const gridWidth = cell * puzzle.cols;
  const grid: GridLayout = {
    x: area.xIn + (area.widthIn - gridWidth) / 2,
    y: top + cell * FRAME_RATIO,
    cell,
    rows: puzzle.rows,
    cols: puzzle.cols,
    letterSize: cell * PUZZLE.letterRatio,
  };

  // Words fill down each column, then across, like a printed index.
  const listTop = grid.y + cell * (puzzle.rows + FRAME_RATIO) + PUZZLE.gap;
  const wordBoxes = words.map((text, i): TextBox => {
    const col = Math.floor(i / wordRows);
    const row = i % wordRows;
    return {
      text,
      x: area.xIn + colWidth * col + colWidth / 2,
      y: listTop + PUZZLE.wordRow * row + wordSize,
      size: wordSize,
      anchor: "middle",
    };
  });

  return { title: titleBox, grid, words: wordBoxes };
}

/** Centre of a grid cell. */
export const cellCenter = (g: GridLayout, row: number, col: number) =>
  [g.x + g.cell * (col + 0.5), g.y + g.cell * (row + 0.5)] as const;

// ---------------------------------------------------------------------------
// Answer key pages
// ---------------------------------------------------------------------------

export interface AnswerSlotLayout {
  label: TextBox;
  grid: GridLayout;
}

export interface AnswerKeyLayout {
  heading: TextBox;
  slots: AnswerSlotLayout[];
}

export function layoutAnswerKey(
  puzzles: ReadonlyArray<{ rows: number; cols: number; label: string }>,
  perPage: number,
  area: Rect,
): AnswerKeyLayout {
  const headingSize = 0.3;
  const heading: TextBox = {
    text: "Answers",
    x: area.xIn + area.widthIn / 2,
    y: area.yIn + headingSize,
    size: headingSize,
    anchor: "middle",
    weight: "bold",
  };

  const cols = perPage === 1 ? 1 : 2;
  const rows = Math.ceil(perPage / cols);
  const top = heading.y + 0.25;
  const slotW = area.widthIn / cols;
  const slotH = (area.yIn + area.heightIn - top) / rows;
  const labelSize = 0.15;
  const pad = 0.15;

  const slots = puzzles.map((p, i): AnswerSlotLayout => {
    const sx = area.xIn + slotW * (i % cols);
    const sy = top + slotH * Math.floor(i / cols);
    // The grid frame extends FRAME_RATIO cells beyond the letters on every side.
    const cell = Math.min(
      (slotW - pad * 2) / (p.cols + FRAME_RATIO * 2),
      (slotH - labelSize - pad * 2) / (p.rows + FRAME_RATIO * 2),
    );
    const gw = cell * p.cols;
    const size = fitTextSize(p.label, slotW - pad * 2, labelSize);
    return {
      label: { text: p.label, x: sx + slotW / 2, y: sy + size, size, anchor: "middle", weight: "bold" },
      grid: {
        x: sx + (slotW - gw) / 2,
        y: sy + labelSize + pad * 0.6 + cell * FRAME_RATIO,
        cell,
        rows: p.rows,
        cols: p.cols,
        letterSize: cell * PUZZLE.letterRatio,
      },
    };
  });
  return { heading, slots };
}

// ---------------------------------------------------------------------------
// Front matter
// ---------------------------------------------------------------------------

export function layoutTitlePage(title: string, subtitle: string, author: string, area: Rect): TextBox[] {
  const boxes: TextBox[] = [];
  const cx = area.xIn + area.widthIn / 2;
  const titleSize = 0.5;
  const titleLines = wrapText(title, titleSize, area.widthIn);
  let y = area.yIn + area.heightIn * 0.32;
  for (const line of titleLines) {
    boxes.push({ text: line, x: cx, y, size: titleSize, anchor: "middle", weight: "bold" });
    y += titleSize * 1.25;
  }
  if (subtitle) {
    y += 0.1;
    for (const line of wrapText(subtitle, 0.24, area.widthIn)) {
      boxes.push({ text: line, x: cx, y, size: 0.24, anchor: "middle" });
      y += 0.24 * 1.35;
    }
  }
  if (author) boxes.push({ text: author, x: cx, y: area.yIn + area.heightIn * 0.85, size: 0.24, anchor: "middle" });
  return boxes;
}

export function layoutCopyrightPage(title: string, author: string, year: number, area: Rect): TextBox[] {
  const size = 0.13;
  const holder = author || "the author";
  const paragraphs = [
    title,
    `Copyright © ${year} ${holder}. All rights reserved.`,
    "No part of this publication may be reproduced, distributed, or transmitted in any form or by any means without the prior written permission of the copyright holder, except for personal, non-commercial use.",
  ];
  const lines = paragraphs.flatMap((p, i) => [...wrapText(p, size, area.widthIn), ...(i < paragraphs.length - 1 ? [""] : [])]);
  const lineHeight = size * 1.5;
  const start = area.yIn + area.heightIn - lines.length * lineHeight;
  return lines
    .map((text, i) => ({ text, x: area.xIn, y: start + i * lineHeight + size, size, anchor: "start" as const }))
    .filter((b) => b.text);
}
