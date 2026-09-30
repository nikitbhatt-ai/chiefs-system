// Placement map for the combined vehicle diagrams.
//
// Five templates used to be one photo per side (driver / passenger / front /
// rear / top), each its own tab. They are now ONE combined picture
// (public/upfit-templates/<slug>.jpg, built by
// scripts/build-upfit-composites.py). Pins saved on the old per-side photos
// carry a `view` and coordinates relative to that photo; this map moves them
// onto the combined picture so old estimates keep their layout.
//
// For each old view: `src` = where the vehicle sat in the old photo and
// `dst` = where it sits in the combined picture, both [x, y, w, h] as
// fractions; `rotate` = 90 when that view was turned clockwise (the roof).
// GENERATED — re-run the script and paste its output if a photo changes.

import type { UpfitPin } from "@/db/schema";
import { getPinSize } from "./templates";

type Rect = [number, number, number, number];
type ViewPlacement = { src: Rect; dst: Rect; rotate: number };

export const COMPOSITE_VIEWS: Record<string, Record<string, ViewPlacement>> = {"tahoe":{
    "driver":{"src":[0.04631,0.20917,0.90799,0.45358],"dst":[0.22749,0.18384,0.50633,0.37604],"rotate":0},
    "passenger":{"src":[0.0457,0.21778,0.90799,0.45398],"dst":[0.22749,0.5954,0.50633,0.37674],"rotate":0},
    "front":{"src":[0.21035,0.12848,0.58142,0.63063],"dst":[0.7519,0.18384,0.23363,0.37674],"rotate":0},
    "rear":{"src":[0.23547,0.12338,0.52966,0.65217],"dst":[0.76564,0.5954,0.20579,0.37674],"rotate":0},
    "top":{"src":[0.07082,0.17783,0.85926,0.52918],"dst":[0.01447,0.18384,0.19494,0.7883],"rotate":90}},
  
    "tahoe_2026":{
    "driver":{"src":[0.04361,0.20807,0.91278,0.45494],"dst":[0.22671,0.18322,0.5091,0.37692],"rotate":0},
    "passenger":{"src":[0.0439,0.21347,0.9125,0.45437],"dst":[0.22671,0.5951,0.50946,0.37692],"rotate":0},
    "front":{"src":[0.21314,0.12338,0.57312,0.62946],"dst":[0.75437,0.18322,0.23108,0.37692],"rotate":0},
    "rear":{"src":[0.25431,0.12534,0.49137,0.62946],"dst":[0.77074,0.5951,0.19796,0.37692],"rotate":0},
    "top":{"src":[0.0445,0.15511,0.9119,0.55699],"dst":[0.01456,0.18322,0.19396,0.78881],"rotate":90}},
  
    "tahoe_1520":{
    "driver":{"src":[0.04693,0.20172,0.90615,0.47669],"dst":[0.23242,0.17805,0.50179,0.38086],"rotate":0},
    "passenger":{"src":[0.04723,0.21308,0.90584,0.47669],"dst":[0.23242,0.59237,0.50179,0.38086],"rotate":0},
    "front":{"src":[0.22828,0.11986,0.54526,0.6177],"dst":[0.75251,0.17805,0.23314,0.38086],"rotate":0},
    "rear":{"src":[0.23918,0.12456,0.52225,0.65805],"dst":[0.76435,0.59237,0.20947,0.38086],"rotate":0},
    "top":{"src":[0.03815,0.15942,0.9116,0.55347],"dst":[0.01435,0.17805,0.20014,0.79518],"rotate":90}},
  
    "silverado":{
    "driver":{"src":[0.03451,0.22523,0.92825,0.4152],"dst":[0.20817,0.19237,0.53476,0.36947],"rotate":0},
    "passenger":{"src":[0.03754,0.22327,0.92825,0.4152],"dst":[0.20817,0.6,0.53476,0.36947],"rotate":0},
    "front":{"src":[0.20315,0.11986,0.59552,0.63964],"dst":[0.76203,0.19237,0.22269,0.36947],"rotate":0},
    "rear":{"src":[0.21919,0.13553,0.56191,0.63376],"dst":[0.76738,0.6,0.21199,0.36947],"rotate":0},
    "top":{"src":[0.05752,0.18645,0.89282,0.51586],"dst":[0.01528,0.19237,0.1738,0.7771],"rotate":90}},
  
    "explorer":{
    "driver":{"src":[0.05239,0.28409,0.89612,0.42868],"dst":[0.22684,0.18759,0.51471,0.37374],"rotate":0},
    "passenger":{"src":[0.05117,0.28437,0.89646,0.42852],"dst":[0.22684,0.5974,0.51471,0.37302],"rotate":0},
    "front":{"src":[0.20769,0.15315,0.58159,0.63572],"dst":[0.75993,0.18759,0.22537,0.37374],"rotate":0},
    "rear":{"src":[0.24069,0.1555,0.5162,0.62358],"dst":[0.77059,0.5974,0.20404,0.37374],"rotate":0},
    "top":{"src":[0.03845,0.20917,0.92643,0.58167],"dst":[0.01471,0.18759,0.19375,0.78355],"rotate":90}}};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// The pin's current width/height as fractions of its old photo.
function pinFrac(pin: UpfitPin): { w: number; h: number } {
  const sz = getPinSize(pin.size);
  if (pin.shape === "circle") {
    const d = pin.widthFracOverride ?? sz.widthFrac;
    return { w: d, h: d };
  }
  if (pin.widthFracOverride != null && pin.heightFracOverride != null) {
    return { w: pin.widthFracOverride, h: pin.heightFracOverride };
  }
  const vertical = pin.orientation === "vertical";
  return { w: vertical ? sz.heightFrac : sz.widthFrac, h: vertical ? sz.widthFrac : sz.heightFrac };
}

/**
 * Move pins saved on a template's old per-side photos onto its combined
 * picture. Pins already on the combined picture (no `view`, or a template
 * that was always a single picture) pass through unchanged. Safe to call
 * on every load; the result has no `view` so it converts only once.
 */
export function normalizePins(bodyStyle: string, pins: UpfitPin[]): UpfitPin[] {
  const map = COMPOSITE_VIEWS[bodyStyle];
  if (!map) return pins;
  return pins.map((pin) => {
    const place = pin.view ? map[pin.view] : undefined;
    if (!place) return pin.view ? { ...pin, view: undefined } : pin;
    const [sx, sy, sw, sh] = place.src;
    const [dx, dy, dw, dh] = place.dst;
    const u = clamp01((pin.x - sx) / sw);
    const v = clamp01((pin.y - sy) / sh);
    const rot = place.rotate === 90;
    // Clockwise quarter turn: (u, v) -> (1 - v, u).
    const nu = rot ? 1 - v : u;
    const nv = rot ? u : v;
    const { w, h } = pinFrac(pin);
    // Keep the light the same size relative to the vehicle, stored as an
    // explicit size so it doesn't jump to the preset's (whole-picture) size.
    const widthFracOverride = rot ? (h / sh) * dw : (w / sw) * dw;
    const heightFracOverride = rot ? (w / sw) * dh : (h / sh) * dh;
    const circle = pin.shape === "circle";
    return {
      ...pin,
      view: undefined,
      x: dx + nu * dw,
      y: dy + nv * dh,
      widthFracOverride: circle ? (w / sw) * dw : widthFracOverride,
      heightFracOverride: circle ? (w / sw) * dw : heightFracOverride,
    };
  });
}
