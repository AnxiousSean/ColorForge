import { describe, expect, it } from "vitest";
import { planBook } from "@/lib/book-types";
import { createRng } from "@/lib/rng";
import {
  DIGITS,
  DIFFICULTY_DIRECTIONS,
  LETTERS,
  countOccurrences,
  generateNumberEntries,
  generateSearchPuzzle,
  normalizeAnswer,
  parseWordList,
} from "@/lib/puzzles/search-grid";

const OCEAN = parseWordList(`
  Dolphin, Whale, Shark, Octopus, Coral, Starfish, Seahorse, Jellyfish, Lobster, Crab,
  Turtle, Squid, Oyster, Clam, Seaweed, Anemone, Plankton, Stingray, Walrus, Orca
`);

describe("rng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = createRng("book-1");
    const b = createRng("book-1");
    const c = createRng("book-2");
    const seqA = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seqA);
    expect(Array.from({ length: 5 }, () => c.next())).not.toEqual(seqA);
  });

  it("int stays within inclusive bounds", () => {
    const r = createRng(1);
    const values = Array.from({ length: 1000 }, () => r.int(3, 5));
    expect(new Set(values)).toEqual(new Set([3, 4, 5]));
  });
});

describe("word list parsing", () => {
  it("normalizes, strips accents and spaces, and dedupes", () => {
    expect(normalizeAnswer("Crème brûlée")).toBe("CREMEBRULEE");
    expect(parseWordList("Ice Cream\nice-cream; Pie, ok")).toEqual([
      { display: "Ice Cream", answer: "ICECREAM" },
      { display: "Pie", answer: "PIE" },
    ]);
  });
});

describe("generateSearchPuzzle", () => {
  const make = (seed: string, difficulty: "easy" | "medium" | "hard" = "hard") =>
    generateSearchPuzzle({ entries: OCEAN, rows: 15, cols: 15, difficulty, alphabet: LETTERS, seed });

  it("places every word exactly once with a full grid", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const p = make(seed);
      expect(p.unplaced).toEqual([]);
      expect(p.ambiguous).toEqual([]);
      expect(p.placements).toHaveLength(OCEAN.length);
      expect(p.grid.flat().every((ch) => LETTERS.includes(ch) && ch.length === 1)).toBe(true);
      for (const pl of p.placements) {
        expect(pl.cells.map(([r, c]) => p.grid[r]![c]).join("")).toBe(pl.answer);
        expect(countOccurrences(p.grid, pl.answer)).toBe(1);
      }
    }
  });

  it("is reproducible from its seed", () => {
    expect(make("same")).toEqual(make("same"));
    expect(make("same").grid).not.toEqual(make("other").grid);
  });

  it("only uses the directions allowed by the difficulty", () => {
    const allowed = DIFFICULTY_DIRECTIONS.easy;
    const p = make("easy-1", "easy");
    for (const pl of p.placements) {
      expect(allowed.some((d) => d.dRow === pl.dRow && d.dCol === pl.dCol)).toBe(true);
    }
  });

  it("reports words that cannot fit instead of dropping them", () => {
    const p = generateSearchPuzzle({
      entries: [{ display: "Hippopotamus", answer: "HIPPOPOTAMUS" }],
      rows: 5,
      cols: 5,
      difficulty: "hard",
      alphabet: LETTERS,
      seed: 1,
    });
    expect(p.unplaced.map((e) => e.answer)).toEqual(["HIPPOPOTAMUS"]);
  });

  it("prints the word list alphabetically", () => {
    const names = make("order").placements.map((p) => p.display);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("rejects grids that are too small", () => {
    expect(() => generateSearchPuzzle({ entries: OCEAN, rows: 2, cols: 15, difficulty: "easy", alphabet: LETTERS, seed: 1 })).toThrow(
      RangeError,
    );
  });
});

describe("number search", () => {
  it("generates distinct, non-palindromic numbers without leading zeros", () => {
    const nums = generateNumberEntries(40, "n1");
    expect(new Set(nums.map((n) => n.answer)).size).toBe(40);
    for (const { answer } of nums) {
      expect(answer[0]).not.toBe("0");
      expect(answer).not.toBe([...answer].reverse().join(""));
      expect(answer.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("builds unambiguous number grids", () => {
    for (const seed of ["n-a", "n-b", "n-c"]) {
      const p = generateSearchPuzzle({
        entries: generateNumberEntries(20, seed),
        rows: 15,
        cols: 15,
        difficulty: "hard",
        alphabet: DIGITS,
        seed,
      });
      expect(p.unplaced).toEqual([]);
      expect(p.ambiguous).toEqual([]);
      const printed = p.placements.map((pl) => Number(pl.answer));
      expect(printed).toEqual([...printed].sort((a, b) => a - b));
    }
  });
});

describe("planBook", () => {
  it("a 100-puzzle word search book passes KDP page checks", () => {
    const plan = planBook({ type: "word-search", content: 100 });
    // 2 front matter + 100 puzzles + 17 answer pages (6 per page) = 119 -> 120
    expect(plan.slots).toHaveLength(120);
    expect(plan.issues).toEqual([]);
    expect(plan.items.filter((i) => i.role === "answer-key")).toHaveLength(17);
  });

  it("starts the answer key on a right-hand page", () => {
    const plan = planBook({ type: "number-search", content: 31 });
    const firstKey = plan.slots.find((s) => s.kind === "content" && s.itemId === "answers-1")!;
    expect(firstKey.pageNumber % 2).toBe(1);
    expect(plan.issues).toEqual([]);
  });

  it("puts every coloring design on a right-hand page with a blank back", () => {
    const plan = planBook({ type: "coloring", content: 30 });
    const designs = plan.slots.filter((s) => s.kind === "content" && s.itemId.startsWith("design-"));
    expect(designs).toHaveLength(30);
    expect(designs.every((s) => s.pageNumber % 2 === 1)).toBe(true);
    expect(plan.issues).toEqual([]);
  });

  it("keeps later single-sided designs on right-hand pages after a double-sided one", () => {
    const plan = planBook({
      type: "coloring",
      includeFrontMatter: false,
      content: [{ id: "a" }, { id: "b", addBackingPage: false }, { id: "c" }],
    });
    const page = (id: string) => plan.slots.find((s) => s.kind === "content" && s.itemId === id)!.pageNumber;
    expect([page("a"), page("b"), page("c")]).toEqual([1, 3, 5]);
  });

  it("flags a coloring book that is too short to pad legally", () => {
    const plan = planBook({ type: "coloring", content: 5 });
    expect(plan.issues.map((i) => i.code)).toContain("below-minimum");
  });
});
