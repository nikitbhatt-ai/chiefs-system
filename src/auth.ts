import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import Nodemailer from "next-auth/providers/nodemailer";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { z } from "zod";
import {
  authConfig,
  emailMagicLinkEnabled,
  microsoftEnabled,
} from "@/auth.config";
import { db } from "@/db";
import {
  users,
  accounts,
  sessions,
  verificationTokens,
  type userRole,
} from "@/db/schema";

type Role = (typeof userRole.enumValues)[number];

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      active: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: Role;
    active?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: Role;
    active?: boolean;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const credentialsProvider = Credentials({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Password", type: "password" },
  },
  async authorize(raw) {
    const parsed = credentialsSchema.safeParse(raw);
    if (!parsed.success) return null;
    const email = parsed.data.email.toLowerCase();

    const [row] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        displayName: users.displayName,
        passwordHash: users.passwordHash,
        role: users.role,
        active: users.active,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!row) return null;
    if (!row.active) return null;
    if (!row.passwordHash) return null;

    const ok = await bcrypt.compare(parsed.data.password, row.passwordHash);
    if (!ok) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.displayName ?? row.name ?? row.email,
      role: row.role,
      active: row.active,
    };
  },
});

const fullProviders: NextAuthConfig["providers"] = [credentialsProvider];

if (microsoftEnabled) {
  fullProviders.push(
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  );
}

if (emailMagicLinkEnabled) {
  fullProviders.push(
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
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: fullProviders,
  callbacks: {
    ...authConfig.callbacks,
    async signIn({ user, account }) {
      if (!user.email) return false;
      // Credentials provider already gated in authorize(); accept directly.
      if (account?.provider === "credentials") return true;
      // OAuth + magic link: require a pre-provisioned, active user row.
      const [existing] = await db
        .select({ active: users.active })
        .from(users)
        .where(eq(users.email, user.email.toLowerCase()))
        .limit(1);
      if (!existing) return false;
      if (!existing.active) return false;
      return true;
    },
    async jwt({ token, user }) {
      // On sign-in, hydrate the JWT with id + role + active.
      if (user) {
        token.id = user.id;
        if (user.role) token.role = user.role;
        if (typeof user.active === "boolean") token.active = user.active;
      }
      // Re-fetch role/active on every refresh so admin changes take effect.
      if (token.email && (!token.role || token.active === undefined)) {
        const [row] = await db
          .select({ id: users.id, role: users.role, active: users.active })
          .from(users)
          .where(eq(users.email, String(token.email).toLowerCase()))
          .limit(1);
        if (row) {
          token.id = row.id;
          token.role = row.role;
          token.active = row.active;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id ?? "";
        session.user.role = (token.role ?? "sales") as Role;
        session.user.active = token.active ?? false;
      }
      return session;
    },
  },
});
