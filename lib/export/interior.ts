/**
 * Client-side interior PDF export.
 *
 * Pipeline, per page:
 *   PageSvg (outlined text, no guides) -> SVG element -> svg2pdf.js draws
 *   it as vector paths onto a jsPDF page of the exact KDP size.
 * Then pdf-lib finalizes the document (trim/bleed boxes, font clean-up,
 * metadata) and the result is re-read and verified before download.
 *
 * Nothing is rasterized: every line and glyph stays a vector.
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PageSvg } from "@/components/render/PageSvg";
import { finalizeInterior, interiorFilename, verifyInterior, type PageGeometry, type Verification } from "@/lib/export/finalize";
import { loadFonts } from "@/lib/fonts";
import { getPageContext } from "@/lib/layout";
import { getPageDimensions } from "@/lib/kdp";
import type { Project } from "@/lib/model";
import type { ResolvedBook } from "@/lib/pages";
import { createSvgHost, drawSvgMarkup } from "@/lib/export/svg-pdf";

export type ExportStage = "preparing" | "rendering" | "finalizing" | "verifying" | "done";

export interface ExportProgress {
  stage: ExportStage;
  done: number;
  total: number;
}

export interface ExportResult {
  bytes: Uint8Array;
  filename: string;
  verification: Verification;
  milliseconds: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
  }
}

export async function exportInterior(
  project: Project,
  book: ResolvedBook,
  options: { onProgress?: (p: ExportProgress) => void; signal?: AbortSignal } = {},
): Promise<ExportResult> {
  const started = performance.now();
  const total = book.pages.length;
  const report = (stage: ExportStage, done = 0) => options.onProgress?.({ stage, done, total });
  const checkCancel = () => {
    if (options.signal?.aborted) throw new ExportCancelled();
  };

  report("preparing");
  await loadFonts();
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);

  const size = getPageDimensions(project.trimSize, project.hasBleed);
  const orientation = size.widthPt > size.heightPt ? "landscape" : "portrait";
  // 3 decimals of a point is ~0.001 mm: far finer than any printer, and much
  // smaller than jsPDF's default 16-digit coordinates.
  const pdf = new jsPDF({ unit: "pt", format: [size.widthPt, size.heightPt], orientation, compress: true, putOnlyUsedFonts: true, floatPrecision: 3 });

  const host = createSvgHost();

  const geometry: PageGeometry[] = [];
  try {
    for (let i = 0; i < total; i++) {
      checkCancel();
      const page = book.pages[i]!;
      const ctx = getPageContext(project.trimSize, project.hasBleed, total, page.slot.pageNumber);
      geometry.push({ page: ctx.page, trim: ctx.trim });

      const markup = renderToStaticMarkup(
        React.createElement(PageSvg, { project, page, pageCount: total, outlineText: true, showOverlay: false }),
      );
      if (i > 0) pdf.addPage([size.widthPt, size.heightPt], orientation);
      await drawSvgMarkup(svg2pdf, pdf, host, markup, size.widthPt, size.heightPt, `Page ${page.slot.pageNumber}`);

      report("rendering", i + 1);
      // Yield so the progress bar paints and the tab stays responsive.
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    host.remove();
  }

  checkCancel();
  report("finalizing", total);
  const raw = new Uint8Array(pdf.output("arraybuffer"));
  const bytes = await finalizeInterior(raw, geometry, {
    title: project.title,
    author: project.author,
    subject: project.subtitle || undefined,
  });

  report("verifying", total);
  const verification = await verifyInterior(bytes, geometry);
  report("done", total);

  return {
    bytes,
    filename: interiorFilename(project.title, project.trimSize === "letter" ? "8.5x11" : "8.5x8.5", project.hasBleed),
    verification,
    milliseconds: performance.now() - started,
  };
}

export { downloadBytes } from "@/lib/export/download";
