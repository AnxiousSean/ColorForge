"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Download, FileDown, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatBytes } from "@/lib/export/finalize";
import { ExportCancelled, downloadBytes, exportInterior, type ExportProgress, type ExportResult } from "@/lib/export/interior";
import { fontsLoaded, missingGlyphs } from "@/lib/fonts";
import { PAPER_TYPES, TRIM_SIZES } from "@/lib/kdp";
import type { Project } from "@/lib/model";
import { runPreflight, type CheckStatus } from "@/lib/preflight";
import { cn } from "@/lib/utils";
import { useProjects } from "@/store/projects";

const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="size-4 shrink-0 text-amber-600" />,
  fail: <XCircle className="size-4 shrink-0 text-red-600" />,
};

const STAGE_LABEL: Record<ExportProgress["stage"], string> = {
  preparing: "Loading fonts and PDF engine…",
  rendering: "Drawing pages",
  finalizing: "Setting trim boxes and cleaning up…",
  verifying: "Checking the finished file…",
  done: "Done",
};

export function ExportDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const flush = useProjects((s) => s.flush);
  const report = React.useMemo(
    () => (open ? runPreflight(project, fontsLoaded() ? { missingGlyphs: (t, f, w) => missingGlyphs(t, f, w) } : {}) : null),
    [open, project],
  );
  const [progress, setProgress] = React.useState<ExportProgress | null>(null);
  const [result, setResult] = React.useState<ExportResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const abort = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    if (!open) {
      abort.current?.abort();
      setProgress(null);
      setResult(null);
      setError(null);
    }
  }, [open]);

  const busy = progress !== null && progress.stage !== "done" && !error;
  const failures = report?.checks.filter((c) => c.status === "fail").length ?? 0;
  const warnings = report?.checks.filter((c) => c.status === "warn").length ?? 0;

  async function start() {
    if (!report) return;
    setError(null);
    setResult(null);
    abort.current = new AbortController();
    try {
      await flush();
      const r = await exportInterior(project, report.book, { onProgress: setProgress, signal: abort.current.signal });
      setResult(r);
      if (r.verification.ok) downloadBytes(r.bytes, r.filename);
    } catch (e) {
      if (e instanceof ExportCancelled) setProgress(null);
      else setError((e as Error).message || "Export failed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogTitle>Export print-ready interior</DialogTitle>
        <DialogDescription>
          {report?.pageCount} pages · {TRIM_SIZES[project.trimSize].label} · {project.hasBleed ? "with bleed" : "no bleed"} · vector PDF
        </DialogDescription>

        {report && !result && (
          <ul className="mt-4 divide-y divide-neutral-100 rounded-md border border-neutral-200">
            {report.checks.map((c) => (
              <li key={c.id} className="flex gap-3 p-3">
                {STATUS_ICON[c.status]}
                <div className="min-w-0 text-sm">
                  <div className="font-medium">{c.title}</div>
                  {c.details.map((d, i) => (
                    <p key={i} className="mt-0.5 text-xs text-neutral-600">
                      {d}
                    </p>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        {progress && !result && !error && (
          <div className="mt-4" role="status" aria-live="polite">
            <div className="flex justify-between text-xs text-neutral-600">
              <span>{STAGE_LABEL[progress.stage]}</span>
              {progress.stage === "rendering" && (
                <span className="tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              )}
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full bg-neutral-900 transition-[width]"
                style={{ width: `${(progress.stage === "preparing" ? 0.02 : progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {error && <p className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {result && (
          <div className="mt-4 space-y-4">
            <div className={cn("rounded-md p-3 text-sm", result.verification.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800")}>
              <p className="font-medium">
                {result.verification.ok ? "Your PDF passed every check and is downloading." : "The finished file failed a check, so it was not downloaded."}
              </p>
              <p className="mt-0.5 text-xs">
                {result.filename} · {formatBytes(result.verification.fileBytes)} · built in {(result.milliseconds / 1000).toFixed(1)} s
              </p>
            </div>
            <ul className="space-y-1.5">
              {result.verification.checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2 text-sm">
                  {c.ok ? STATUS_ICON.pass : STATUS_ICON.fail}
                  <span className="font-medium">{c.label}:</span>
                  <span className="text-neutral-600">{c.detail}</span>
                </li>
              ))}
            </ul>
            {result.verification.ok && (
              <div className="rounded-md border border-neutral-200 p-3 text-xs text-neutral-700">
                <p className="mb-1.5 text-sm font-semibold text-neutral-900">On KDP&apos;s paperback content page, choose:</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-neutral-500">Ink and paper</dt>
                  <dd>{PAPER_TYPES[project.paperType].label}</dd>
                  <dt className="text-neutral-500">Trim size</dt>
                  <dd>{TRIM_SIZES[project.trimSize].label}</dd>
                  <dt className="text-neutral-500">Bleed settings</dt>
                  <dd>{project.hasBleed ? "Bleed (PDF only)" : "No bleed"}</dd>
                  <dt className="text-neutral-500">Manuscript</dt>
                  <dd>Upload {result.filename}</dd>
                </dl>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {!result && !busy && failures > 0 && <p className="mr-auto text-xs text-red-700">Fix {failures} failed check{failures > 1 ? "s" : ""} to export.</p>}
          {!result && !busy && failures === 0 && warnings > 0 && (
            <p className="mr-auto text-xs text-amber-800">{warnings} warning{warnings > 1 ? "s" : ""}: allowed, but worth a look.</p>
          )}
          {busy ? (
            <Button variant="outline" onClick={() => abort.current?.abort()}>
              Cancel
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          {result?.verification.ok ? (
            <Button onClick={() => downloadBytes(result.bytes, result.filename)}>
              <Download /> Download again
            </Button>
          ) : (
            <Button onClick={start} disabled={!report?.canExport || busy}>
              {busy ? <Loader2 className="animate-spin" /> : <FileDown />}
              {busy ? "Exporting…" : error ? "Try again" : "Export PDF"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
