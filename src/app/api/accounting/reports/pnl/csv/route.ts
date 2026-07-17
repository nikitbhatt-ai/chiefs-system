import { auth } from "@/auth";
import { requireRole } from "@/lib/rbac";
import { centsToDollars } from "@/lib/accounting";
import { profitAndLoss } from "@/lib/reports";

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const session = await auth();
  const denied = requireRole(session, ["admin"]);
  if (denied) return denied;

  const url = new URL(req.url);
  const today = new Date();
  const from = url.searchParams.get("from") ? new Date(`${url.searchParams.get("from")}T00:00:00`) : new Date(`${today.getFullYear()}-01-01T00:00:00`);
  const to = url.searchParams.get("to") ? new Date(`${url.searchParams.get("to")}T23:59:59`) : today;

  const pl = await profitAndLoss(from, to);
  const rows: (string | number)[][] = [["Section", "Account", "This period", "Prior period"]];

  const priorRev = new Map(pl.prior.revenue.map((r) => [r.code, r.amountCents]));
  const priorOther = new Map(pl.prior.otherExpense.map((r) => [r.code, r.amountCents]));
  const priorLabor = new Map(pl.prior.laborByDept.map((r) => [r.departmentName, r.amountCents]));

  for (const r of pl.current.revenue) rows.push(["Revenue", `${r.code} ${r.name}`, centsToDollars(r.amountCents), centsToDollars(priorRev.get(r.code) ?? 0)]);
  rows.push(["Revenue", "Total revenue", centsToDollars(pl.current.revenueTotal), centsToDollars(pl.prior.revenueTotal)]);
  for (const r of pl.current.laborByDept) rows.push(["Labor", r.departmentName, centsToDollars(r.amountCents), centsToDollars(priorLabor.get(r.departmentName) ?? 0)]);
  rows.push(["Labor", "Total labor", centsToDollars(pl.current.laborTotal), centsToDollars(pl.prior.laborTotal)]);
  for (const r of pl.current.otherExpense) rows.push(["Other expenses", `${r.code} ${r.name}`, centsToDollars(r.amountCents), centsToDollars(priorOther.get(r.code) ?? 0)]);
  rows.push(["Other expenses", "Total other expenses", centsToDollars(pl.current.otherExpenseTotal), centsToDollars(pl.prior.otherExpenseTotal)]);
  rows.push(["Net", "Net income", centsToDollars(pl.current.netCents), centsToDollars(pl.prior.netCents)]);

  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const fname = `pnl_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fname}"`,
    },
  });
}
