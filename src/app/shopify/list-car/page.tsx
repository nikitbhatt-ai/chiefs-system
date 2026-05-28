import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppShell } from "@/components/AppShell";
import { createCarListing } from "../../../../vinToShopify/index.js";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = ["admin", "manager"] as const;

const CONDITIONS = [
  "Used - Excellent",
  "Used - Good",
  "Used - Fair",
  "New",
];

type SP = {
  status?: string;
  stage?: string;
  error?: string;
  productId?: string;
  title?: string;
  adminUrl?: string;
  storefrontUrl?: string;
};

async function listCarAction(formData: FormData) {
  "use server";
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!ALLOWED_ROLES.includes(session.user.role as (typeof ALLOWED_ROLES)[number])) {
    redirect("/shopify/list-car?status=error&stage=input&error=" +
      encodeURIComponent("You don't have permission to list cars."));
  }

  const str = (k: string) => String(formData.get(k) ?? "").trim();
  const num = (k: string) => {
    const v = str(k);
    return v === "" ? undefined : Number(v);
  };

  const vin = str("vin").toUpperCase();
  const priceRaw = str("price");
  const photoUrls = str("photoUrls")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!vin || !priceRaw) {
    redirect(
      "/shopify/list-car?status=error&stage=input&error=" +
        encodeURIComponent("VIN and price are required.")
    );
  }

  const result = await createCarListing({
    vin,
    price: Number(priceRaw),
    condition: str("condition") || undefined,
    mileage: num("mileage"),
    photoUrls: photoUrls.length ? photoUrls : undefined,
    notes: str("notes") || undefined,
    status: (str("status") || "draft") as "draft" | "active",
  });

  if (result.status === "success") {
    const params = new URLSearchParams({
      status: "success",
      productId: String(result.productId),
      title: result.title,
      adminUrl: result.adminUrl,
    });
    if (result.storefrontUrl) params.set("storefrontUrl", result.storefrontUrl);
    redirect(`/shopify/list-car?${params.toString()}`);
  } else {
    const params = new URLSearchParams({
      status: "error",
      stage: result.stage,
      error: result.error,
    });
    redirect(`/shopify/list-car?${params.toString()}`);
  }
}

export default async function ListCarPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/signin");

  const role = session.user.role;
  const allowed = ALLOWED_ROLES.includes(role as (typeof ALLOWED_ROLES)[number]);

  const sp = await searchParams;

  return (
    <AppShell
      title="List car on Shopify"
      subtitle="Decode a VIN via NHTSA and publish a Shopify product."
    >
      {!allowed ? (
        <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">
          You don't have permission to list cars. Admin or manager role
          required.
        </div>
      ) : (
        <div className="space-y-4">
          {sp.status === "success" && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 text-sm space-y-1">
              <div className="text-green-300 font-medium">
                Listing created — {sp.title}
              </div>
              <div className="text-zinc-300">
                Product ID: <code className="text-zinc-100">{sp.productId}</code>
              </div>
              <div className="flex gap-4 pt-1">
                {sp.adminUrl && (
                  <a
                    href={sp.adminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    Open in Shopify admin →
                  </a>
                )}
                {sp.storefrontUrl ? (
                  <a
                    href={sp.storefrontUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    View on storefront →
                  </a>
                ) : (
                  <span className="text-zinc-500">
                    Draft — not published yet
                  </span>
                )}
              </div>
            </div>
          )}

          {sp.status === "error" && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-sm">
              <div className="text-red-300 font-medium">
                Failed at the &ldquo;{sp.stage}&rdquo; stage
              </div>
              <div className="text-zinc-300 mt-1">{sp.error}</div>
            </div>
          )}

          <form
            action={listCarAction}
            className="bg-[#161624] border border-white/5 rounded-lg p-4 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="VIN" hint="17 characters, no I/O/Q." required>
                <input
                  name="vin"
                  required
                  maxLength={17}
                  minLength={17}
                  placeholder="1HGCM82633A004352"
                  className={inputCls}
                />
              </Field>

              <Field label="Price (USD)" required>
                <input
                  name="price"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  className={inputCls}
                />
              </Field>

              <Field label="Mileage">
                <input
                  name="mileage"
                  type="number"
                  min="0"
                  step="1"
                  className={inputCls}
                />
              </Field>

              <Field label="Condition">
                <select name="condition" defaultValue="" className={inputCls}>
                  <option value="">(none)</option>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Status">
                <select name="status" defaultValue="draft" className={inputCls}>
                  <option value="draft">Draft (not public)</option>
                  <option value="active">Active (live on storefront)</option>
                </select>
              </Field>
            </div>

            <Field label="Photo URLs" hint="One public URL per line.">
              <textarea
                name="photoUrls"
                rows={3}
                placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/photo-2.jpg"}
                className={inputCls}
              />
            </Field>

            <Field label="Notes" hint="Appended to the product description.">
              <textarea name="notes" rows={3} className={inputCls} />
            </Field>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium"
              >
                Create listing
              </button>
              <Link
                href="/shopify/list-car"
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Clear
              </Link>
              <span className="text-xs text-zinc-500 ml-auto">
                Requires <code>SHOPIFY_STORE_DOMAIN</code>,{" "}
                <code>SHOPIFY_CLIENT_ID</code>, and{" "}
                <code>SHOPIFY_CLIENT_SECRET</code> in the environment.
              </span>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}

const inputCls =
  "w-full bg-[#0f0f1a] border border-white/10 rounded px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wider text-zinc-400">
        {label}
        {required && <span className="text-red-400 ml-1">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}
