"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, XCircle } from "lucide-react";
import { KdpTerm } from "@/components/KdpTerm";
import { fontsLoaded, missingGlyphs } from "@/lib/fonts";
import { PAGE_LIMITS } from "@/lib/kdp";
import type { Project } from "@/lib/model";
import { runPreflight, type CheckStatus, type PreflightReport } from "@/lib/preflight";
import { cn } from "@/lib/utils";

const ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />,
  warn: <AlertTriangle className="size-4 shrink-0 text-amber-600" />,
  fail: <XCircle className="size-4 shrink-0 text-red-600" />,
};

/**
 * Live KDP preflight for the open book. Recomputed (debounced) as the book
 * changes; every flagged page links straight to its editor.
 */
export function PreflightPanel({ project }: { project: Project }) {
  const [report, setReport] = React.useState<PreflightReport | null>(null);
  const [showPassed, setShowPassed] = React.useState(false);

  React.useEffect(() => {
    const run = () => setReport(runPreflight(project, fontsLoaded() ? { missingGlyphs: (t, f, w) => missingGlyphs(t, f, w) } : {}));
    const t = setTimeout(run, report ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  if (!report) return null;
  const fails = report.checks.filter((c) => c.status === "fail");
  const warns = report.checks.filter((c) => c.status === "warn");
  const passes = report.checks.filter((c) => c.status === "pass");
  const limits = PAGE_LIMITS[project.trimSize][project.paperType];
  const tone = fails.length ? "border-red-200 bg-red-50" : warns.length ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50";

  // Links from page numbers to the page's editor, when it has one.
  const editHref = (pageNumber: number) => {
    const page = report.book.pages[pageNumber - 1];
    if (!page || (page.kind !== "design" && page.kind !== "puzzle")) return null;
    return `/book/edit?id=${encodeURIComponent(project.id)}&item=${encodeURIComponent(page.item.id)}`;
  };

  return (
    <section className={cn("rounded-lg border p-4", tone)} aria-label="KDP preflight">
      <div className="flex items-center gap-2 font-semibold">
        {fails.length ? ICON.fail : warns.length ? ICON.warn : ICON.pass}
        <span>{fails.length ? "Not ready for KDP" : warns.length ? "Ready, with warnings" : "Ready for KDP"}</span>
      </div>
      <p className="mt-1 text-xs text-neutral-600">
        <KdpTerm term="pageCount">{report.pageCount} pages</KdpTerm> · KDP allows {limits.min}–{limits.max}
      </p>

      <ul className="mt-3 space-y-2">
        {[...fails, ...warns, ...(showPassed ? passes : [])].map((c) => (
          <li key={c.id} className="rounded-md bg-white/70 p-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              {ICON[c.status]} {c.title}
            </div>
            {c.details.map((d, i) => (
              <p key={i} className="mt-1 text-xs text-neutral-700">
                {d}
              </p>
            ))}
            {c.status !== "pass" && c.pages && c.pages.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[...new Set(c.pages)].slice(0, 24).map((p) => {
                  const href = editHref(p);
                  const chip = "rounded bg-neutral-900/5 px-1.5 py-0.5 font-mono text-[10px]";
                  return href ? (
                    <Link key={p} href={href} className={cn(chip, "hover:bg-neutral-900 hover:text-white")}>
                      p.{p}
                    </Link>
                  ) : (
                    <span key={p} className={chip}>
                      p.{p}
                    </span>
                  );
                })}
              </div>
            )}
          </li>
        ))}
      </ul>

      {passes.length > 0 && (
        <button className="mt-2 flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900" onClick={() => setShowPassed((v) => !v)}>
          <ChevronDown className={cn("size-3.5 transition-transform", showPassed && "rotate-180")} />
          {showPassed ? "Hide" : "Show"} {passes.length} passed check{passes.length > 1 ? "s" : ""}
        </button>
      )}
    </section>
  );
}
