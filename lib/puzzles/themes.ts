/**
 * Turns word lists into a book's worth of puzzles.
 *
 * Input format (pasted into the New Book wizard):
 *
 *   # Ocean Animals
 *   dolphin, whale, shark ...
 *   # Fruits
 *   apple
 *   banana
 *
 * Each `#` heading starts a theme. Puzzles cycle through the themes, and each
 * draws its words from a shuffled deck for that theme, so a theme only repeats
 * words once every word has been used. Everything is seeded.
 */

import type { BookType } from "@/lib/book-types";
import { newId, type PuzzleItem, type PuzzleSettings } from "@/lib/model";
import { createRng } from "@/lib/rng";
import {
  DIGITS,
  DIFFICULTY_DIRECTIONS,
  LETTERS,
  generateNumberEntries,
  generateSearchPuzzle,
  parseWordList,
  type SearchEntry,
} from "@/lib/puzzles/search-grid";

export interface Theme {
  title: string;
  entries: SearchEntry[];
}

export function parseThemes(text: string): Theme[] {
  const themes: Theme[] = [];
  let title = "";
  let buffer: string[] = [];
  const flush = () => {
    const entries = parseWordList(buffer.join("\n"));
    if (entries.length > 0) themes.push({ title: title || "Word Search", entries });
    buffer = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*#+\s*(.*)$/);
    if (heading) {
      flush();
      title = heading[1]!.trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return themes;
}

/** Longest answer that can fit, given the grid and the allowed directions. */
export function maxAnswerLength(settings: Pick<PuzzleSettings, "rows" | "cols" | "difficulty">): number {
  const dirs = DIFFICULTY_DIRECTIONS[settings.difficulty];
  const horizontal = dirs.some((d) => d.dRow === 0) ? settings.cols : 0;
  const vertical = dirs.some((d) => d.dCol === 0) ? settings.rows : 0;
  return Math.max(horizontal, vertical);
}

export interface BuildPuzzlesInput {
  type: Exclude<BookType, "coloring">;
  settings: PuzzleSettings;
  bookSeed: string;
  puzzleCount: number;
  /** Required for word search; ignored for number search. */
  themes?: readonly Theme[];
}

export interface BuildPuzzlesResult {
  items: PuzzleItem[];
  /** Words dropped because they are longer than the grid allows. */
  tooLong: string[];
}

export function buildPuzzleItems(input: BuildPuzzlesInput): BuildPuzzlesResult {
  const { settings, bookSeed, puzzleCount, type } = input;
  const items: PuzzleItem[] = [];
  const tooLong: string[] = [];

  if (type === "number-search") {
    for (let i = 0; i < puzzleCount; i++) {
      const seed = `${bookSeed}/p${i + 1}`;
      items.push(
        makePuzzleItem(`Puzzle ${i + 1}`, generateNumberEntries(settings.entriesPerPuzzle, seed), seed, type, settings),
      );
    }
    return { items, tooLong };
  }

  const limit = maxAnswerLength(settings);
  const themes = (input.themes ?? [])
    .map((t) => {
      const fit = t.entries.filter((e) => e.answer.length <= limit);
      tooLong.push(...t.entries.filter((e) => e.answer.length > limit).map((e) => e.display));
      return { ...t, entries: fit };
    })
    .filter((t) => t.entries.length > 0);
  if (themes.length === 0) return { items, tooLong };

  const rng = createRng(`${bookSeed}/themes`);
  const decks = themes.map(() => [] as SearchEntry[]);
  const uses = themes.map(() => 0);

  for (let i = 0; i < puzzleCount; i++) {
    const t = i % themes.length;
    const theme = themes[t]!;
    const want = Math.min(settings.entriesPerPuzzle, theme.entries.length);
    const chosen: SearchEntry[] = [];
    while (chosen.length < want) {
      if (decks[t]!.length === 0) decks[t] = rng.shuffle(theme.entries);
      const next = decks[t]!.pop()!;
      if (!chosen.some((c) => c.answer === next.answer)) chosen.push(next);
    }
    uses[t]! += 1;
    const title = uses[t]! > 1 ? `${theme.title} ${uses[t]}` : theme.title;
    items.push(makePuzzleItem(title, chosen, `${bookSeed}/p${i + 1}`, type, settings));
  }
  return { items, tooLong: [...new Set(tooLong)] };
}

export function makePuzzleItem(
  title: string,
  entries: SearchEntry[],
  seed: string,
  type: Exclude<BookType, "coloring">,
  settings: PuzzleSettings,
): PuzzleItem {
  const item: PuzzleItem = { kind: "puzzle", id: newId("puzzle"), title, entries, seed, puzzle: null };
  return regeneratePuzzle(item, type, settings);
}

/** Rebuilds the cached grid from the item's entries and seed. */
export function regeneratePuzzle(
  item: PuzzleItem,
  type: Exclude<BookType, "coloring">,
  settings: PuzzleSettings,
): PuzzleItem {
  const puzzle = generateSearchPuzzle({
    entries: item.entries,
    rows: settings.rows,
    cols: settings.cols,
    difficulty: settings.difficulty,
    alphabet: type === "number-search" ? DIGITS : LETTERS,
    seed: item.seed,
  });
  return { ...item, puzzle };
}

/** A starter library so a first book can be made with no typing. */
export const STARTER_THEMES = `# Ocean Life
dolphin, whale, shark, octopus, coral, starfish, seahorse, jellyfish, lobster, crab, turtle, squid, oyster, clam, seaweed, anemone, plankton, stingray, walrus, orca, barnacle, mussel, shrimp, urchin, pelican
# Fruits
apple, banana, cherry, grape, mango, peach, pear, plum, kiwi, lemon, lime, orange, papaya, guava, melon, apricot, coconut, fig, date, raspberry, blueberry, strawberry, pineapple, nectarine, tangerine
# Garden
flower, rose, tulip, daisy, lily, orchid, shovel, rake, seeds, soil, compost, hose, watering, sunflower, bloom, petal, stem, leaf, root, weed, hedge, trowel, greenhouse, butterfly, ladybug
# Kitchen
spoon, fork, knife, plate, bowl, oven, stove, kettle, toaster, blender, whisk, ladle, spatula, colander, skillet, saucepan, cupboard, napkin, apron, mixer, grater, peeler, teapot, mug, pantry
# Weather
sunny, cloudy, rain, storm, thunder, lightning, snow, sleet, hail, wind, breeze, fog, mist, drizzle, rainbow, frost, humid, tornado, hurricane, blizzard, forecast, climate, monsoon, drought, heatwave
# Travel
passport, luggage, ticket, airport, train, cruise, hotel, beach, mountain, camera, map, compass, journey, tourist, suitcase, vacation, island, souvenir, museum, adventure, backpack, highway, ferry, safari, voyage
`;
