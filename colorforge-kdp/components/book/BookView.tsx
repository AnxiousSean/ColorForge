"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookImage, FileDown, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { KdpTerm } from "@/components/KdpTerm";
import { PageManager } from "@/components/book/PageManager";
import { ExportDialog } from "@/components/export/ExportDialog";
import { PreflightPanel } from "@/components/book/PreflightPanel";
import { BOOK_PROFILES } from "@/lib/book-types";
import { PAPER_TYPES, TRIM_SIZES, getGutterMargin, type PaperType, type TrimSizeId } from "@/lib/kdp";
import { resolveBook } from "@/lib/pages";
import type { Difficulty } from "@/lib/puzzles/search-grid";
import { useProjects } from "@/store/projects";

export function SaveIndicator() {
  const saveState = useProjects((s) => s.saveState);
  const label = { saved: "Saved", pending: "Unsaved changes", saving: "Saving…", error: "Save failed" }[saveState];
  return (
    <span className={`text-xs ${saveState === "error" ? "text-red-600" : "text-neutral-500"}`} aria-live="polite">
      {saveState === "saving" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
      {label}
    </span>
  );
}

export function useOpenProject(id: string | null) {
  const { open, current, loadState } = useProjects();
  React.useEffect(() => {
    if (id) void open(id);
  }, [id, open]);
  return { project: current?.id === id ? current : null, loadState };
}

export function LoadGate({ loadState, children }: { loadState: string; children: React.ReactNode }) {
  if (loadState === "missing" || loadState === "error") {
    return (
      <main className="mx-auto max-w-md p-10 text-center">
        <p className="font-medium">{loadState === "missing" ? "This book could not be found in this browser." : "This book could not be loaded."}</p>
        <Button asChild className="mt-4">
          <Link href="/">Back to all books</Link>
        </Button>
      </main>
    );
  }
  if (loadState !== "ready") {
    return (
      <main className="flex min-h-[50vh] items-center justify-center text-neutral-500">
        <Loader2 className="animate-spin" />
      </main>
    );
  }
  return <>{children}</>;
}

export function BookView({ id }: { id: string | null }) {
  const router = useRouter();
  const { project, loadState } = useOpenProject(id);
  const { updateMeta, updatePuzzleSettings, addDesign, addPuzzle, setAllBacking } = useProjects.getState();
  const book = React.useMemo(() => (project ? resolveBook(project) : null), [project]);
  const [exporting, setExporting] = React.useState(false);

  return (
    <LoadGate loadState={loadState}>
      {project && book && (
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <header className="flex flex-wrap items-center gap-3">
            <Button asChild variant="ghost" size="icon" aria-label="All books">
              <Link href="/">
                <ArrowLeft />
              </Link>
            </Button>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-neutral-500">{BOOK_PROFILES[project.type].label}</p>
              <h1 className="truncate text-xl font-semibold">{project.title}</h1>
            </div>
            <SaveIndicator />
            <Button asChild variant="outline">
              <Link href={`/book/cover?id=${encodeURIComponent(project.id)}`}>
                <BookImage /> Cover
              </Link>
            </Button>
            <Button onClick={() => setExporting(true)}>
              <FileDown /> Export PDF
            </Button>
            <ExportDialog project={project} open={exporting} onOpenChange={setExporting} />
          </header>

          <div className="mt-6 grid gap-6 lg:grid-cols-[300px_1fr]">
            <aside className="space-y-5">
              <PreflightPanel project={project} />

              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                <h2 className="font-semibold">Book details</h2>
                <Field label="Title">
                  <Input value={project.title} onChange={(e) => updateMeta({ title: e.target.value })} />
                </Field>
                <Field label="Subtitle">
                  <Input value={project.subtitle} onChange={(e) => updateMeta({ subtitle: e.target.value })} />
                </Field>
                <Field label="Author">
                  <Input value={project.author} onChange={(e) => updateMeta({ author: e.target.value })} />
                </Field>
                <label className="flex items-center justify-between text-sm">
                  Title & copyright pages
                  <Switch checked={project.includeFrontMatter} onCheckedChange={(v) => updateMeta({ includeFrontMatter: v })} />
                </label>
              </section>

              <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                <h2 className="font-semibold">Print settings</h2>
                <Field label={<KdpTerm term="trim">Trim size</KdpTerm>}>
                  <Select value={project.trimSize} onChange={(e) => updateMeta({ trimSize: e.target.value as TrimSizeId })}>
                    {Object.values(TRIM_SIZES).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Interior">
                  <Select value={project.paperType} onChange={(e) => updateMeta({ paperType: e.target.value as PaperType })}>
                    {Object.values(PAPER_TYPES).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <label className="flex items-center justify-between text-sm">
                  <KdpTerm term="bleed">Full bleed</KdpTerm>
                  <Switch checked={project.hasBleed} onCheckedChange={(v) => updateMeta({ hasBleed: v })} />
                </label>
                <p className="text-xs text-neutral-500">
                  <KdpTerm term="gutter">Gutter</KdpTerm> for {book.pages.length} pages: {getGutterMargin(book.pages.length)}&quot; minimum.
                </p>
                {project.type === "coloring" && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setAllBacking(true)}>
                      All single-sided
                    </Button>
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setAllBacking(false)}>
                      All double-sided
                    </Button>
                  </div>
                )}
              </section>

              {project.puzzleSettings && (
                <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
                  <h2 className="font-semibold">Puzzle settings</h2>
                  <p className="text-xs text-neutral-500">Changing these rebuilds every puzzle in the book from its saved seed.</p>
                  <Field label="Grid">
                    <Select
                      value={project.puzzleSettings.rows}
                      onChange={(e) => updatePuzzleSettings({ rows: Number(e.target.value), cols: Number(e.target.value) })}
                    >
                      {[13, 15, 17, 20].map((s) => (
                        <option key={s} value={s}>
                          {s} × {s}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Difficulty">
                    <Select
                      value={project.puzzleSettings.difficulty}
                      onChange={(e) => updatePuzzleSettings({ difficulty: e.target.value as Difficulty })}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </Select>
                  </Field>
                  {project.type === "number-search" && (
                    <Field label="Numbers per puzzle">
                      <Input
                        type="number"
                        min={4}
                        max={40}
                        defaultValue={project.puzzleSettings.entriesPerPuzzle}
                        onBlur={(e) => updatePuzzleSettings({ entriesPerPuzzle: Math.max(4, Math.min(40, Number(e.target.value) || 20)) })}
                      />
                    </Field>
                  )}
                </section>
              )}
            </aside>

            <div>
              <PageManager project={project} book={book} />
              <Button
                variant="outline"
                className="mt-4 w-full border-dashed"
                onClick={() => {
                  const newId = project.type === "coloring" ? addDesign() : addPuzzle();
                  if (newId) router.push(`/book/edit?id=${encodeURIComponent(project.id)}&item=${encodeURIComponent(newId)}`);
                }}
              >
                <Plus /> Add {project.type === "coloring" ? "design" : "puzzle"}
              </Button>
            </div>
          </div>
        </main>
      )}
    </LoadGate>
  );
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-neutral-600">{label}</Label>
      {children}
    </div>
  );
}
