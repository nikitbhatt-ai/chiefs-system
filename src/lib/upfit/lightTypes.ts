// Server-side loader for the configurator's light-type list.
//
// The list lives in upfit_light_types (edited in Settings → Light types).
// Until docs/sql/upfit_light_types.sql has been run — or if the table is
// empty — the configurator falls back to the built-in LIGHT_TYPES so it
// never breaks.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { upfitLightTypes } from "@/db/schema";
import {
  LIGHT_TYPES,
  PIN_SIZES,
  type LightType,
  type LightTypeGroup,
  type PinSizeKey,
} from "./templates";

export const LIGHT_SHAPES = ["rect", "circle", "pushbar", "pushbar_wrap"] as const;
export const LIGHT_GROUPS: LightTypeGroup[] = ["lights", "accessories"];

type Shape = (typeof LIGHT_SHAPES)[number];

export function normalizeLightType(row: {
  key: string;
  label: string;
  dims: string | null;
  group: string;
  shape: string;
  size: string;
}): LightType {
  return {
    key: row.key,
    label: row.label,
    dims: row.dims ?? undefined,
    group: (LIGHT_GROUPS as string[]).includes(row.group) ? (row.group as LightTypeGroup) : "lights",
    shape: (LIGHT_SHAPES as readonly string[]).includes(row.shape) ? (row.shape as Shape) : "rect",
    size: row.size in PIN_SIZES ? (row.size as PinSizeKey) : "medium",
  };
}

/** The picker list: active rows in sort order, or the built-in list. */
export async function loadLightTypes(): Promise<LightType[]> {
  try {
    const rows = await db
      .select()
      .from(upfitLightTypes)
      .where(eq(upfitLightTypes.archived, false))
      .orderBy(asc(upfitLightTypes.sortOrder), asc(upfitLightTypes.label));
    return rows.length > 0 ? rows.map(normalizeLightType) : LIGHT_TYPES;
  } catch (err) {
    console.error("upfit_light_types unavailable, using the built-in list (run docs/sql/upfit_light_types.sql?)", err);
    return LIGHT_TYPES;
  }
}
