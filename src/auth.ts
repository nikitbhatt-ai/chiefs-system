import NextAuth, { type DefaultSession } from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { authConfig } from "@/auth.config";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "admin" | "manager" | "sales" | "warehouse" | "tech" | "accountant";
      active: boolean;
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: [
    ...authConfig.providers,
    Nodemailer({
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT ?? 587),
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user }) {
      if (!user.email) return false;
      const [existing] = await db
        .select({ active: users.active })
        .from(users)
        .where(eq(users.email, user.email.toLowerCase()))
        .limit(1);
      // Reject anyone not pre-provisioned by an admin.
      if (!existing) return false;
      if (!existing.active) return false;
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        const [row] = await db
          .select({ role: users.role, active: users.active })
          .from(users)
          .where(eq(users.id, user.id))
          .limit(1);
        session.user.id = user.id;
        session.user.role = row?.role ?? "sales";
        session.user.active = row?.active ?? false;
      }
      return session;
    },
  },
});
