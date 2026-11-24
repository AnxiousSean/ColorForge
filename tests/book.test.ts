import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { isRectInside } from "@/lib/kdp";
import { FRAME_RATIO, getPageContext, layoutAnswerKey, wrapBalanced, layoutPuzzlePage, wrapText } from "@/lib/layout";
import { createDesign, createProject, summarize } from "@/lib/model";
import { pageLabel, resolveBook } from "@/lib/pages";
import { buildPuzzleItems, maxAnswerLength, parseThemes, STARTER_THEMES } from "@/lib/puzzles/themes";
import * as storage from "@/lib/storage";
import { useProjects } from "@/store/projects";

const SETTINGS = { rows: 15, cols: 15, difficulty: "medium" as const, entriesPerPuzzle: 20 };

function wordSearchBook(count = 100) {
  const themes = parseThemes(STARTER_THEMES);
  const { items } = buildPuzzleItems({ type: "word-search", settings: SETTINGS, bookSeed: "seed-1", puzzleCount: count, themes });
  return createProject({ type: "word-search", title: "Test", seed: "seed-1", puzzleSettings: SETTINGS, items });
}

describe("themes", () => {
  it("parses # headings into themes", () => {
    const themes = parseThemes("# Pets\ncat, dog\nhamster\n#Birds\nrobin, wren\n\n");
    expect(themes.map((t) => [t.title, t.entries.length])).toEqual([
      ["Pets", 3],
      ["Birds", 2],
    ]);
    expect(parseThemes("apple, pear")[0]!.title).toBe("Word Search");
  });

  it("knows the longest word that fits each difficulty", () => {
    expect(maxAnswerLength({ rows: 15, cols: 15, difficulty: "easy" })).toBe(15);
    expect(maxAnswerLength({ rows: 10, cols: 20, difficulty: "hard" })).toBe(20);
  });

  it("cycles themes and avoids repeating words until a theme runs out", () => {
    const themes = parseThemes(STARTER_THEMES);
    const { items, tooLong } = buildPuzzleItems({ type: "word-search", settings: SETTINGS, bookSeed: "s", puzzleCount: 12, themes });
    expect(tooLong).toEqual([]);
    expect(items.map((i) => i.title).slice(0, 7)).toEqual(["Ocean Life", "Fruits", "Garden", "Kitchen", "Weather", "Travel", "Ocean Life 2"]);
    // Ocean Life has 25 words: puzzle 1 takes 20, puzzle 7 takes the other 5 before any repeats.
    const first = new Set(items[0]!.entries.map((e) => e.answer));
    const second = items[6]!.entries.map((e) => e.answer);
    expect(second.filter((w) => !first.has(w))).toHaveLength(5);
    expect(items.every((i) => i.puzzle && i.puzzle.unplaced.length === 0 && i.puzzle.ambiguous.length === 0)).toBe(true);
  });

  it("is reproducible from the book seed", () => {
    const themes = parseThemes(STARTER_THEMES);
    const a = buildPuzzleItems({ type: "word-search", settings: SETTINGS, bookSeed: "x", puzzleCount: 3, themes });
    const b = buildPuzzleItems({ type: "word-search", settings: SETTINGS, bookSeed: "x", puzzleCount: 3, themes });
    expect(a.items.map((i) => i.puzzle!.grid)).toEqual(b.items.map((i) => i.puzzle!.grid));
  });

  it("drops words that are too long and reports them", () => {
    const { items, tooLong } = buildPuzzleItems({
      type: "word-search",
      settings: { ...SETTINGS, rows: 5, cols: 5 },
      bookSeed: "s",
      puzzleCount: 1,
      themes: parseThemes("cat, dog, elephant"),
    });
    expect(tooLong).toEqual(["elephant"]);
    expect(items[0]!.entries.map((e) => e.answer).sort()).toEqual(["CAT", "DOG"]);
  });

  it("builds number search puzzles", () => {
    const { items } = buildPuzzleItems({ type: "number-search", settings: SETTINGS, bookSeed: "n", puzzleCount: 3 });
    expect(items.map((i) => i.title)).toEqual(["Puzzle 1", "Puzzle 2", "Puzzle 3"]);
    expect(items.every((i) => /^\d+$/.test(i.puzzle!.grid.flat().join("")))).toBe(true);
  });
});

describe("resolveBook", () => {
  it("maps a 100-puzzle book to title, copyright, puzzles and answer pages", () => {
    const book = resolveBook(wordSearchBook());
    expect(book.pages).toHaveLength(120);
    expect(book.pages.slice(0, 3).map((p) => p.kind)).toEqual(["title", "copyright", "puzzle"]);
    expect(book.pages.filter((p) => p.kind === "answer-key")).toHaveLength(17);
    const firstPuzzle = book.pages[2]!;
    expect(pageLabel(firstPuzzle)).toBe("1. Ocean Life");
  });

  it("renumbers puzzles by position after reordering", () => {
    const project = wordSearchBook(3);
    project.items.reverse();
    const book = resolveBook(project);
    expect(book.pages.filter((p) => p.kind === "puzzle").map(pageLabel)).toEqual(["1. Garden", "2. Fruits", "3. Ocean Life"]);
  });

  it("shows blank backs for coloring designs", () => {
    const project = createProject({ type: "coloring", title: "C", items: Array.from({ length: 12 }, (_, i) => createDesign(`D${i}`)) });
    const kinds = resolveBook(project).pages.map((p) => (p.kind === "blank" ? p.reason : p.kind));
    expect(kinds.slice(0, 6)).toEqual(["title", "copyright", "design", "backing", "design", "backing"]);
    expect(summarize(project)).toMatchObject({ pageCount: 26, issueCount: 0, contentCount: 12 });
  });
});

describe("layout", () => {
  const ctx = getPageContext("letter", false, 120, 3);

  it("keeps the whole puzzle page inside the recommended margins", () => {
    const words = Array.from({ length: 20 }, (_, i) => `WORD${i}LONGER`);
    const l = layoutPuzzlePage({ rows: 15, cols: 15 }, words, "1. Ocean Life", ctx.recommended);
    const gridRect = { xIn: l.grid.x, yIn: l.grid.y, widthIn: l.grid.cell * 15, heightIn: l.grid.cell * 15 };
    expect(isRectInside(gridRect, ctx.recommended)).toBe(true);
    const lastWord = l.words.at(-1)!;
    expect(lastWord.y).toBeLessThanOrEqual(ctx.recommended.yIn + ctx.recommended.heightIn);
    expect(l.grid.cell).toBeGreaterThan(0.4); // genuinely large print
  });

  it("fits square-trim puzzles", () => {
    const sq = getPageContext("square", false, 120, 3);
    const l = layoutPuzzlePage({ rows: 15, cols: 15 }, Array(20).fill("PINEAPPLE"), "Fruits", sq.recommended);
    expect(l.grid.y + l.grid.cell * 15).toBeLessThan(sq.recommended.yIn + sq.recommended.heightIn);
    expect(l.words.at(-1)!.y).toBeLessThanOrEqual(sq.recommended.yIn + sq.recommended.heightIn + 1e-9);
  });

  it("lays out six answer grids inside the margins", () => {
    const l = layoutAnswerKey(Array(6).fill({ rows: 15, cols: 15, label: "1. Ocean Life" }), 6, ctx.recommended);
    expect(l.slots).toHaveLength(6);
    for (const s of l.slots) {
      const r = { xIn: s.grid.x, yIn: s.grid.y, widthIn: s.grid.cell * 15, heightIn: s.grid.cell * 15 };
      expect(isRectInside(r, ctx.recommended)).toBe(true);
    }
  });

  it("keeps the grid frame clear of the title and answer labels", () => {
    const l = layoutPuzzlePage({ rows: 15, cols: 15 }, Array(20).fill("WORD"), "Title", ctx.recommended);
    const frameTop = l.grid.y - l.grid.cell * FRAME_RATIO;
    expect(frameTop).toBeGreaterThan(l.title.y);
    const frameBottom = l.grid.y + l.grid.cell * (15 + FRAME_RATIO);
    expect(l.words[0]!.y - l.words[0]!.size).toBeGreaterThan(frameBottom);
    for (const perPage of [1, 4, 6]) {
      const key = layoutAnswerKey(Array(perPage).fill({ rows: 15, cols: 15, label: "1. Ocean Life" }), perPage, ctx.recommended);
      for (const s of key.slots) {
        const top = s.grid.y - s.grid.cell * FRAME_RATIO;
        expect(top).toBeGreaterThan(s.label.y);
        const frame = { xIn: s.grid.x - s.grid.cell * FRAME_RATIO, yIn: top, widthIn: s.grid.cell * (15 + 2 * FRAME_RATIO), heightIn: s.grid.cell * (15 + 2 * FRAME_RATIO) };
        expect(isRectInside(frame, ctx.recommended)).toBe(true);
      }
    }
  });

  it("balances wrapped titles", () => {
    const lines = wrapBalanced("Large Print Word Search for Adults", 0.5, 7.25, true);
    expect(lines.length).toBe(2);
    const [a, b] = lines.map((l) => l.length);
    expect(Math.abs(a! - b!)).toBeLessThan(10);
  });

  it("wraps long titles", () => {
    expect(wrapText("The Big Book of Large Print Word Search Puzzles", 0.5, 7)).toHaveLength(3);
  });
});

describe("storage and project store", () => {
  beforeEach(async () => {
    for (const s of await storage.listProjects()) await storage.deleteProject(s.id);
  });

  it("saves, lists newest first, loads and deletes", async () => {
    const a = createProject({ type: "coloring", title: "A" });
    const b = { ...createProject({ type: "coloring", title: "B" }), updatedAt: a.updatedAt + 1000 };
    await storage.saveProject(a);
    await storage.saveProject(b);
    expect((await storage.listProjects()).map((s) => s.title)).toEqual(["B", "A"]);
    expect((await storage.loadProject(a.id))?.title).toBe("A");
    await storage.deleteProject(a.id);
    expect((await storage.listProjects()).map((s) => s.title)).toEqual(["B"]);
  });

  it("creates, edits, reorders and persists a book", async () => {
    const store = useProjects.getState();
    const id = await store.createBook({ type: "coloring", title: "Mandalas", items: [createDesign("One"), createDesign("Two")] });
    await useProjects.getState().open(id);
    const [one, two] = useProjects.getState().current!.items;
    useProjects.getState().reorderItems(two!.id, one!.id);
    useProjects.getState().toggleBacking(one!.id);
    useProjects.getState().updateMeta({ title: "Mandalas Vol. 1" });
    await useProjects.getState().flush();
    const saved = await storage.loadProject(id);
    expect(saved?.title).toBe("Mandalas Vol. 1");
    expect(saved?.items.map((i) => i.kind === "design" && i.name)).toEqual(["Two", "One"]);
    expect(saved?.items[1]).toMatchObject({ addBackingPage: false });
    expect(useProjects.getState().saveState).toBe("saved");
  });

  it("regenerates every puzzle when the grid size changes", async () => {
    const project = wordSearchBook(4);
    await storage.saveProject(project);
    await useProjects.getState().open(project.id);
    useProjects.getState().updatePuzzleSettings({ rows: 20, cols: 20 });
    const items = useProjects.getState().current!.items;
    expect(items.every((i) => i.kind === "puzzle" && i.puzzle!.rows === 20)).toBe(true);
  });

  it("duplicates a book with a new id", async () => {
    const project = wordSearchBook(2);
    await storage.saveProject(project);
    const copyId = await useProjects.getState().duplicateBook(project.id);
    const copy = await storage.loadProject(copyId!);
    expect(copy?.title).toBe("Test (copy)");
    expect(copy?.items).toHaveLength(2);
  });
});
