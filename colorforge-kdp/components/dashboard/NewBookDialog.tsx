"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Grid3x3, Hash, Loader2, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { KdpTerm } from "@/components/KdpTerm";
import { BOOK_PROFILES, planBook, type BookType } from "@/lib/book-types";
import { TRIM_SIZES, type TrimSizeId } from "@/lib/kdp";
import { createDesign, newId, type ContentItem, type PuzzleSettings } from "@/lib/model";
import { buildPuzzleItems, maxAnswerLength, parseThemes, STARTER_THEMES } from "@/lib/puzzles/themes";
import type { Difficulty } from "@/lib/puzzles/search-grid";
import { cn } from "@/lib/utils";
import { useProjects } from "@/store/projects";

const TYPES: Array<{ type: BookType; icon: React.ElementType; blurb: string }> = [
  { type: "coloring", icon: Palette, blurb: "Line-art designs, printed single-sided." },
  { type: "word-search", icon: Grid3x3, blurb: "Themed word lists into large-print puzzles." },
  { type: "number-search", icon: Hash, blurb: "Auto-generated number grids." },
];

const GRID_SIZES = [
  { size: 13, label: "13 × 13 (extra large print)", entries: 15 },
  { size: 15, label: "15 × 15 (large print)", entries: 20 },
  { size: 17, label: "17 × 17", entries: 24 },
  { size: 20, label: "20 × 20 (standard)", entries: 30 },
];

export function NewBookDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const createBook = useProjects((s) => s.createBook);

  const [type, setType] = React.useState<BookType>("word-search");
  const [title, setTitle] = React.useState("");
  const [subtitle, setSubtitle] = React.useState("");
  const [author, setAuthor] = React.useState("");
  const [trimSize, setTrimSize] = React.useState<TrimSizeId>("letter");
  const [count, setCount] = React.useState(BOOK_PROFILES["word-search"].typicalContentCount);
  const [gridSize, setGridSize] = React.useState(15);
  const [entriesPerPuzzle, setEntriesPerPuzzle] = React.useState(20);
  const [difficulty, setDifficulty] = React.useState<Difficulty>("medium");
  const [themesText, setThemesText] = React.useState(STARTER_THEMES);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const isPuzzle = type !== "coloring";
  const settings: PuzzleSettings = { rows: gridSize, cols: gridSize, difficulty, entriesPerPuzzle };
  const themes = React.useMemo(() => (type === "word-search" ? parseThemes(themesText) : []), [type, themesText]);
  const tooLong = React.useMemo(() => {
    const limit = maxAnswerLength(settings);
    return [...new Set(themes.flatMap((t) => t.entries.filter((e) => e.answer.length > limit).map((e) => e.display)))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themes, gridSize, difficulty]);

  const plan = React.useMemo(() => planBook({ type, content: count, trimSize }), [type, count, trimSize]);
  const errors = plan.issues.filter((i) => i.severity === "error");

  const chooseType = (t: BookType) => {
    setType(t);
    setCount(BOOK_PROFILES[t].typicalContentCount);
  };

  const chooseGrid = (size: number) => {
    setGridSize(size);
    setEntriesPerPuzzle(GRID_SIZES.find((g) => g.size === size)?.entries ?? 20);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (type === "word-search" && themes.length === 0) {
      setError("Add at least one word list.");
      return;
    }
    setBusy(true);
    try {
      // Let the button's spinner paint before the (brief) generation work.
      await new Promise((r) => setTimeout(r, 0));
      const seed = newId("seed");
      let items: ContentItem[];
      if (type === "coloring") {
        items = Array.from({ length: count }, (_, i) => createDesign(`Design ${i + 1}`));
      } else {
        items = buildPuzzleItems({ type, settings, bookSeed: seed, puzzleCount: count, themes }).items;
      }
      const id = await createBook({
        type,
        title: title || defaultTitle(type),
        subtitle,
        author,
        trimSize,
        seed,
        puzzleSettings: isPuzzle ? settings : undefined,
        items,
      });
      onOpenChange(false);
      router.push(`/book?id=${encodeURIComponent(id)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>New book</DialogTitle>
        <DialogDescription>Pick a type and the app builds the whole interior: front matter, content, and answer key.</DialogDescription>

        <form onSubmit={submit} className="mt-5 space-y-5">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Book type">
            {TYPES.map(({ type: t, icon: Icon, blurb }) => (
              <button
                type="button"
                role="radio"
                aria-checked={type === t}
                key={t}
                onClick={() => chooseType(t)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  type === t ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 hover:border-neutral-400",
                )}
              >
                <Icon className="mb-2 size-5" />
                <div className="text-sm font-semibold">{BOOK_PROFILES[t].label}</div>
                <div className={cn("mt-1 text-xs", type === t ? "text-neutral-300" : "text-neutral-500")}>{blurb}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="nb-title">Title</Label>
              <Input id="nb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={defaultTitle(type)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb-subtitle">Subtitle</Label>
              <Input id="nb-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="100 large-print puzzles" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb-author">Author / pen name</Label>
              <Input id="nb-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb-trim">
                <KdpTerm term="trim">Trim size</KdpTerm>
              </Label>
              <Select id="nb-trim" value={trimSize} onChange={(e) => setTrimSize(e.target.value as TrimSizeId)}>
                {Object.values(TRIM_SIZES).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nb-count">{isPuzzle ? "Number of puzzles" : "Number of designs"}</Label>
              <Input
                id="nb-count"
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              />
            </div>
          </div>

          {isPuzzle && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="nb-grid">Grid</Label>
                <Select id="nb-grid" value={gridSize} onChange={(e) => chooseGrid(Number(e.target.value))}>
                  {GRID_SIZES.map((g) => (
                    <option key={g.size} value={g.size}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nb-entries">{type === "word-search" ? "Words per puzzle" : "Numbers per puzzle"}</Label>
                <Input
                  id="nb-entries"
                  type="number"
                  min={4}
                  max={40}
                  value={entriesPerPuzzle}
                  onChange={(e) => setEntriesPerPuzzle(Math.max(4, Math.min(40, Number(e.target.value) || 4)))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nb-diff">Difficulty</Label>
                <Select id="nb-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
                  <option value="easy">Easy (across, down)</option>
                  <option value="medium">Medium (+ diagonals)</option>
                  <option value="hard">Hard (+ backwards)</option>
                </Select>
              </div>
            </div>
          )}

          {type === "word-search" && (
            <div className="space-y-1.5">
              <div className="flex items-end justify-between">
                <Label htmlFor="nb-themes">Word lists</Label>
                <button type="button" className="text-xs text-neutral-500 underline" onClick={() => setThemesText(STARTER_THEMES)}>
                  Reset to starter themes
                </button>
              </div>
              <Textarea
                id="nb-themes"
                className="h-40 font-mono text-xs"
                value={themesText}
                onChange={(e) => setThemesText(e.target.value)}
                spellCheck={false}
              />
              <p className="text-xs text-neutral-500">
                Start each theme with a <code># Heading</code> line, then words separated by commas or new lines. {themes.length} theme
                {themes.length === 1 ? "" : "s"}, {themes.reduce((n, t) => n + t.entries.length, 0)} words. Puzzles cycle through the
                themes without repeating words until a theme runs out.
              </p>
              {tooLong.length > 0 && (
                <p className="text-xs text-amber-700">
                  Too long for a {gridSize} × {gridSize} grid, so they will be skipped: {tooLong.slice(0, 8).join(", ")}
                  {tooLong.length > 8 ? ` and ${tooLong.length - 8} more` : ""}.
                </p>
              )}
            </div>
          )}

          <div className={cn("rounded-md p-3 text-sm", errors.length ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900")}>
            <BookOpen className="mr-1.5 inline size-4 align-text-bottom" />
            <strong>{plan.slots.length} pages.</strong>{" "}
            {errors.length ? errors.map((i) => i.message).join(" ") : "Meets KDP page-count and blank-page rules."}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              Create book
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function defaultTitle(type: BookType): string {
  return type === "coloring" ? "My Coloring Book" : type === "word-search" ? "Large Print Word Search" : "Large Print Number Search";
}
