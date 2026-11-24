/**
 * Shared step of the PDF exports: draw one SVG (as markup) onto the current
 * jsPDF page with svg2pdf.js, as vectors.
 */

import type { jsPDF } from "jspdf";

const SVG_NS = "http://www.w3.org/2000/svg";

export type Svg2Pdf = (element: Element, pdf: jsPDF, options: { x: number; y: number; width: number; height: number }) => Promise<jsPDF>;

/** A hidden, in-document host: svg2pdf reads computed styles, so SVGs must be attached. */
export function createSvgHost(): HTMLDivElement {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText = "position:fixed;left:-100000px;top:0;width:10px;height:10px;overflow:hidden;pointer-events:none;";
  document.body.appendChild(host);
  return host;
}

export async function drawSvgMarkup(
  svg2pdf: Svg2Pdf,
  pdf: jsPDF,
  host: HTMLElement,
  markup: string,
  widthPt: number,
  heightPt: number,
  label: string,
): Promise<void> {
  const parsed = new DOMParser().parseFromString(markup, "image/svg+xml");
  const svg = parsed.documentElement;
  if (svg.namespaceURI !== SVG_NS || svg.querySelector("parsererror")) {
    throw new Error(`${label} could not be prepared for PDF.`);
  }
  const el = document.importNode(svg, true);
  host.replaceChildren(el);
  await svg2pdf(el, pdf, { x: 0, y: 0, width: widthPt, height: heightPt });
}
