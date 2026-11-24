"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, EyeOff, FileDown, ImageDown, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { LoadGate, SaveIndicator, useOpenProject } from "@/components/book/BookView";
import { CoverSvg } from "@/components/render/CoverSvg";
import { COVER_PALETTES, contrastRatio, layoutCover } from "@/lib/cover";
import type { Verification } from "@/lib/export/finalize";
import { downloadBytes, formatBytes } from "@/lib/export/download";
import { PAPER_TYPES, TRIM_SIZES } from "@/lib/kdp";
import { pageLabel, resolveBook } from "@/lib/pages";
import { cn } from "@/lib/utils";
import { useProjects } from "@/store/projects";

const inch = (v: number) => `${v.toFixed(3)}"`;

export function CoverEditor({ id }: { id: string | null }) {
  const { project, loadState } = useOpenProject(id);
  const updateCover = useProjects((s) => s.updateCover);
  const flush = useProjects((s) => s.flush);
  const book = React.useMemo(() => (project ? resolveBook(project) : null), [project]);
  const [guides, setGuides] = React.useState(true);
  const [busy, setBusy] = React.useState<"pdf" | "png" | null>(null);
  const [result, setResult] = React.useState<{ kind: "pdf"; filename: string; verification: Verification } | { kind: "png"; filename: string; size: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  if (!project || !book) return <LoadGate loadState={loadState}>{null}</LoadGate>;

  const pageCount = book.pages.length;
  const layout = layoutCover(project, pageCount);
  const g = layout.geometry;
  const c = project.cover;
  const contrast = contrastRatio(c.background, c.textColor);
  const artChoices = book.pages.filter((p) => p.kind === "design" || p.kind === "puzzle");
  const pageIssues = book.plan.issues.filter((i) => i.severity === "error");

  async function run(kind: "pdf" | "png") {
    if (!project) return;
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      await flush();
      const { exportCoverPdf, exportFrontCoverPng } = await import("@/lib/export/cover");
      if (kind === "pdf") {
        const r = await exportCoverPdf(project, pageCount);
        if (r.verification.ok) downloadBytes(r.bytes, r.filename);
        setResult({ kind: "pdf", filename: r.filename, verification: r.verification });
      } else {
        const r = await exportFrontCoverPng(project, pageCount);
        downloadBytes(new Uint8Array(await r.blob.arrayBuffer()), r.filename, "image/png");
        setResult({ kind: "png", filename: r.filename, size: `${r.width} × ${r.height} px · ${formatBytes(r.blob.size)}` });
      }
    } catch (e) {
      setError((e as Error).message || "Export failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-dvh bg-neutral-100">
      <header className="flex h-14 items-center gap-2 border-b border-neutral-200 bg-white px-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back to book">
          <Link href={`/book?id=${encodeURIComponent(project.id)}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="text-xs text-neutral-500">Cover</p>
          <h1 className="truncate font-semibold">{project.title}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <SaveIndicator />
          <Button variant="ghost" size="icon" onClick={() => setGuides((v) => !v)} aria-label="Toggle guides">
            {guides ? <Eye /> : <EyeOff />}
          </Button>
        </div>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-3">
          <div className="overflow-auto rounded-lg bg-neutral-200 p-4">
            <CoverSvg project={project} pageCount={pageCount} showGuides={guides} width="100%" height="100%" className="mx-auto block h-auto max-h-[70vh] w-full shadow-lg" />
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg border border-neutral-200 bg-white p-3 text-xs sm:grid-cols-4">
            <dt className="text-neutral-500">Full cover</dt>
            <dd className="font-mono">
              {inch(g.widthIn)} × {inch(g.heightIn)}
            </dd>
            <dt className="text-neutral-500">Spine width</dt>
            <dd className="font-mono">{inch(g.spineWidthIn)}</dd>
            <dt className="text-neutral-500">Interior</dt>
            <dd>
              {pageCount} pages · {PAPER_TYPES[project.paperType].label.toLowerCase()}
            </dd>
            <dt className="text-neutral-500">Trim</dt>
            <dd>{TRIM_SIZES[project.trimSize].label}</dd>
          </dl>
          {guides && (
            <p className="text-xs text-neutral-500">
              Red: bleed, trimmed off · Blue: trim and spine folds · Green: keep text inside · Orange: KDP prints the barcode here
            </p>
          )}
        </div>

        <aside className="space-y-4">
          <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="font-semibold">Colours</h2>
            <div className="grid grid-cols-4 gap-2">
              {COVER_PALETTES.map((p) => (
                <button
                  key={p.name}
                  title={p.name}
                  aria-label={`${p.name} palette`}
                  onClick={() => updateCover({ background: p.background, textColor: p.textColor, panelColor: p.panelColor })}
                  className={cn("flex h-10 items-center justify-center rounded-md border text-xs font-bold", c.background === p.background ? "ring-2 ring-neutral-900 ring-offset-1" : "border-neutral-200")}
                  style={{ background: p.background, color: p.textColor }}
                >
                  Aa
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {(
                [
                  ["background", "Background"],
                  ["textColor", "Text"],
                  ["panelColor", "Art panel"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="space-y-1">
                  <span className="text-neutral-600">{label}</span>
                  <input type="color" value={c[key]} onChange={(e) => updateCover({ [key]: e.target.value })} className="h-8 w-full cursor-pointer rounded border border-neutral-300" />
                </label>
              ))}
            </div>
            {contrast < 4.5 && (
              <p className="flex gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="size-4 shrink-0" /> Low contrast ({contrast.toFixed(1)}:1). Thumbnails on Amazon are small: aim for 4.5:1 or more.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="font-semibold">Front & spine</h2>
            <div className="space-y-1">
              <Label htmlFor="cv-art" className="text-xs">
                Cover art
              </Label>
              <Select id="cv-art" value={c.artItemId ?? ""} onChange={(e) => updateCover({ artItemId: e.target.value || null })}>
                <option value="">None</option>
                {artChoices.map((p) => (
                  <option key={p.slot.pageNumber} value={(p as { item: { id: string } }).item.id}>
                    {pageLabel(p)}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-neutral-500">Puzzles are shown solved, as a teaser. Title, subtitle and author come from Book details.</p>
            </div>
            <label className="flex items-center justify-between text-sm">
              Spine text
              <Switch checked={c.showSpineText && g.allowsSpineText} disabled={!g.allowsSpineText} onCheckedChange={(v) => updateCover({ showSpineText: v })} />
            </label>
            {layout.spineNote && <p className="text-[11px] text-neutral-500">{layout.spineNote}</p>}
          </section>

          <section className="space-y-2 rounded-lg border border-neutral-200 bg-white p-4">
            <Label htmlFor="cv-blurb" className="font-semibold">
              Back cover description
            </Label>
            <Textarea
              id="cv-blurb"
              className="h-32 text-sm"
              value={c.blurb}
              onChange={(e) => updateCover({ blurb: e.target.value })}
              placeholder="Relax and unwind with 100 large-print puzzles…"
            />
            {layout.blurbOverflow && (
              <p className="flex gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="size-4 shrink-0" /> Too long to fit above the barcode area; the end is cut off.
              </p>
            )}
          </section>

          <section className="space-y-3 rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="font-semibold">Export</h2>
            {pageIssues.length > 0 && (
              <p className="flex gap-1.5 text-xs text-amber-800">
                <AlertTriangle className="size-4 shrink-0" /> The interior isn&apos;t final ({pageIssues[0]!.message}) The spine width depends on the page count, so export the cover last.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={() => run("pdf")} disabled={busy !== null}>
                {busy === "pdf" ? <Loader2 className="animate-spin" /> : <FileDown />} Cover PDF
              </Button>
              <Button variant="outline" onClick={() => run("png")} disabled={busy !== null}>
                {busy === "png" ? <Loader2 className="animate-spin" /> : <ImageDown />} Front PNG
              </Button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {result?.kind === "pdf" && (
              <ul className="space-y-1 text-xs">
                {result.verification.checks.map((ch) => (
                  <li key={ch.label} className="flex gap-1.5">
                    {ch.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <XCircle className="size-4 shrink-0 text-red-600" />}
                    <span>
                      <strong>{ch.label}:</strong> {ch.label === "Page count" ? "1 page" : ch.detail}
                    </span>
                  </li>
                ))}
                <li className="pt-1 text-neutral-600">
                  On KDP choose <strong>“Upload a cover you already have (print-ready PDF only)”</strong> and upload {result.filename}.
                </li>
              </ul>
            )}
            {result?.kind === "png" && (
              <p className="text-xs text-neutral-600">
                {result.filename}: {result.size}. Use it for your listing images, ads and the Kindle edition.
              </p>
            )}
            <p className="text-[11px] text-neutral-500">The spine width depends on the page count: if you add or remove pages, export the cover again.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
