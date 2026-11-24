/**
 * Bundled fonts (SIL Open Font License, see public/fonts/LICENSE-*.txt).
 *
 * The same files drive three things, so screen and print always agree:
 * - CSS @font-face for the on-screen preview (app/globals.css),
 * - exact text measurement for layout,
 * - text-to-outline conversion for the PDF, so the PDF has no fonts at all
 *   and KDP's embedded-font check can never fail.
 */

import opentype, { type Font } from "opentype.js";
import { FONT_FAMILIES, setMeasurer, type BookFont, type FontWeight } from "@/lib/text-metrics";

export { FONT_FAMILIES, cssFontStack } from "@/lib/text-metrics";

export const WEIGHTS: readonly FontWeight[] = [400, 700];

export const fontUrl = (font: BookFont, weight: FontWeight) => `/fonts/${font}-${weight}.woff`;

type Registry = Map<string, Font>;
const key = (font: BookFont, weight: FontWeight) => `${font}-${weight}`;

let registry: Registry | null = null;
let loading: Promise<void> | null = null;

/** Registers already-loaded font data (used by tests and by `loadFonts`). */
export function registerFonts(buffers: Record<string, ArrayBuffer>): void {
  const next: Registry = new Map();
  for (const font of Object.keys(FONT_FAMILIES) as BookFont[]) {
    for (const weight of WEIGHTS) {
      const buf = buffers[key(font, weight)];
      if (!buf) throw new Error(`Missing font data for ${key(font, weight)}`);
      next.set(key(font, weight), opentype.parse(buf));
    }
  }
  registry = next;
  setMeasurer((text, size, font, weight) => getFont(font, weight).getAdvanceWidth(text, size, { kerning: true }));
}

/** Fetches and parses all bundled fonts once. */
export function loadFonts(fetcher: (url: string) => Promise<ArrayBuffer> = defaultFetch): Promise<void> {
  if (registry) return Promise.resolve();
  loading ??= (async () => {
    const entries = await Promise.all(
      (Object.keys(FONT_FAMILIES) as BookFont[]).flatMap((font) =>
        WEIGHTS.map(async (weight) => [key(font, weight), await fetcher(fontUrl(font, weight))] as const),
      ),
    );
    registerFonts(Object.fromEntries(entries));
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

async function defaultFetch(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load font ${url} (${res.status})`);
  return res.arrayBuffer();
}

export const fontsLoaded = () => registry !== null;

export function getFont(font: BookFont, weight: FontWeight = 400): Font {
  const f = registry?.get(key(font, weight));
  if (!f) throw new Error("Fonts are not loaded yet");
  return f;
}

export type Anchor = "start" | "middle";

/**
 * SVG path data for `text` drawn with its baseline at (x, y). Units are
 * whatever `size` is in (inches throughout this app).
 */
export function textToPathData(
  text: string,
  x: number,
  y: number,
  size: number,
  font: BookFont = "sans",
  weight: FontWeight = 400,
  anchor: Anchor = "start",
): string {
  const f = getFont(font, weight);
  const startX = anchor === "middle" ? x - f.getAdvanceWidth(text, size, { kerning: true }) / 2 : x;
  return f.getPath(text, startX, y, size, { kerning: true }).toPathData(4);
}

/** Characters the font has no glyph for; they would print as empty boxes. */
export function missingGlyphs(text: string, font: BookFont = "sans", weight: FontWeight = 400): string[] {
  const f = getFont(font, weight);
  const missing = new Set<string>();
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    if (f.charToGlyphIndex(ch) === 0) missing.add(ch);
  }
  return [...missing];
}

/** For tests only. */
export function resetFontsForTests(): void {
  registry = null;
  loading = null;
  setMeasurer(null);
}
