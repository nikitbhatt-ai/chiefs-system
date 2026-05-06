/**
 * Create or update a user with email + password + role.
 *
 * Usage:
 *   npm run user:create -- --email you@chiefspursuitsurplus.com --role admin
 *
 * Prompts for the password. POSTGRES_URL must be set (run `vercel env pull
 * .env.local` first; tsx auto-loads .env files via NEXT_LOAD_ENV below).
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { db } from "../src/db";
import { users, type userRole } from "../src/db/schema";

type Role = (typeof userRole.enumValues)[number];

const VALID_ROLES = [
  "admin",
  "manager",
  "sales",
  "warehouse",
  "tech",
  "accountant",
] as const satisfies readonly Role[];

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function prompt(rl: readline.Interface, q: string, hidden = false) {
  if (!hidden) return rl.question(q);
  // Hide echo for password input.
  output.write(q);
  return new Promise<string>((resolve) => {
    let buf = "";
    const onData = (data: Buffer) => {
      const s = data.toString("utf8");
      for (const ch of s) {
        if (ch === "\n" || ch === "\r") {
          input.off("data", onData);
          input.setRawMode(false);
          input.pause();
          output.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "") {
          process.exit(130);
        }
        if (ch === "") {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  const email = (arg("email") ?? "").toLowerCase().trim();
  const role = (arg("role") ?? "admin") as Role;
  const displayName = arg("name");

  if (!email) {
    console.error("Missing --email");
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid --role. Must be one of: ${VALID_ROLES.join(", ")}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  const password = await prompt(rl, "Password: ", true);
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  rl.close();

  const passwordHash = await bcrypt.hash(password, 12);

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    await db
      .update(users)
      .set({
        passwordHash,
        role,
        active: true,
        ...(displayName ? { displayName, name: displayName } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    console.log(`Updated user ${email} (role=${role}, active=true).`);
  } else {
    await db.insert(users).values({
      email,
      passwordHash,
      role,
      active: true,
      name: displayName,
      displayName,
    });
    console.log(`Created user ${email} (role=${role}, active=true).`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
