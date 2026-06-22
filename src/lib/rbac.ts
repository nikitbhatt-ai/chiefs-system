// Centralized role-based access control for API routes.
//
// Authentication ("are you signed in") was already enforced everywhere via
// auth(). This module adds authorization ("are you allowed to do this") so a
// low-privilege account (warehouse/tech) can't delete customers, rewrite
// financial records, or self-authorize a stage-gate override. Policy lives
// here in one place rather than being re-decided per route.

import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { userRole } from "@/db/schema";
import { timingSafeEqual } from "node:crypto";

export type Role = (typeof userRole.enumValues)[number];

export const MANAGER_ROLES: readonly Role[] = ["admin", "manager"];

export function roleOf(session: Session | null | undefined): Role | null {
  return (session?.user?.role as Role | undefined) ?? null;
}

export function hasRole(session: Session | null | undefined, roles: readonly Role[]): boolean {
  const r = roleOf(session);
  return !!r && roles.includes(r);
}

// Route guard. Returns a NextResponse to short-circuit the handler when the
// caller is unauthenticated (401) or lacks one of the allowed roles (403);
// returns null when the caller is permitted to proceed.
export function requireRole(
  session: Session | null | undefined,
  roles: readonly Role[],
): NextResponse | null {
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasRole(session, roles)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

// Capability shortcuts — destructive and privileged actions are manager+.
export const canDelete = (s: Session | null | undefined) => hasRole(s, MANAGER_ROLES);
export const canManageUsers = (s: Session | null | undefined) => hasRole(s, ["admin"]);
export const canOverrideStageGate = (s: Session | null | undefined) => hasRole(s, MANAGER_ROLES);

// Constant-time shared-secret comparison for webhook / cron endpoints.
// Plain `===` short-circuits on the first differing byte and leaks timing
// information about the secret; this compares full fixed-length buffers.
export function secretEquals(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!expected) return false; // fail closed when the secret isn't configured
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
