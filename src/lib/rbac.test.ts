// Unit tests for the lot / check-in permission matrix. No test framework is
// configured in this repo, so this runs standalone under tsx:
//
//   npx tsx src/lib/rbac.test.ts
//
// It asserts the full role × capability grid and exits non-zero on any failure.
// The grid is written out longhand on purpose: if someone widens a capability,
// the diff should show exactly which role gained what.

import assert from "node:assert/strict";
import type { Session } from "next-auth";
import { can, hasRole, LOT_CAPABILITIES, OFFICE_ROLES, LOT_ROLES, type Role, type LotCapability } from "./rbac";
import { userRole } from "@/db/schema";

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function sessionFor(role: Role): Session {
  return {
    user: { id: "u1", role, active: true },
    expires: new Date(Date.now() + 86_400_000).toISOString(),
  } as Session;
}

// The permission matrix, mapped onto the roles that actually exist in the
// database (`user_role`), not the brief's job-description names.
//   brief "office"    -> admin, manager, sales
//   brief "inventory" -> warehouse
const EXPECTED: Record<LotCapability, Record<Role, boolean>> = {
  "checkin:create": {
    admin: true, manager: true, sales: true, warehouse: true, tech: true, accountant: true,
  },
  "checkin:edit": {
    admin: true, manager: true, sales: true, warehouse: true, tech: false, accountant: false,
  },
  "checkin:depart": {
    admin: true, manager: true, sales: true, warehouse: true, tech: false, accountant: false,
  },
  "vehicle:setLotStatus": {
    admin: true, manager: true, sales: true, warehouse: true, tech: false, accountant: false,
  },
  "vehicle:setOwnership": {
    admin: true, manager: true, sales: true, warehouse: false, tech: false, accountant: false,
  },
  "vehicle:linkDeal": {
    admin: true, manager: true, sales: true, warehouse: false, tech: false, accountant: false,
  },
};

console.log("rbac — lot capability matrix");

test("the roles in the matrix are exactly the roles in the database", () => {
  const dbRoles = [...userRole.enumValues].sort();
  for (const cap of Object.keys(EXPECTED) as LotCapability[]) {
    assert.deepEqual(
      Object.keys(EXPECTED[cap]).sort(),
      dbRoles,
      `capability ${cap} does not cover every user_role value`,
    );
  }
});

test("every declared capability is covered by the test matrix", () => {
  assert.deepEqual(
    Object.keys(LOT_CAPABILITIES).sort(),
    Object.keys(EXPECTED).sort(),
    "LOT_CAPABILITIES and the test matrix have drifted apart",
  );
});

for (const cap of Object.keys(EXPECTED) as LotCapability[]) {
  test(`${cap} — grants exactly the expected roles`, () => {
    for (const role of userRole.enumValues) {
      assert.equal(
        can(sessionFor(role), cap),
        EXPECTED[cap][role],
        `${role} should ${EXPECTED[cap][role] ? "" : "NOT "}have ${cap}`,
      );
    }
  });
}

test("an unauthenticated caller has no capability at all", () => {
  for (const cap of Object.keys(LOT_CAPABILITIES) as LotCapability[]) {
    assert.equal(can(null, cap), false, `null session got ${cap}`);
    assert.equal(can(undefined, cap), false, `undefined session got ${cap}`);
    assert.equal(can({ expires: "" } as Session, cap), false, `session with no user got ${cap}`);
  }
});

test("a session carrying an unknown role is denied everything", () => {
  const rogue = { user: { id: "u1", role: "superuser", active: true }, expires: "" } as unknown as Session;
  for (const cap of Object.keys(LOT_CAPABILITIES) as LotCapability[]) {
    assert.equal(can(rogue, cap), false, `unknown role got ${cap}`);
  }
});

test("ownership is strictly narrower than lot status — the brief's core split", () => {
  // Commercial classification stays with office; physical reality belongs to
  // the inventory associate. warehouse is the role that proves they differ.
  assert.equal(can(sessionFor("warehouse"), "vehicle:setLotStatus"), true);
  assert.equal(can(sessionFor("warehouse"), "vehicle:setOwnership"), false);
  for (const r of OFFICE_ROLES) {
    assert.ok(LOT_ROLES.includes(r), `office role ${r} must also be a lot role`);
  }
});

test("tech is read-only on vehicles but can still record an arrival", () => {
  assert.equal(can(sessionFor("tech"), "checkin:create"), true);
  assert.equal(can(sessionFor("tech"), "checkin:edit"), false);
  assert.equal(can(sessionFor("tech"), "vehicle:setLotStatus"), false);
  assert.equal(can(sessionFor("tech"), "vehicle:linkDeal"), false);
});

test("the pre-existing hasRole helper still behaves", () => {
  assert.equal(hasRole(sessionFor("admin"), ["admin"]), true);
  assert.equal(hasRole(sessionFor("sales"), ["admin"]), false);
  assert.equal(hasRole(null, ["admin"]), false);
});

console.log(`\n${passed} test(s) passed.`);
