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

// ---------------------------------------------------------------------------
// Lot / vehicle check-in flow
// ---------------------------------------------------------------------------
// The check-in brief describes four roles — admin, office, inventory, tech.
// Those are job descriptions, not rows in our database. `user_role` is the
// authority, so they map onto the roles that actually exist:
//
//   brief "office"     -> admin, manager, sales   (OFFICE_ROLES)
//   brief "inventory"  -> warehouse               (folded into LOT_ROLES)
//   brief "tech"       -> tech
//
// The split the brief cares about: ownership is a commercial classification,
// so it stays with office. Lot status is physical reality, so the inventory
// associate owns it.

// Office staff: CRM, deals, quotes, vehicle linking, ownership.
export const OFFICE_ROLES: readonly Role[] = ["admin", "manager", "sales"];

// Anyone who works the lot itself — office plus the inventory associate.
// These are the roles that may move a vehicle's physical state.
export const LOT_ROLES: readonly Role[] = ["admin", "manager", "sales", "warehouse"];

// Recording an arrival is deliberately open to every role. A vehicle that
// turns up and goes unrecorded is worse than one recorded by the "wrong"
// person: the arrival condition and photos cannot be reconstructed later.
const ALL_ROLES: readonly Role[] = userRole.enumValues;

// Every privileged action in the check-in flow, named once. Server actions ask
// for a capability rather than re-deciding which roles qualify, so the policy
// lives here and nowhere else.
export const LOT_CAPABILITIES = {
  // Create a check-in record for an arriving vehicle.
  "checkin:create": ALL_ROLES,
  // Amend the details of an existing check-in.
  "checkin:edit": LOT_ROLES,
  // Stamp a vehicle as departed.
  "checkin:depart": LOT_ROLES,
  // Move a vehicle between on_lot_available / on_lot_assigned / in_shop /
  // departed — physical presence only.
  "vehicle:setLotStatus": LOT_ROLES,
  // Classify a vehicle as chiefs / customer / sames. Commercial, so office+.
  "vehicle:setOwnership": OFFICE_ROLES,
  // Attach or detach a vehicle from a deal. Commercial, so office+.
  "vehicle:linkDeal": OFFICE_ROLES,
} as const satisfies Record<string, readonly Role[]>;

export type LotCapability = keyof typeof LOT_CAPABILITIES;

// Pure predicate, in the same shape as canDelete above. Use it to decide what
// to RENDER. It is never sufficient on its own — hiding a button does not stop
// anyone POSTing to the action behind it.
export function can(
  session: Session | null | undefined,
  capability: LotCapability,
): boolean {
  if (!session?.user) return false;
  return hasRole(session, LOT_CAPABILITIES[capability]);
}

// Thrown by requireCapability so callers can tell "not signed in" and "signed
// in but not allowed" apart from a genuine bug.
export class PermissionError extends Error {
  constructor(
    message: string,
    readonly capability: LotCapability,
    readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// THE server-side guard for this flow. Every server action starts with:
//
//   const session = await requireCapability("vehicle:setOwnership");
//
// It reads the session itself rather than taking one as an argument, so an
// action cannot be written that forgets to look. It throws instead of
// returning a falsy value, so a missed check fails loudly rather than
// silently writing. It returns the session because callers invariably need
// the user id next (checkedInBy, linkedBy, unlinkedBy).
export async function requireCapability(
  capability: LotCapability,
): Promise<Session> {
  // Imported lazily: @/auth pulls in the Drizzle adapter and the email
  // provider, and rbac.ts is imported by modules that only need the pure
  // predicates above.
  const { auth } = await import("@/auth");
  const session = await auth();

  if (!session?.user) {
    throw new PermissionError("You must be signed in.", capability, 401);
  }
  if (!can(session, capability)) {
    throw new PermissionError(
      `Your role (${roleOf(session) ?? "unknown"}) cannot perform this action.`,
      capability,
      403,
    );
  }
  return session;
}

// API-route flavour, mirroring requireRole above: returns a NextResponse to
// short-circuit the handler, or null when the caller may proceed.
export function requireCapabilityResponse(
  session: Session | null | undefined,
  capability: LotCapability,
): NextResponse | null {
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(session, capability)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return null;
}

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
