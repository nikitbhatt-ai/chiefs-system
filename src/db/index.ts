import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// postgres.js does not actually connect until a query runs, so it's safe to
// construct at module load with a placeholder during build. Real queries will
// fail loudly if POSTGRES_URL isn't set in the runtime environment.
const url = process.env.POSTGRES_URL ?? "postgres://placeholder@localhost:5432/placeholder";

const client = postgres(url, { prepare: false, max: 10 });

export const db = drizzle(client, { schema });
export { schema };
