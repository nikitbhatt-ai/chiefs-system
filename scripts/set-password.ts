/**
 * Reset an existing user's password.
 *
 * Usage:
 *   npm run user:set-password -- --email you@chiefspursuitsurplus.com
 */

import "dotenv/config";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { db } from "../src/db";
import { users } from "../src/db/schema";

function arg(name: string): string | undefined {
  const flag = `--${name}`;
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function promptHidden(rl: readline.Interface, q: string) {
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
        if (ch === "") process.exit(130);
        if (ch === "") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function main() {
  const email = (arg("email") ?? "").toLowerCase().trim();
  if (!email) {
    console.error("Missing --email");
    process.exit(1);
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!existing) {
    console.error(`No user with email ${email}.`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input, output });
  const password = await promptHidden(rl, "New password: ");
  if (!password || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }
  rl.close();

  const passwordHash = await bcrypt.hash(password, 12);
  await db
    .update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, existing.id));

  console.log(`Password updated for ${email}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
