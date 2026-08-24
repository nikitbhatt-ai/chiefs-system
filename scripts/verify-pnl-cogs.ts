// Scratch verification for the restructured P&L and the balance sheet after COGS
// became its own account type. Read-only except for the entries it posts.
//
//   POSTGRES_URL=... npx tsx scripts/verify-pnl-cogs.ts
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { glAccounts } from "../src/db/schema";
import { postJournalEntry } from "../src/lib/accounting";
import { pnlSegment, balanceSheet } from "../src/lib/reports";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function acct(code: string) {
  const [a] = await db.select({ id: glAccounts.id }).from(glAccounts).where(eq(glAccounts.code, code));
  if (!a) throw new Error(`missing ${code}`);
  return a.id;
}

async function main() {
  const from = new Date("2030-01-01T00:00:00");
  const to = new Date("2030-12-31T23:59:59");
  const date = new Date("2030-06-15T12:00:00");

  // Revenue 100,000; parts COGS 40,000; direct labor 15,000; variance 500;
  // admin payroll 9,000; rent 3,000.
  const post = async (memo: string, lines: { code: string; dr?: number; cr?: number }[]) =>
    postJournalEntry({
      entryDate: date,
      memo,
      source: "manual",
      lines: await Promise.all(
        lines.map(async (l) => ({
          accountId: await acct(l.code),
          debitCents: l.dr ?? 0,
          creditCents: l.cr ?? 0,
        })),
      ),
    });

  await post("verify: sale", [{ code: "4000", cr: 10_000_000 }, { code: "1100", dr: 10_000_000 }]);
  await post("verify: parts cogs", [
    { code: "5120", dr: 2_500_000 },
    { code: "5110", dr: 1_500_000 },
    { code: "1300", cr: 4_000_000 },
  ]);
  await post("verify: direct labor", [{ code: "5300", dr: 1_500_000 }, { code: "1000", cr: 1_500_000 }]);
  await post("verify: price variance", [{ code: "5900", dr: 50_000 }, { code: "2000", cr: 50_000 }]);
  await post("verify: admin payroll", [{ code: "6010", dr: 900_000 }, { code: "1000", cr: 900_000 }]);
  await post("verify: rent", [{ code: "6100", dr: 300_000 }, { code: "1000", cr: 300_000 }]);

  const pl = await pnlSegment(from, to);
  console.log("\nP&L");
  console.log(`        revenue            ${(pl.revenueTotal / 100).toFixed(2)}`);
  console.log(`        cogs parts         ${(pl.cogsPartsTotal / 100).toFixed(2)}  (${pl.cogsParts.map((r) => r.code).join(",")})`);
  console.log(`        cogs labor         ${(pl.cogsLaborTotal / 100).toFixed(2)}  (${pl.cogsLabor.map((r) => r.code).join(",")})`);
  console.log(`        cogs other         ${(pl.cogsOtherTotal / 100).toFixed(2)}  (${pl.cogsOther.map((r) => r.code).join(",")})`);
  console.log(`        cogs total         ${(pl.cogsTotal / 100).toFixed(2)}`);
  console.log(`        GROSS PROFIT       ${(pl.grossProfitCents / 100).toFixed(2)}`);
  console.log(`        payroll (by dept)  ${(pl.laborTotal / 100).toFixed(2)}`);
  console.log(`        other operating    ${(pl.otherExpenseTotal / 100).toFixed(2)}`);
  console.log(`        operating total    ${(pl.operatingTotal / 100).toFixed(2)}`);
  console.log(`        NET INCOME         ${(pl.netCents / 100).toFixed(2)}`);

  check("parts COGS split across two accounts", pl.cogsParts.length === 2 && pl.cogsPartsTotal === 4_000_000);
  check("direct labor in its own COGS section", pl.cogsLaborTotal === 1_500_000);
  check("variance in COGS other, not parts", pl.cogsOtherTotal === 50_000 && !pl.cogsParts.some((r) => r.code === "5900"));
  check("COGS total = parts + labor + other", pl.cogsTotal === 4_000_000 + 1_500_000 + 50_000);
  check("gross profit = revenue − COGS", pl.grossProfitCents === 10_000_000 - pl.cogsTotal, `${pl.grossProfitCents}`);
  check("admin payroll is OPERATING, not COGS", pl.laborTotal === 900_000 && pl.cogsLaborTotal === 1_500_000);
  check("rent in other operating", pl.otherExpenseTotal === 300_000);
  check("operating total = payroll + other", pl.operatingTotal === 1_200_000);
  check("net = gross profit − operating", pl.netCents === pl.grossProfitCents - pl.operatingTotal, `${pl.netCents}`);
  check("no expense counted twice", pl.netCents === 10_000_000 - 5_550_000 - 1_200_000, `${pl.netCents}`);

  const bs = await balanceSheet(to);
  console.log("\nBalance sheet");
  console.log(`        assets             ${(bs.assetsTotal / 100).toFixed(2)}`);
  console.log(`        liabilities        ${(bs.liabilitiesTotal / 100).toFixed(2)}`);
  console.log(`        equity + earnings  ${(bs.equityTotal / 100).toFixed(2)}`);
  console.log(`        net income         ${(bs.netIncomeCents / 100).toFixed(2)}`);
  check("balance sheet balances with COGS as its own type", bs.balanced, `A ${bs.assetsTotal} vs L+E ${bs.liabilitiesAndEquityTotal}`);
  check("retained earnings include COGS", bs.netIncomeCents === pl.netCents, `${bs.netIncomeCents} vs ${pl.netCents}`);

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
