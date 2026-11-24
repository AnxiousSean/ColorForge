/**
 * Paperback cover wrap layout (back + spine + front, with bleed all round).
 * Coordinates are cover inches, top-left origin, bleed included.
 */

import { BLEED_IN, getCoverLayout, getTrimSize, type CoverLayout, type Rect } from "@/lib/kdp";
import { estimateTextWidth, fitTextSize, wrapBalanced, wrapText, type TextBox } from "@/lib/layout";
import type { Project } from "@/lib/model";

/** Text keep-in from every trim edge (KDP's minimum is 0.125"). */
export const COVER_SAFE_IN = 0.25;
/** Keep-in on each side of spine text (KDP: 0.0625"). */
export const SPINE_SAFE_IN = 0.0625;
/** KDP prints the ISBN barcode in this box at the bottom-right of the back cover. */
export const BARCODE_BOX = { widthIn: 2, heightIn: 1.2, insetIn: 0.25 } as const;

export interface CoverGeometry extends CoverLayout {
  front: Rect;
  back: Rect;
  spineSafe: Rect;
  frontSafe: Rect;
  backSafe: Rect;
  barcode: Rect;
  trim: Rect;
}

const inset = (r: Rect, d: number): Rect => ({ xIn: r.xIn + d, yIn: r.yIn + d, widthIn: r.widthIn - 2 * d, heightIn: r.heightIn - 2 * d });

export function getCoverGeometry(project: Pick<Project, "trimSize" | "paperType">, pageCount: number): CoverGeometry {
  const layout = getCoverLayout(project.trimSize, pageCount, project.paperType);
  const back = layout.backCover;
  const front = layout.frontCover;
  const spine = layout.spine;
  return {
    ...layout,
    front,
    back,
    frontSafe: inset(front, COVER_SAFE_IN),
    backSafe: inset(back, COVER_SAFE_IN),
    spineSafe: { xIn: spine.xIn + SPINE_SAFE_IN, yIn: spine.yIn + COVER_SAFE_IN, widthIn: Math.max(0, spine.widthIn - 2 * SPINE_SAFE_IN), heightIn: spine.heightIn - 2 * COVER_SAFE_IN },
    barcode: {
      xIn: back.xIn + back.widthIn - BARCODE_BOX.insetIn - BARCODE_BOX.widthIn,
      yIn: back.yIn + back.heightIn - BARCODE_BOX.insetIn - BARCODE_BOX.heightIn,
      widthIn: BARCODE_BOX.widthIn,
      heightIn: BARCODE_BOX.heightIn,
    },
    trim: { xIn: BLEED_IN, yIn: BLEED_IN, widthIn: layout.widthIn - 2 * BLEED_IN, heightIn: layout.heightIn - 2 * BLEED_IN },
  };
}

export interface CoverLayoutResult {
  geometry: CoverGeometry;
  title: TextBox[];
  subtitle: TextBox[];
  author: TextBox | null;
  /** Panel holding the cover art on the front. */
  artPanel: Rect;
  /** Spine text, drawn rotated 90° clockwise about its centre (reads top to bottom). */
  spine: (TextBox & { rotate: true }) | null;
  /** Explains why spine text is off, if it is. */
  spineNote: string | null;
  backTitle: TextBox | null;
  blurb: TextBox[];
  /** Blurb text that did not fit above the barcode box. */
  blurbOverflow: boolean;
}

export function layoutCover(project: Project, pageCount: number): CoverLayoutResult {
  const g = getCoverGeometry(project, pageCount);
  const fs = g.frontSafe;
  const cx = fs.xIn + fs.widthIn / 2;
  const small = getTrimSize(project.trimSize).heightIn < 10;

  // Front: title block at the top, author at the bottom, art panel between.
  const titleMax = small ? 0.62 : 0.72;
  let titleSize = titleMax;
  let titleLines = wrapBalanced(project.title, titleSize, fs.widthIn, true);
  while (titleLines.length > 3 && titleSize > 0.35) {
    titleSize -= 0.04;
    titleLines = wrapBalanced(project.title, titleSize, fs.widthIn, true);
  }
  let y = fs.yIn + 0.15;
  const title = titleLines.map((text) => {
    y += titleSize;
    const box: TextBox = { text, x: cx, y, size: titleSize, anchor: "middle", weight: "bold" };
    y += titleSize * 0.18;
    return box;
  });

  const subtitleSize = small ? 0.24 : 0.28;
  y += 0.12;
  const subtitle = project.subtitle
    ? wrapBalanced(project.subtitle, subtitleSize, fs.widthIn * 0.9).map((text) => {
        y += subtitleSize;
        const box: TextBox = { text, x: cx, y, size: subtitleSize, anchor: "middle" };
        y += subtitleSize * 0.3;
        return box;
      })
    : [];

  const authorSize = small ? 0.26 : 0.3;
  const author: TextBox | null = project.author
    ? { text: project.author, x: cx, y: fs.yIn + fs.heightIn - 0.12, size: fitTextSize(project.author, fs.widthIn, authorSize), anchor: "middle" }
    : null;

  const panelTop = y + 0.3;
  const panelBottom = author ? author.y - author.size - 0.3 : fs.yIn + fs.heightIn;
  const artPanel: Rect = { xIn: fs.xIn + 0.2, yIn: panelTop, widthIn: fs.widthIn - 0.4, heightIn: Math.max(1, panelBottom - panelTop) };

  // Spine.
  let spine: CoverLayoutResult["spine"] = null;
  let spineNote: string | null = null;
  if (!g.allowsSpineText) {
    spineNote = `KDP only allows spine text on books with more than 79 pages (this one has ${pageCount}).`;
  } else if (!project.cover.showSpineText) {
    spineNote = "Spine text is turned off.";
  } else {
    const text = project.author ? `${project.title}  ·  ${project.author}` : project.title;
    const maxByWidth = g.spineSafe.widthIn * 0.62;
    const size = Math.min(maxByWidth, 0.32, g.spineSafe.heightIn / Math.max(0.01, estimateTextWidth(text, 1, true)));
    if (size < 0.06) {
      spineNote = "The spine is too narrow for readable text.";
    } else {
      spine = {
        text,
        // Drawn horizontally centred on the spine's midpoint with the baseline
        // half a cap-height low, then rotated 90° clockwise about the
        // midpoint (see spineRotation): the letters end up centred across
        // the spine and along its length.
        x: g.spine.xIn + g.spine.widthIn / 2,
        y: g.spine.yIn + g.spine.heightIn / 2 + size * CAP_HALF,
        size,
        anchor: "middle",
        weight: "bold",
        rotate: true,
      };
    }
  }

  // Back: title and blurb above the barcode box.
  const bs = g.backSafe;
  const backTitleSize = 0.32;
  const backTitle: TextBox | null = project.title
    ? { text: project.title, x: bs.xIn + bs.widthIn / 2, y: bs.yIn + 0.2 + backTitleSize, size: fitTextSize(project.title, bs.widthIn, backTitleSize, 0.2, true), anchor: "middle", weight: "bold" }
    : null;
  const blurbSize = 0.17;
  const lineHeight = blurbSize * 1.5;
  const blurbBottom = g.barcode.yIn - 0.2;
  let by = (backTitle ? backTitle.y : bs.yIn) + 0.45;
  const blurb: TextBox[] = [];
  let blurbOverflow = false;
  for (const para of project.cover.blurb.split(/\n\s*\n|\n/)) {
    for (const line of wrapText(para.trim(), blurbSize, bs.widthIn - 0.2)) {
      if (by + blurbSize > blurbBottom) {
        blurbOverflow = true;
        break;
      }
      blurb.push({ text: line, x: bs.xIn + 0.1, y: by + blurbSize, size: blurbSize, anchor: "start" });
      by += lineHeight;
    }
    by += lineHeight * 0.6;
  }

  return { geometry: g, title, subtitle, author, artPanel, spine, spineNote, backTitle, blurb, blurbOverflow };
}

/** Half the cap height as a fraction of font size (Atkinson Hyperlegible caps ≈ 0.67 em). */
export const CAP_HALF = 0.34;

/** SVG transform that turns the spine text to read top-to-bottom, centred on the spine. */
export function spineRotation(spine: TextBox): string {
  const cy = spine.y - spine.size * CAP_HALF;
  return `rotate(90 ${spine.x.toFixed(4)} ${cy.toFixed(4)})`;
}

/** Relative luminance contrast ratio (WCAG) between two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return 0;
    const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
      const c = parseInt(h!, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

export const COVER_PALETTES: ReadonlyArray<{ name: string; background: string; textColor: string; panelColor: string }> = [
  { name: "Navy", background: "#1f4e79", textColor: "#ffffff", panelColor: "#ffffff" },
  { name: "Teal", background: "#0f766e", textColor: "#ffffff", panelColor: "#ffffff" },
  { name: "Plum", background: "#6b2d5c", textColor: "#ffffff", panelColor: "#ffffff" },
  { name: "Sunshine", background: "#f6c945", textColor: "#1f2937", panelColor: "#ffffff" },
  { name: "Coral", background: "#e76f51", textColor: "#ffffff", panelColor: "#ffffff" },
  { name: "Sage", background: "#a3b18a", textColor: "#1f2937", panelColor: "#ffffff" },
  { name: "Charcoal", background: "#27272a", textColor: "#fafafa", panelColor: "#ffffff" },
  { name: "Sky", background: "#7cc6fe", textColor: "#0f172a", panelColor: "#ffffff" },
];
