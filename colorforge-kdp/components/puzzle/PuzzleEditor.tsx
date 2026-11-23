"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SaveIndicator } from "@/components/book/BookView";
import { PageSvg } from "@/components/render/PageSvg";
import { newId, type Project } from "@/lib/model";
import type { ResolvedPage } from "@/lib/pages";
import { generateNumberEntries, parseWordList } from "@/lib/puzzles/search-grid";
import { maxAnswerLength } from "@/lib/puzzles/themes";
import { useProjects } from "@/store/projects";

type PuzzlePage = Extract<ResolvedPage, { kind: "puzzle" }>;

export function PuzzleEditor({ project, page, pageCount }: { project: Project; page: PuzzlePage; pageCount: number }) {
  const item = page.item;
  const settings = project.puzzleSettings!;
  const updatePuzzle = useProjects((s) => s.updatePuzzle);
  const isNumbers = project.type === "number-search";
  const [words, setWords] = React.useState(() => item.entries.map((e) => e.display).join("\n"));
  const [showSolution, setShowSolution] = React.useState(false);
  const [overlay, setOverlay] = React.useState(true);

  // Keep the textarea in sync when the item changes from outside (e.g. new numbers).
  React.useEffect(() => setWords(item.entries.map((e) => e.display).join("\n")), [item.entries]);

  const limit = maxAnswerLength(settings);
  const parsed = React.useMemo(() => parseWordList(words), [words]);
  const tooLong = parsed.filter((e) => e.answer.length > limit);
  const dirty = parsed.map((e) => e.answer).join() !== item.entries.map((e) => e.answer).join();
  const puzzle = item.puzzle;
  const problems = puzzle ? [...puzzle.unplaced.map((e) => `“${e.display}” did not fit.`), ...puzzle.ambiguous.map((e) => `“${e.display}” appears more than once.`)] : [];

  const applyWords = () => updatePuzzle(item.id, { entries: parsed.filter((e) => e.answer.length <= limit) });
  const reshuffle = () => {
    const seed = `${project.seed}/${newId("shuffle")}`;
    updatePuzzle(item.id, isNumbers ? { seed, entries: generateNumberEntries(settings.entriesPerPuzzle, seed) } : { seed });
  };

  // Preview the answer by rendering this puzzle's solution as a one-up answer page.
  const previewPage: ResolvedPage = showSolution
    ? { kind: "answer-key", slot: page.slot, puzzles: [{ item, index: page.index, heading: page.heading }], perPage: 1 }
    : page;

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to pages">
          <Link href={`/book?id=${encodeURIComponent(project.id)}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="truncate font-semibold">{page.heading}</h1>
        <span className="hidden text-xs text-neutral-500 sm:inline">Page {page.slot.pageNumber}</span>
        <div className="ml-auto">
          <SaveIndicator />
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-4 p-4 md:flex-row">
        <div className="flex flex-1 items-start justify-center">
          <PageSvg
            project={project}
            page={previewPage}
            pageCount={pageCount}
            showOverlay={overlay}
            width="100%"
            height="100%"
            className="max-h-[calc(100dvh-6rem)] w-auto max-w-full bg-white shadow-lg"
          />
        </div>

        <aside className="w-full space-y-4 rounded-lg border border-neutral-200 bg-white p-4 md:w-80">
          <div className="space-y-1">
            <Label htmlFor="pz-title" className="text-xs">
              Title
            </Label>
            <Input id="pz-title" value={item.title} onChange={(e) => updatePuzzle(item.id, { title: e.target.value })} />
            <p className="text-[11px] text-neutral-500">Puzzles are numbered automatically by their position in the book.</p>
          </div>

          <div
            className={`flex gap-2 rounded-md p-3 text-xs ${problems.length || item.entries.length === 0 ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}
          >
            {problems.length || item.entries.length === 0 ? <AlertTriangle className="size-4 shrink-0" /> : <CheckCircle2 className="size-4 shrink-0" />}
            <div>
              {item.entries.length === 0
                ? `Add ${isNumbers ? "numbers" : "words"} to build this puzzle.`
                : problems.length
                  ? problems.join(" ")
                  : `All ${puzzle?.placements.length} ${isNumbers ? "numbers" : "words"} placed, each appearing exactly once.`}
            </div>
          </div>

          {!isNumbers && (
            <div className="space-y-1">
              <Label htmlFor="pz-words" className="text-xs">
                Words (one per line)
              </Label>
              <Textarea id="pz-words" className="h-56 font-mono text-xs" value={words} onChange={(e) => setWords(e.target.value)} spellCheck={false} />
              <p className="text-[11px] text-neutral-500">
                {parsed.length} words · up to {limit} letters for this grid
                {tooLong.length > 0 && <span className="text-amber-700"> · too long: {tooLong.map((e) => e.display).join(", ")}</span>}
              </p>
              <Button className="w-full" disabled={!dirty} onClick={applyWords}>
                Update puzzle
              </Button>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={reshuffle}>
            <Shuffle /> {isNumbers ? "New numbers" : "Shuffle layout"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setShowSolution((v) => !v)}>
              {showSolution ? <EyeOff /> : <Eye />} {showSolution ? "Hide answer" : "Show answer"}
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setOverlay((v) => !v)}>
              Guides {overlay ? "on" : "off"}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
