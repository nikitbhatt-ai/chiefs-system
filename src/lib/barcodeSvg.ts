import bwipjs from "bwip-js/node";

// Server-side Code 128 → SVG (bwip-js, pure JS, no canvas). Human-readable
// text is drawn by the label markup, not baked into the SVG. Returns null if
// the value can't be encoded (e.g. non-ASCII characters in a SKU).
export function code128Svg(text: string): string | null {
  try {
    return bwipjs.toSVG({ bcid: "code128", text, height: 10, includetext: false, paddingwidth: 0 });
  } catch {
    return null;
  }
}
