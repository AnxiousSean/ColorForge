/**
 * Text measurement used by page layout and artwork bounds.
 *
 * Until the real fonts are loaded (and in plain unit tests) widths are
 * approximated. Once lib/fonts.ts loads the bundled fonts it registers an
 * exact measurer, so wrapping and centring match the printed outlines.
 */

export type BookFont = "sans" | "serif" | "rounded";
export type FontWeight = 400 | 700;

export const FONT_FAMILIES: Readonly<Record<BookFont, { label: string; family: string; fallback: string }>> = {
  sans: { label: "Hyperlegible", family: "Atkinson Hyperlegible", fallback: "Helvetica, Arial, sans-serif" },
  serif: { label: "Serif", family: "Lora", fallback: "Georgia, serif" },
  rounded: { label: "Rounded", family: "Nunito", fallback: "'Trebuchet MS', sans-serif" },
};

export const cssFontStack = (font: BookFont) => `'${FONT_FAMILIES[font].family}', ${FONT_FAMILIES[font].fallback}`;

export type Measurer = (text: string, size: number, font: BookFont, weight: FontWeight) => number;

/** Average advance as a fraction of the font size; deliberately a little wide. */
export const APPROX_WIDTH_FACTOR = 0.6;

const approximate: Measurer = (text, size) => text.length * size * APPROX_WIDTH_FACTOR;

let measurer: Measurer = approximate;

export function setMeasurer(m: Measurer | null): void {
  measurer = m ?? approximate;
}

export function measureText(text: string, size: number, font: BookFont = "sans", weight: FontWeight = 400): number {
  return measurer(text, size, font, weight);
}
