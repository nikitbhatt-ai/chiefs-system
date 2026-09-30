import { revalidatePath } from "next/cache";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { upfitLightTypes } from "@/db/schema";
import { AppShell } from "@/components/AppShell";
import { SubmitButton } from "@/components/SubmitButton";
import { canDelete } from "@/lib/rbac";
import { PIN_SIZES, PIN_SIZE_ORDER } from "@/lib/upfit/templates";
import { LIGHT_GROUPS, LIGHT_SHAPES } from "@/lib/upfit/lightTypes";

export const dynamic = "force-dynamic";

// Settings → Light types: the configurator's "Choose a light type" list.
// Each type is a product-family name (no part numbers — the diagram is
// visual only) with the size text shown in the picker and the shape / preset
// size a new light starts with. Hidden types drop out of the picker; lights
// already placed keep their name.

const SHAPE_LABELS: Record<string, string> = {
  rect: "Bar",
  circle: "Round",
  pushbar: "Push bumper",
  pushbar_wrap: "Push bumper (full wrap)",
};
const GROUP_LABELS: Record<string, string> = { lights: "Lights", accessories: "Vehicle accessories" };

function readFields(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim().slice(0, 80);
  const dims = String(formData.get("dims") ?? "").trim().slice(0, 40) || null;
  const groupRaw = String(formData.get("group") ?? "lights");
  const shapeRaw = String(formData.get("shape") ?? "rect");
  const sizeRaw = String(formData.get("size") ?? "medium");
  const sortOrder = Math.round(Number(formData.get("sortOrder") ?? "0")) || 0;
  return {
    label,
    dims,
    group: (LIGHT_GROUPS as string[]).includes(groupRaw) ? groupRaw : "lights",
    shape: (LIGHT_SHAPES as readonly string[]).includes(shapeRaw) ? shapeRaw : "rect",
    size: sizeRaw in PIN_SIZES ? sizeRaw : "medium",
    sortOrder,
  };
}

function slugKey(label: string) {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "light";
  return `${base}_${Math.random().toString(36).slice(2, 6)}`;
}

function refresh() {
  revalidatePath("/settings/light-types");
  revalidatePath("/quotes", "layout");
}

async function addType(formData: FormData) {
  "use server";
  const f = readFields(formData);
  if (!f.label) return;
  await db.insert(upfitLightTypes).values({ key: slugKey(f.label), ...f });
  refresh();
}

async function updateType(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const f = readFields(formData);
  if (!id || !f.label) return;
  await db.update(upfitLightTypes).set(f).where(eq(upfitLightTypes.id, id));
  refresh();
}

// Hide ↔ Show: flips the stored flag (reads it rather than trusting the
// button, so a double click can't get it out of step).
async function toggleArchived(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const [row] = await db.select({ archived: upfitLightTypes.archived }).from(upfitLightTypes).where(eq(upfitLightTypes.id, id));
  if (!row) return;
  await db.update(upfitLightTypes).set({ archived: !row.archived }).where(eq(upfitLightTypes.id, id));
  refresh();
}

async function deleteType(formData: FormData) {
  "use server";
  if (!canDelete(await auth())) return;
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await db.delete(upfitLightTypes).where(eq(upfitLightTypes.id, id));
  refresh();
}

const inputCls = "w-full bg-black/40 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white";

function Fields({
  row,
}: {
  row?: { label: string; dims: string | null; group: string; shape: string; size: string; sortOrder: number };
}) {
  return (
    <>
      <input name="label" defaultValue={row?.label ?? ""} required placeholder="Name, e.g. Liberty II" aria-label="Name" className={inputCls} />
      <input name="dims" defaultValue={row?.dims ?? ""} placeholder="e.g. 54 × 3.5 in" aria-label="Size shown in the picker" className={inputCls} />
      <select name="group" defaultValue={row?.group ?? "lights"} aria-label="Group" className={inputCls}>
        {LIGHT_GROUPS.map((g) => (
          <option key={g} value={g}>
            {GROUP_LABELS[g]}
          </option>
        ))}
      </select>
      <select name="shape" defaultValue={row?.shape ?? "rect"} aria-label="Shape" className={inputCls}>
        {LIGHT_SHAPES.map((s) => (
          <option key={s} value={s}>
            {SHAPE_LABELS[s]}
          </option>
        ))}
      </select>
      <select name="size" defaultValue={row?.size ?? "medium"} aria-label="Starting size" className={inputCls}>
        {PIN_SIZE_ORDER.map((k) => (
          <option key={k} value={k}>
            {PIN_SIZES[k].label}
          </option>
        ))}
      </select>
      <input name="sortOrder" type="number" defaultValue={row?.sortOrder ?? 0} aria-label="Order" className={inputCls} />
    </>
  );
}

export default async function LightTypesSettingsPage() {
  const session = await auth();
  const mayDelete = canDelete(session);
  let rows: (typeof upfitLightTypes.$inferSelect)[] = [];
  let missingTable = false;
  try {
    rows = await db
      .select()
      .from(upfitLightTypes)
      .orderBy(asc(upfitLightTypes.archived), asc(upfitLightTypes.sortOrder), asc(upfitLightTypes.label));
  } catch (err) {
    console.error("upfit_light_types unavailable", err);
    missingTable = true;
  }

  const grid = "grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1fr_1fr_1fr_80px_auto] gap-2 items-center";

  return (
    <AppShell title="Light types" subtitle="The configurator's “Choose a light type” list">
      <div className="space-y-5 max-w-6xl">
        <p className="text-sm text-zinc-400 max-w-3xl">
          These are the names sales picks from in the Vehicle Configurator. Use product-family names (no part numbers — the
          diagram is visual only). <strong className="text-zinc-200">Shape</strong> and{" "}
          <strong className="text-zinc-200">starting size</strong> are what a new light looks like on the diagram; sales can
          still change both after placing it. Lower <strong className="text-zinc-200">order</strong> numbers show first.
          Hiding a type removes it from the picker; lights already on diagrams keep their name.
        </p>

        {missingTable ? (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 text-sm text-amber-200">
            This list needs a one-time database update. Run <code>docs/sql/upfit_light_types.sql</code> in Neon&apos;s SQL
            Editor — it creates the table and copies in the current light types. Until then the configurator uses the
            built-in list.
          </div>
        ) : (
          <>
            <section className="bg-surface border border-white/10 rounded-2xl p-5 space-y-3">
              <h2 className="label-caps !text-white">Add a light type</h2>
              <form action={addType} className={grid}>
                <Fields />
                <SubmitButton className="btn-cta btn-sm">+ Add</SubmitButton>
              </form>
            </section>

            <section className="bg-surface border border-white/10 rounded-2xl p-5 space-y-2">
              <div className={`${grid} label-caps hidden md:grid`}>
                <span>Name</span>
                <span>Size shown</span>
                <span>Group</span>
                <span>Shape</span>
                <span>Starting size</span>
                <span>Order</span>
                <span />
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-zinc-400">
                  No light types yet — the configurator is using the built-in list. Add one above, or re-run the SQL file to
                  copy the built-in list in.
                </p>
              ) : null}
              {rows.map((r) => (
                <div
                  key={r.id}
                  className={`border-t border-white/10 pt-2 ${r.archived ? "opacity-60" : ""}`}
                >
                  <form action={updateType} className={grid}>
                    <input type="hidden" name="id" value={r.id} />
                    <Fields row={r} />
                    <div className="flex flex-wrap items-center gap-1.5 justify-end">
                      <SubmitButton className="btn-outline btn-sm">Save</SubmitButton>
                      <button
                        formAction={toggleArchived}
                        className="btn-outline btn-sm"
                        title={r.archived ? "Show it in the picker again" : "Remove it from the picker"}
                      >
                        {r.archived ? "Show" : "Hide"}
                      </button>
                      {mayDelete ? (
                        <button
                          formAction={deleteType}
                          className="text-zinc-500 hover:text-red-400 text-lg leading-none px-1"
                          aria-label={`Delete ${r.label}`}
                          title="Delete (managers). Lights already placed keep their name."
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </form>
                  {r.archived ? <p className="text-xs text-zinc-500 mt-1">Hidden from the picker.</p> : null}
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
