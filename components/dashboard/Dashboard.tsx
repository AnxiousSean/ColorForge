"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Copy, Grid3x3, Hash, Palette, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewBookDialog } from "@/components/dashboard/NewBookDialog";
import { BOOK_PROFILES, type BookType } from "@/lib/book-types";
import { TRIM_SIZES } from "@/lib/kdp";
import { useProjects } from "@/store/projects";

const ICONS: Record<BookType, React.ElementType> = { coloring: Palette, "word-search": Grid3x3, "number-search": Hash };

const timeAgo = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(t).toLocaleDateString();
};

export function Dashboard() {
  const router = useRouter();
  const { summaries, listLoaded, error, refreshList, deleteBook, duplicateBook } = useProjects();
  const [creating, setCreating] = React.useState(false);

  React.useEffect(() => {
    void refreshList();
  }, [refreshList]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">ColorForge KDP</h1>
          <p className="text-sm text-neutral-500">Print-ready coloring and puzzle book interiors. Saved in this browser.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus /> New book
        </Button>
      </header>

      {error && <p className="mt-6 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {listLoaded && summaries.length === 0 && !error && (
        <div className="mt-10 rounded-xl border border-dashed border-neutral-300 p-10 text-center">
          <p className="font-medium">No books yet</p>
          <p className="mt-1 text-sm text-neutral-500">A 100-puzzle word search book takes about a minute with the starter themes.</p>
          <Button className="mt-4" onClick={() => setCreating(true)}>
            <Plus /> Create your first book
          </Button>
        </div>
      )}

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => {
          const Icon = ICONS[s.type];
          return (
            <li key={s.id} className="group flex flex-col rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
              <Link href={`/book?id=${encodeURIComponent(s.id)}`} className="flex-1">
                <div className="flex items-center gap-2 text-xs text-neutral-500">
                  <Icon className="size-4" /> {BOOK_PROFILES[s.type].label}
                </div>
                <h2 className="mt-2 line-clamp-2 font-semibold group-hover:underline">{s.title}</h2>
                {s.author && <p className="text-sm text-neutral-500">{s.author}</p>}
                <p className="mt-3 text-xs text-neutral-500">
                  {TRIM_SIZES[s.trimSize].label} · {s.pageCount} pages · edited {timeAgo(s.updatedAt)}
                </p>
                <p className={`mt-2 flex items-center gap-1 text-xs ${s.issueCount ? "text-amber-700" : "text-emerald-700"}`}>
                  {s.issueCount ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  {s.issueCount ? `${s.issueCount} KDP issue${s.issueCount > 1 ? "s" : ""}` : "Page count OK"}
                </p>
              </Link>
              <div className="mt-3 flex justify-end gap-1 border-t border-neutral-100 pt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const id = await duplicateBook(s.id);
                    if (id) router.push(`/book?id=${encodeURIComponent(id)}`);
                  }}
                >
                  <Copy /> Duplicate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => {
                    if (confirm(`Delete "${s.title}"? This cannot be undone.`)) void deleteBook(s.id);
                  }}
                >
                  <Trash2 /> Delete
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <NewBookDialog open={creating} onOpenChange={setCreating} />
    </main>
  );
}
