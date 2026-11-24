"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoadGate, useOpenProject } from "@/components/book/BookView";
import { DesignEditor } from "@/components/editor/DesignEditor";
import { PuzzleEditor } from "@/components/puzzle/PuzzleEditor";
import { Button } from "@/components/ui/button";
import { resolveBook } from "@/lib/pages";

function EditRoute() {
  const params = useSearchParams();
  const itemId = params.get("item");
  const { project, loadState } = useOpenProject(params.get("id"));
  const book = React.useMemo(() => (project ? resolveBook(project) : null), [project]);
  const page = book?.pages.find((p) => (p.kind === "design" || p.kind === "puzzle") && p.item.id === itemId);

  return (
    <LoadGate loadState={loadState}>
      {project && book && !page && (
        <main className="mx-auto max-w-md p-10 text-center">
          <p className="font-medium">This page no longer exists.</p>
          <Button asChild className="mt-4">
            <Link href={`/book?id=${encodeURIComponent(project.id)}`}>Back to the book</Link>
          </Button>
        </main>
      )}
      {project && book && page?.kind === "design" && <DesignEditor project={project} page={page} pageCount={book.pages.length} />}
      {project && book && page?.kind === "puzzle" && <PuzzleEditor project={project} page={page} pageCount={book.pages.length} />}
    </LoadGate>
  );
}

export default function EditPage() {
  return (
    <Suspense>
      <EditRoute />
    </Suspense>
  );
}
