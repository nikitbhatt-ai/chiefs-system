// Scratch helper: report columns that src/db/schema.ts declares but a database is
// missing. Read-only. Used to patch a throwaway verification database whose
// drizzle/0000_initial.sql is behind schema.ts.
//
//   POSTGRES_URL=... npx tsx scripts/scratch-schema-drift.ts
import { sql } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "../src/db";

async function main() {
  const rows = (await db.execute(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  )) as unknown as { table_name: string; column_name: string }[];
  const have = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!have.has(r.table_name)) have.set(r.table_name, new Set());
    have.get(r.table_name)!.add(r.column_name);
  }

  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    const existing = have.get(cfg.name);
    if (!existing) {
      console.log(`MISSING TABLE  ${cfg.name}`);
      continue;
    }
    for (const col of cfg.columns) {
      if (!existing.has(col.name)) {
        const type = col.getSQLType();
        const nn = col.notNull && col.hasDefault ? " NOT NULL" : "";
        const def = col.hasDefault && col.default !== undefined ? ` DEFAULT ${JSON.stringify(col.default)}` : "";
        console.log(`ALTER TABLE ${cfg.name} ADD COLUMN IF NOT EXISTS ${col.name} ${type}${def}${nn};`);
      }
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
