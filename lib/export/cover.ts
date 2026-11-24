/**
 * Cover exports: the full paperback wrap as a vector PDF, and the front
 * cover as a 300 DPI PNG (for listings, ads and the ebook edition).
 */

import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CoverSvg } from "@/components/render/CoverSvg";
import { getCoverGeometry } from "@/lib/cover";
import { finalizeInterior, verifyInterior, type Verification } from "@/lib/export/finalize";
import { createSvgHost, drawSvgMarkup } from "@/lib/export/svg-pdf";
import { loadFonts } from "@/lib/fonts";
import { MIN_DPI, PT_PER_INCH, inToPx } from "@/lib/kdp";
import type { Project } from "@/lib/model";

const slug = (title: string) =>
  title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "book";

export async function exportCoverPdf(project: Project, pageCount: number): Promise<{ bytes: Uint8Array; filename: string; verification: Verification }> {
  await loadFonts();
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const g = getCoverGeometry(project, pageCount);
  const w = g.widthIn * PT_PER_INCH;
  const h = g.heightIn * PT_PER_INCH;
  const pdf = new jsPDF({ unit: "pt", format: [w, h], orientation: "landscape", compress: true, putOnlyUsedFonts: true, floatPrecision: 3 });

  const host = createSvgHost();
  try {
    const markup = renderToStaticMarkup(React.createElement(CoverSvg, { project, pageCount, outlineText: true }));
    await drawSvgMarkup(svg2pdf, pdf, host, markup, w, h, "The cover");
  } finally {
    host.remove();
  }

  const geometry = [{ page: { widthIn: g.widthIn, heightIn: g.heightIn, widthPt: w, heightPt: h }, trim: g.trim }];
  const raw = new Uint8Array(pdf.output("arraybuffer"));
  const bytes = await finalizeInterior(raw, geometry, { title: `${project.title} (cover)`, author: project.author });
  const verification = await verifyInterior(bytes, geometry, { requireEvenPages: false });
  return { bytes, filename: `${slug(project.title)}-cover-${pageCount}p.pdf`, verification };
}

/** Front cover (trim area) as a PNG at `dpi` (300 by default: 2550 × 3300 for 8.5 × 11). */
export async function exportFrontCoverPng(project: Project, pageCount: number, dpi = MIN_DPI): Promise<{ blob: Blob; filename: string; width: number; height: number }> {
  await loadFonts();
  const g = getCoverGeometry(project, pageCount);
  const width = inToPx(g.front.widthIn, dpi);
  const height = inToPx(g.front.heightIn, dpi);
  // Text is outlined, so the image does not depend on fonts in the browser.
  const markup = renderToStaticMarkup(React.createElement(CoverSvg, { project, pageCount, outlineText: true, frontOnly: true, width, height }));
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
    return { blob, filename: `${slug(project.title)}-front-cover.png`, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
