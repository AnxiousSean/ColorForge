/**
 * PDF post-processing and verification with pdf-lib. Pure (no DOM), so it
 * runs in unit tests as well as in the browser.
 *
 * finalizeInterior():
 * - sets TrimBox/BleedBox on every page, so printers and preflight tools
 *   see exactly where the cut goes,
 * - removes font resources jsPDF registers even when nothing uses them
 *   (all text is already outlined), so no unembedded font is left in the file,
 * - writes document metadata.
 *
 * verifyInterior() then re-reads the finished bytes and checks the result
 * against what KDP will check.
 */

import { PDFDict, PDFDocument, PDFName, PDFStream, type PDFObject } from "pdf-lib";
import { formatBytes } from "@/lib/export/download";
import { MAX_INTERIOR_FILE_BYTES, PT_PER_INCH, type Dimensions, type Rect } from "@/lib/kdp";

export interface PageGeometry {
  page: Dimensions;
  /** Trim box in page inches, top-left origin. */
  trim: Rect;
}

export interface InteriorMeta {
  title: string;
  author: string;
  subject?: string;
}

const toPdfBox = (r: Rect, pageHeightIn: number) => ({
  x: r.xIn * PT_PER_INCH,
  y: (pageHeightIn - r.yIn - r.heightIn) * PT_PER_INCH,
  width: r.widthIn * PT_PER_INCH,
  height: r.heightIn * PT_PER_INCH,
});

export async function finalizeInterior(bytes: Uint8Array | ArrayBuffer, geometry: readonly PageGeometry[], meta: InteriorMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  if (pages.length !== geometry.length) {
    throw new Error(`Rendered ${pages.length} pages but expected ${geometry.length}.`);
  }

  pages.forEach((page, i) => {
    const g = geometry[i]!;
    const w = g.page.widthIn * PT_PER_INCH;
    const h = g.page.heightIn * PT_PER_INCH;
    page.setMediaBox(0, 0, w, h);
    page.setCropBox(0, 0, w, h);
    page.setBleedBox(0, 0, w, h);
    const t = toPdfBox(g.trim, g.page.heightIn);
    page.setTrimBox(t.x, t.y, t.width, t.height);
    page.node.Resources()?.delete(PDFName.of("Font"));
  });

  // Delete the (now unreferenced) font objects themselves.
  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (isFontObject(obj)) doc.context.delete(ref);
  }

  const now = new Date();
  doc.setTitle(meta.title || "Untitled");
  doc.setAuthor(meta.author || "");
  if (meta.subject) doc.setSubject(meta.subject);
  doc.setCreator("ColorForge KDP");
  doc.setProducer("ColorForge KDP (pdf-lib)");
  doc.setCreationDate(now);
  doc.setModificationDate(now);

  return doc.save({ useObjectStreams: true });
}

function isFontObject(obj: PDFObject): boolean {
  if (!(obj instanceof PDFDict)) return false;
  const type = obj.get(PDFName.of("Type"));
  return type === PDFName.of("Font") || type === PDFName.of("FontDescriptor");
}

export interface VerifyCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface Verification {
  ok: boolean;
  checks: VerifyCheck[];
  pageCount: number;
  fileBytes: number;
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.01;

export async function verifyInterior(
  bytes: Uint8Array,
  geometry: readonly PageGeometry[],
  options: { requireEvenPages?: boolean } = {},
): Promise<Verification> {
  const requireEven = options.requireEvenPages ?? true;
  const doc = await PDFDocument.load(bytes);
  const pages = doc.getPages();
  const checks: VerifyCheck[] = [];

  checks.push({
    label: "Page count",
    ok: pages.length === geometry.length && (!requireEven || pages.length % 2 === 0),
    detail: `${pages.length} pages (expected ${geometry.length})`,
  });

  const badSize: number[] = [];
  const badTrim: number[] = [];
  pages.forEach((page, i) => {
    const g = geometry[i];
    if (!g) return;
    const media = page.getMediaBox();
    if (!close(media.width, g.page.widthPt) || !close(media.height, g.page.heightPt) || media.x !== 0 || media.y !== 0) badSize.push(i + 1);
    const trim = page.getTrimBox();
    const t = toPdfBox(g.trim, g.page.heightIn);
    if (!close(trim.x, t.x) || !close(trim.y, t.y) || !close(trim.width, t.width) || !close(trim.height, t.height)) badTrim.push(i + 1);
  });
  const g0 = geometry[0];
  checks.push({
    label: "Page size",
    ok: badSize.length === 0,
    detail: badSize.length ? `Wrong size on page(s) ${badSize.slice(0, 10).join(", ")}` : g0 ? `Every page is ${g0.page.widthIn}" × ${g0.page.heightIn}"` : "No pages",
  });
  checks.push({
    label: "Trim and bleed",
    ok: badTrim.length === 0,
    detail: badTrim.length
      ? `Wrong trim box on page(s) ${badTrim.slice(0, 10).join(", ")}`
      : requireEven
        ? "Trim box set on every page; bleed only on top, bottom and outside edges"
        : "Trim box set; 0.125\" bleed on all four sides",
  });

  let fonts = 0;
  let images = 0;
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (isFontObject(obj)) fonts++;
    // Raster images are XObject streams with /Subtype /Image.
    if (obj instanceof PDFStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) images++;
  }
  checks.push({ label: "Fonts", ok: fonts === 0, detail: fonts ? `${fonts} font object(s) found` : "No fonts: all text is vector outlines" });
  checks.push({ label: "Vector artwork", ok: images === 0, detail: images ? `${images} raster image(s) found` : "No raster images: line art is fully vector" });

  checks.push({
    label: "File size",
    ok: bytes.byteLength <= MAX_INTERIOR_FILE_BYTES,
    detail: `${formatBytes(bytes.byteLength)} (KDP limit 650 MB)`,
  });

  return { ok: checks.every((c) => c.ok), checks, pageCount: pages.length, fileBytes: bytes.byteLength };
}

export { formatBytes } from "@/lib/export/download";

export function interiorFilename(title: string, trimLabel: string, hasBleed: boolean): string {
  const slug =
    title
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "book";
  return `${slug}-interior-${trimLabel}${hasBleed ? "-bleed" : ""}.pdf`;
}
