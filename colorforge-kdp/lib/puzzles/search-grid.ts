/**
 * Word search and number search generator. Both use the same engine: words
 * or numbers are placed into a grid along straight lines, and the empty
 * cells are filled with random symbols from the same alphabet.
 *
 * What makes a puzzle publishable rather than just generated:
 * - Deterministic: the same seed always gives the same grid.
 * - Unambiguous: every entry appears exactly once in the final grid, in any
 *   of the 8 directions (a solver can read any way, whatever the difficulty).
 *   Random fill can create accidental second copies, so the filler is
 *   re-rolled until there are none.
 * - Honest: entries that cannot fit are reported, never silently dropped.
 */

import { createRng, type Rng } from "@/lib/rng";

export const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIGITS = "0123456789";

export type Difficulty = "easy" | "medium" | "hard";

/** Row and column step for each reading direction. */
export interface Direction {
  dRow: number;
  dCol: number;
}

const E = { dRow: 0, dCol: 1 };
const S = { dRow: 1, dCol: 0 };
const SE = { dRow: 1, dCol: 1 };
const NE = { dRow: -1, dCol: 1 };
const W = { dRow: 0, dCol: -1 };
const N = { dRow: -1, dCol: 0 };
const NW = { dRow: -1, dCol: -1 };
const SW = { dRow: 1, dCol: -1 };

export const ALL_DIRECTIONS: readonly Direction[] = [E, S, SE, NE, W, N, NW, SW];

/** Directions entries may be hidden in, per difficulty. */
export const DIFFICULTY_DIRECTIONS: Readonly<Record<Difficulty, readonly Direction[]>> = {
  easy: [E, S],
  medium: [E, S, SE, NE],
  hard: ALL_DIRECTIONS,
};

export interface SearchEntry {
  /** What is printed in the word list, e.g. "Ice Cream". */
  display: string;
  /** What is hidden in the grid, e.g. "ICECREAM". */
  answer: string;
}

export interface Placement extends SearchEntry, Direction {
  row: number;
  col: number;
  cells: ReadonlyArray<readonly [row: number, col: number]>;
}

export interface SearchPuzzleOptions {
  entries: readonly SearchEntry[];
  rows: number;
  cols: number;
  difficulty: Difficulty;
  alphabet: string;
  seed: string | number;
}

export interface SearchPuzzle {
  rows: number;
  cols: number;
  difficulty: Difficulty;
  seed: string;
  grid: string[][];
  /** Placed entries, in the order the word list should be printed. */
  placements: Placement[];
  /** Entries that did not fit. */
  unplaced: SearchEntry[];
  /** Entries that still appear more than once (should be empty). */
  ambiguous: SearchEntry[];
}

const MAX_LAYOUT_ATTEMPTS = 12;
const MAX_FILL_ATTEMPTS = 30;

// ---------------------------------------------------------------------------
// Entry preparation
// ---------------------------------------------------------------------------

/** Uppercases, strips accents, and drops anything not in `alphabet`. */
export function normalizeAnswer(text: string, alphabet: string = LETTERS): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split("")
    .filter((ch) => alphabet.includes(ch))
    .join("");
}

/**
 * Parses a pasted word list (one per line, or separated by commas or
 * semicolons). Removes duplicates and anything too short to hide.
 */
export function parseWordList(text: string, alphabet: string = LETTERS, minLength = 3): SearchEntry[] {
  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const display = raw.trim().replace(/\s+/g, " ");
    const answer = normalizeAnswer(display, alphabet);
    if (answer.length < minLength || seen.has(answer)) continue;
    seen.add(answer);
    out.push({ display, answer });
  }
  return out;
}

/**
 * Random numbers for a number search: no leading zero, no palindromes (a
 * palindrome reads the same backwards, so its location is ambiguous), and
 * no duplicates.
 */
export function generateNumberEntries(
  count: number,
  seed: string | number,
  minDigits = 5,
  maxDigits = 7,
): SearchEntry[] {
  const rng = createRng(`numbers/${seed}`);
  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  let guard = 0;
  while (out.length < count) {
    if (++guard > count * 1000) throw new RangeError("Could not generate enough distinct numbers");
    const len = rng.int(minDigits, maxDigits);
    let n = String(rng.int(1, 9));
    while (n.length < len) n += String(rng.int(0, 9));
    if (n === [...n].reverse().join("") || seen.has(n)) continue;
    seen.add(n);
    out.push({ display: n, answer: n });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export function generateSearchPuzzle(options: SearchPuzzleOptions): SearchPuzzle {
  const { rows, cols, difficulty, alphabet } = options;
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 3 || cols < 3) {
    throw new RangeError(`Grid must be at least 3 × 3, got ${rows} × ${cols}`);
  }
  const seed = String(options.seed);
  const rng = createRng(seed);

  // Reject entries with symbols outside the alphabet or duplicates up front.
  const seen = new Set<string>();
  const entries = options.entries.filter((e) => {
    const ok = e.answer.length >= 2 && [...e.answer].every((c) => alphabet.includes(c)) && !seen.has(e.answer);
    seen.add(e.answer);
    return ok;
  });

  let best: SearchPuzzle | null = null;
  for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
    const layoutRng = rng.fork(`layout-${attempt}`);
    const { grid, placements, unplaced } = layoutEntries(entries, rows, cols, DIFFICULTY_DIRECTIONS[difficulty], layoutRng);
    const ambiguous = fillUnambiguously(grid, placements, entries, alphabet, layoutRng.fork("fill"));
    const candidate: SearchPuzzle = {
      rows,
      cols,
      difficulty,
      seed,
      grid,
      placements: orderForPrinting(placements, entries),
      unplaced,
      ambiguous,
    };
    if (!best || score(candidate) < score(best)) best = candidate;
    if (unplaced.length === 0 && ambiguous.length === 0) break;
  }
  return best!;
}

/** Fewer problems is better; an ambiguous entry is worse than a missing one. */
const score = (p: SearchPuzzle) => p.ambiguous.length * 1000 + p.unplaced.length;

function layoutEntries(
  entries: readonly SearchEntry[],
  rows: number,
  cols: number,
  directions: readonly Direction[],
  rng: Rng,
): { grid: string[][]; placements: Placement[]; unplaced: SearchEntry[] } {
  const grid: string[][] = Array.from({ length: rows }, () => Array<string>(cols).fill(""));
  const placements: Placement[] = [];
  const unplaced: SearchEntry[] = [];

  // Longest first: they are the hardest to fit. Shuffle first for variety in ties.
  const order = rng.shuffle(entries).sort((a, b) => b.answer.length - a.answer.length);

  for (const entry of order) {
    const candidates: Array<{ row: number; col: number; dir: Direction; overlap: number }> = [];
    for (const dir of directions) {
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const overlap = fitOverlap(grid, entry.answer, row, col, dir);
          if (overlap >= 0) candidates.push({ row, col, dir, overlap });
        }
      }
    }
    if (candidates.length === 0) {
      unplaced.push(entry);
      continue;
    }
    // Mostly random, with a mild preference for crossing other entries so
    // grids look interwoven rather than like a list of separate lines.
    const shuffled = rng.shuffle(candidates);
    const crossing = shuffled.filter((c) => c.overlap > 0 && c.overlap < entry.answer.length);
    const choice = crossing.length > 0 && rng.next() < 0.4 ? crossing[0]! : shuffled[0]!;

    const cells: Array<readonly [number, number]> = [];
    for (let i = 0; i < entry.answer.length; i++) {
      const r = choice.row + choice.dir.dRow * i;
      const c = choice.col + choice.dir.dCol * i;
      grid[r]![c] = entry.answer[i]!;
      cells.push([r, c]);
    }
    placements.push({ ...entry, row: choice.row, col: choice.col, ...choice.dir, cells });
  }
  return { grid, placements, unplaced };
}

/**
 * Returns how many letters of `answer` already sit in the grid along this
 * line (-1 if it does not fit). Never allows an entry to sit entirely on top
 * of another one.
 */
function fitOverlap(grid: string[][], answer: string, row: number, col: number, dir: Direction): number {
  const rows = grid.length;
  const cols = grid[0]!.length;
  const endR = row + dir.dRow * (answer.length - 1);
  const endC = col + dir.dCol * (answer.length - 1);
  if (endR < 0 || endR >= rows || endC < 0 || endC >= cols) return -1;
  let overlap = 0;
  for (let i = 0; i < answer.length; i++) {
    const cell = grid[row + dir.dRow * i]![col + dir.dCol * i]!;
    if (cell === "") continue;
    if (cell !== answer[i]) return -1;
    overlap++;
  }
  return overlap === answer.length ? -1 : overlap;
}

/**
 * Fills empty cells, re-rolling until every placed entry appears exactly
 * once. Returns the entries that are still ambiguous.
 */
function fillUnambiguously(
  grid: string[][],
  placements: readonly Placement[],
  entries: readonly SearchEntry[],
  alphabet: string,
  rng: Rng,
): SearchEntry[] {
  const empty: Array<[number, number]> = [];
  grid.forEach((row, r) => row.forEach((cell, c) => cell === "" && empty.push([r, c])));

  // An entry inside another entry (CAT in CATERPILLAR) always appears twice;
  // that is expected and not counted as ambiguous.
  const checkable = placements.filter((p) => !isContainedInOther(p.answer, entries));

  let ambiguous: SearchEntry[] = [];
  for (let attempt = 0; attempt < MAX_FILL_ATTEMPTS; attempt++) {
    for (const [r, c] of empty) grid[r]![c] = rng.pick([...alphabet]);
    ambiguous = checkable.filter((p) => countOccurrences(grid, p.answer) > 1).map(({ display, answer }) => ({ display, answer }));
    if (ambiguous.length === 0) break;
  }
  return ambiguous;
}

function isContainedInOther(answer: string, entries: readonly SearchEntry[]): boolean {
  return entries.some(
    (e) => e.answer !== answer && (e.answer.includes(answer) || [...e.answer].reverse().join("").includes(answer)),
  );
}

/**
 * Number of distinct places `answer` can be read in the grid, in any of the
 * 8 directions. A palindrome read backwards over the same cells counts once.
 */
export function countOccurrences(grid: readonly (readonly string[])[], answer: string): number {
  const found = new Set<string>();
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row]![col] !== answer[0]) continue;
      for (const dir of ALL_DIRECTIONS) {
        const cells: string[] = [];
        let ok = true;
        for (let i = 0; i < answer.length && ok; i++) {
          const r = row + dir.dRow * i;
          const c = col + dir.dCol * i;
          ok = r >= 0 && r < rows && c >= 0 && c < cols && grid[r]![c] === answer[i];
          cells.push(`${r},${c}`);
        }
        if (ok) found.add(cells.sort().join("|"));
      }
    }
  }
  return found.size;
}

/** Word lists print alphabetically for words and numerically for numbers. */
function orderForPrinting(placements: Placement[], entries: readonly SearchEntry[]): Placement[] {
  const numeric = entries.every((e) => /^\d+$/.test(e.answer));
  return [...placements].sort((a, b) =>
    numeric ? Number(a.answer) - Number(b.answer) : a.display.localeCompare(b.display, "en", { sensitivity: "base" }),
  );
}
