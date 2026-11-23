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

const SVG_NS = "http://www.w3.org/2000/svg";

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

  // svg2pdf reads computed styles, so the SVG must be in the document.
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;pointer-events:none;";
  document.body.appendChild(host);

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
      const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
      const svg = parsed.documentElement;
      if (svg.namespaceURI !== SVG_NS || svg.querySelector("parsererror")) {
        throw new Error(`Page ${page.slot.pageNumber} could not be prepared for PDF.`);
      }
      const el = document.importNode(svg, true);
      host.replaceChildren(el);

      if (i > 0) pdf.addPage([size.widthPt, size.heightPt], orientation);
      await svg2pdf(el, pdf, { x: 0, y: 0, width: size.widthPt, height: size.heightPt });

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

export function downloadBytes(bytes: Uint8Array, filename: string, type = "application/pdf"): void {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
