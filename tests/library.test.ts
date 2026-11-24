import { describe, expect, it } from "vitest";
import { LIBRARY_CATEGORIES, THEME_LIBRARY, libraryToText } from "@/lib/puzzles/library";
import { normalizeAnswer, parseWordList } from "@/lib/puzzles/search-grid";
import { buildPuzzleItems, parseThemes } from "@/lib/puzzles/themes";

describe("theme library", () => {
  it("has many themes with unique titles", () => {
    expect(THEME_LIBRARY.length).toBeGreaterThanOrEqual(45);
    expect(new Set(THEME_LIBRARY.map((t) => t.title)).size).toBe(THEME_LIBRARY.length);
    expect(LIBRARY_CATEGORIES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(THEME_LIBRARY.map((t) => [t.title, t] as const))("%s: 25 distinct words that fit a 13 × 13 grid", (_, theme) => {
    const raw = theme.words.split(",").map((w) => w.trim());
    const entries = parseWordList(theme.words);
    expect(raw).toHaveLength(25);
    expect(entries).toHaveLength(25); // no duplicates after normalising
    for (const e of entries) {
      expect(e.answer.length).toBeGreaterThanOrEqual(2);
      expect(e.answer.length).toBeLessThanOrEqual(13);
      expect(e.answer).toBe(normalizeAnswer(e.display));
    }
  });

  it("builds a full 100-puzzle book from the library with no failures", () => {
    const themes = parseThemes(libraryToText());
    const settings = { rows: 15, cols: 15, difficulty: "hard" as const, entriesPerPuzzle: 20 };
    const { items, tooLong } = buildPuzzleItems({ type: "word-search", settings, bookSeed: "lib", puzzleCount: 100, themes });
    expect(tooLong).toEqual([]);
    expect(items).toHaveLength(100);
    expect(items.every((i) => i.puzzle!.unplaced.length === 0 && i.puzzle!.ambiguous.length === 0)).toBe(true);
    // 51 themes over 100 puzzles: no theme is used more than twice.
    const uses = new Map<string, number>();
    for (const i of items) {
      const base = i.title.replace(/ \d+$/, "");
      uses.set(base, (uses.get(base) ?? 0) + 1);
    }
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(2);
  });

  it("can export a subset of themes", () => {
    const text = libraryToText(new Set(["Birds", "Dinosaurs"]));
    expect(parseThemes(text).map((t) => t.title)).toEqual(["Birds", "Dinosaurs"]);
  });
});
