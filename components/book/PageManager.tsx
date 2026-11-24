"use client";

import * as React from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Copy, GripVertical, Lock, Pencil, Trash2 } from "lucide-react";
import { LazyPage } from "@/components/render/LazyPage";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { GLOSSARY } from "@/components/KdpTerm";
import { getPageDimensions } from "@/lib/kdp";
import type { Project } from "@/lib/model";
import { pageLabel, type ResolvedBook, type ResolvedPage } from "@/lib/pages";
import { cn } from "@/lib/utils";
import { useProjects } from "@/store/projects";

type ContentPage = Extract<ResolvedPage, { kind: "design" | "puzzle" }>;

interface Group {
  /** The page that can be dragged and edited, if any. */
  content: ContentPage | null;
  /** Fixed pages (front matter, answer keys) or this content's blank back. */
  pages: ResolvedPage[];
}

/** Groups physical pages so each content item travels with its blank back. */
function groupPages(book: ResolvedBook) {
  const before: ResolvedPage[] = [];
  const movable: Group[] = [];
  const after: ResolvedPage[] = [];
  for (const page of book.pages) {
    if (page.kind === "design" || page.kind === "puzzle") {
      movable.push({ content: page, pages: [page] });
    } else if (page.kind === "blank" && page.reason === "backing" && movable.length) {
      movable[movable.length - 1]!.pages.push(page);
    } else if (movable.length === 0) {
      before.push(page);
    } else {
      after.push(page);
    }
  }
  return { before, movable, after };
}

export function PageManager({ project, book }: { project: Project; book: ResolvedBook }) {
  const reorderItems = useProjects((s) => s.reorderItems);
  const [view, setView] = React.useState<"arrange" | "spreads">("arrange");
  const page = getPageDimensions(project.trimSize, project.hasBleed);
  const aspect = page.widthIn / page.heightIn;
  const pageCount = book.pages.length;
  const groups = React.useMemo(() => groupPages(book), [book]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (e.over && e.active.id !== e.over.id) reorderItems(String(e.active.id), String(e.over.id));
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Pages</h2>
        <div className="inline-flex rounded-md border border-neutral-200 bg-white p-0.5 text-xs">
          {(["arrange", "spreads"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={cn("rounded px-2.5 py-1", view === v ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100")}
            >
              {v === "arrange" ? "Arrange" : "All pages"}
            </button>
          ))}
        </div>
      </div>

      {view === "spreads" ? (
        <Spreads project={project} book={book} aspect={aspect} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {groups.before.map((p) => (
            <FixedCard key={p.slot.pageNumber} project={project} page={p} pageCount={pageCount} aspect={aspect} />
          ))}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={groups.movable.map((g) => g.content!.item.id)} strategy={rectSortingStrategy}>
              {groups.movable.map((g) => (
                <SortableCard key={g.content!.item.id} project={project} group={g} pageCount={pageCount} aspect={aspect} />
              ))}
            </SortableContext>
          </DndContext>
          {groups.after.map((p) => (
            <FixedCard key={p.slot.pageNumber} project={project} page={p} pageCount={pageCount} aspect={aspect} />
          ))}
        </div>
      )}
    </section>
  );
}

function PageBadge({ page }: { page: ResolvedPage }) {
  const side = page.slot.pageNumber % 2 === 1 ? "R" : "L";
  return (
    <Tooltip content={side === "R" ? "Right-hand page (odd number). The gutter is on its left." : "Left-hand page (even number). The gutter is on its right."}>
      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600">
        p.{page.slot.pageNumber} {side}
      </span>
    </Tooltip>
  );
}

function FixedCard({ project, page, pageCount, aspect }: { project: Project; page: ResolvedPage; pageCount: number; aspect: number }) {
  return (
    <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-2">
      <div className="overflow-hidden rounded border border-neutral-200">
        <LazyPage project={project} page={page} pageCount={pageCount} aspect={aspect} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-1 text-xs">
        <span className="flex min-w-0 items-center gap-1 truncate text-neutral-600">
          <Lock className="size-3 shrink-0" /> <span className="truncate">{pageLabel(page)}</span>
        </span>
        <PageBadge page={page} />
      </div>
    </div>
  );
}

function SortableCard({ project, group, pageCount, aspect }: { project: Project; group: Group; pageCount: number; aspect: number }) {
  const content = group.content!;
  const item = content.item;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const { toggleBacking, duplicateItem, removeItem } = useProjects.getState();
  const backing = group.pages.find((p) => p.kind === "blank");
  const editHref = `/book/edit?id=${encodeURIComponent(project.id)}&item=${encodeURIComponent(item.id)}`;
  const problem =
    item.kind === "puzzle" && item.puzzle && (item.puzzle.unplaced.length > 0 || item.puzzle.ambiguous.length > 0 || item.entries.length === 0);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative rounded-lg border bg-white p-2 shadow-sm",
        isDragging ? "z-10 border-neutral-900 shadow-lg" : "border-neutral-200",
        problem && "border-amber-400",
      )}
    >
      <div className="relative">
        <Link href={editHref} className="block overflow-hidden rounded border border-neutral-200" aria-label={`Edit ${pageLabel(content)}`}>
          <LazyPage project={project} page={content} pageCount={pageCount} aspect={aspect} />
        </Link>
        <button
          className="absolute left-1 top-1 cursor-grab touch-none rounded bg-white/90 p-1 text-neutral-500 shadow-sm hover:text-neutral-900 active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
        {backing && (
          <span className="absolute bottom-1 right-1 rounded bg-neutral-900/80 px-1.5 py-0.5 text-[10px] text-white">+ blank back p.{backing.slot.pageNumber}</span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-1 text-xs">
        <span className="truncate font-medium" title={pageLabel(content)}>
          {pageLabel(content)}
        </span>
        <PageBadge page={content} />
      </div>

      <div className="mt-2 flex items-center justify-between">
        {item.kind === "design" ? (
          <Tooltip content={GLOSSARY.backing}>
            <label className="flex items-center gap-1.5 text-[11px] text-neutral-600">
              <Switch checked={item.addBackingPage} onCheckedChange={() => toggleBacking(item.id)} aria-label="Blank backing page" />
              Blank back
            </label>
          </Tooltip>
        ) : (
          <span className={cn("text-[11px]", problem ? "text-amber-700" : "text-neutral-500")}>
            {problem ? "Needs attention" : `${item.puzzle?.placements.length ?? 0} ${project.type === "number-search" ? "numbers" : "words"}`}
          </span>
        )}
        <div className="flex">
          <Link href={editHref} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label="Edit">
            <Pencil className="size-3.5" />
          </Link>
          <button className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900" aria-label="Duplicate" onClick={() => duplicateItem(item.id)}>
            <Copy className="size-3.5" />
          </button>
          <button
            className="rounded p-1 text-neutral-500 hover:bg-red-50 hover:text-red-600"
            aria-label="Delete"
            onClick={() => confirm(`Delete "${pageLabel(content)}"?`) && removeItem(item.id)}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Every physical page as the reader sees it: page 1 alone, then left/right spreads. */
function Spreads({ project, book, aspect }: { project: Project; book: ResolvedBook; aspect: number }) {
  const spreads: Array<Array<ResolvedPage | null>> = [];
  const pages = book.pages;
  if (pages.length) spreads.push([null, pages[0]!]);
  for (let i = 1; i < pages.length; i += 2) spreads.push([pages[i]!, pages[i + 1] ?? null]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {spreads.map((spread, i) => (
        <div key={i} className="grid grid-cols-2 gap-px rounded border border-neutral-200 bg-neutral-300 p-px">
          {spread.map((p, j) =>
            p ? (
              <figure key={j} className="bg-white">
                <LazyPage project={project} page={p} pageCount={pages.length} aspect={aspect} />
                <figcaption
                  className={cn(
                    "truncate border-t border-neutral-100 px-1.5 py-1 text-[10px]",
                    p.kind === "blank" ? "bg-neutral-50 italic text-neutral-400" : "text-neutral-700",
                  )}
                >
                  {p.slot.pageNumber} · {pageLabel(p)}
                </figcaption>
              </figure>
            ) : (
              <div key={j} className="bg-neutral-100" />
            ),
          )}
        </div>
      ))}
    </div>
  );
}
