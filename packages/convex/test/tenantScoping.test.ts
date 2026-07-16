/**
 * Tests for `supaTenantScope` (schema/tenantScoping.ts) against a minimal
 * in-memory mock of the Convex `db` interface it depends on — no real Convex
 * deployment needed, since the module only calls `db.get` / `db.query(...).
 * withIndex(...).collect()/.unique()`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { supaTenantScope } from "../src/schema/tenantScoping";

type Row = Record<string, any>;

/** Minimal fake of the Convex query builder this module actually calls. */
function makeDb(tables: Record<string, Row[]>) {
  return {
    async get(id: string) {
      for (const rows of Object.values(tables)) {
        const found = rows.find((r) => r._id === id);
        if (found) return found;
      }
      return null;
    },
    query(table: string) {
      const rows = tables[table] ?? [];
      let filtered = rows;
      return {
        withIndex(_name: string, builder: (q: any) => any) {
          const predicate = builder(new FakeIndexQuery());
          filtered = rows.filter((r) => predicate.matches(r));
          return this;
        },
        async collect() {
          return filtered;
        },
        async unique() {
          if (filtered.length > 1) throw new Error("unique(): multiple matches");
          return filtered[0] ?? null;
        },
      };
    },
  };
}

/** Records `.eq(field, value)` calls so `withIndex` can build a predicate. */
class FakeIndexQuery {
  private conditions: Array<[string, unknown]> = [];
  eq(field: string, value: unknown) {
    this.conditions.push([field, value]);
    return this;
  }
  matches(row: Row): boolean {
    return this.conditions.every(([field, value]) => row[field] === value);
  }
}

const scope = supaTenantScope({ tenantName: "organization" });

test("supaTenantScope: derives field/table names from tenantName", () => {
  assert.equal(scope.tenantIdField, "organizationId");
  assert.equal(scope.activeTenantField, "activeOrganizationId");
  assert.equal(scope.junctionTableName, "userOrganizations");
});

// ---------------------------------------------------------------------------
// rowInTenant
// ---------------------------------------------------------------------------

test("rowInTenant: matches a row stamped with the active tenant", () => {
  assert.equal(scope.rowInTenant({ organizationId: "org_1" }, "org_1"), true);
});

test("rowInTenant: rejects a row from a different tenant", () => {
  assert.equal(scope.rowInTenant({ organizationId: "org_2" }, "org_1"), false);
});

test("rowInTenant: a null active tenant degrades to unfiltered (migration safety net)", () => {
  assert.equal(scope.rowInTenant({ organizationId: "org_2" }, null), true);
});

// ---------------------------------------------------------------------------
// getCurrentTenantId
// ---------------------------------------------------------------------------

test("getCurrentTenantId: prefers the user's explicit active tenant field", async () => {
  const db = makeDb({
    users: [{ _id: "user_1", activeOrganizationId: "org_1" }],
    userOrganizations: [],
  });
  const tenantId = await scope.getCurrentTenantId({ db }, "user_1");
  assert.equal(tenantId, "org_1");
});

test("getCurrentTenantId: falls back to a sole active membership", async () => {
  const db = makeDb({
    users: [{ _id: "user_1" }],
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: true },
    ],
  });
  const tenantId = await scope.getCurrentTenantId({ db }, "user_1");
  assert.equal(tenantId, "org_1");
});

test("getCurrentTenantId: returns null when ambiguous (2+ active memberships)", async () => {
  const db = makeDb({
    users: [{ _id: "user_1" }],
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: true },
      { userId: "user_1", organizationId: "org_2", isActive: true },
    ],
  });
  const tenantId = await scope.getCurrentTenantId({ db }, "user_1");
  assert.equal(tenantId, null);
});

test("getCurrentTenantId: returns null with zero memberships", async () => {
  const db = makeDb({ users: [{ _id: "user_1" }], userOrganizations: [] });
  const tenantId = await scope.getCurrentTenantId({ db }, "user_1");
  assert.equal(tenantId, null);
});

test("getCurrentTenantId: returns null for an unknown user", async () => {
  const db = makeDb({ users: [], userOrganizations: [] });
  const tenantId = await scope.getCurrentTenantId({ db }, "ghost");
  assert.equal(tenantId, null);
});

// ---------------------------------------------------------------------------
// isMemberOfTenant / requireTenantId
// ---------------------------------------------------------------------------

test("isMemberOfTenant: true for an active membership row", async () => {
  const db = makeDb({
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: true },
    ],
  });
  assert.equal(await scope.isMemberOfTenant({ db }, "user_1", "org_1"), true);
});

test("isMemberOfTenant: false when the membership is inactive", async () => {
  const db = makeDb({
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: false },
    ],
  });
  assert.equal(await scope.isMemberOfTenant({ db }, "user_1", "org_1"), false);
});

test("isMemberOfTenant: false when there is no membership row at all", async () => {
  const db = makeDb({ userOrganizations: [] });
  assert.equal(await scope.isMemberOfTenant({ db }, "user_1", "org_1"), false);
});

test("requireTenantId: resolves the id when the user has an active tenant + membership", async () => {
  const db = makeDb({
    users: [{ _id: "user_1", activeOrganizationId: "org_1" }],
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: true },
    ],
  });
  const tenantId = await scope.requireTenantId({ db }, "user_1");
  assert.equal(tenantId, "org_1");
});

test("requireTenantId: throws NO_ACTIVE_TENANT when no tenant is resolvable", async () => {
  const db = makeDb({ users: [{ _id: "user_1" }], userOrganizations: [] });
  await assert.rejects(
    () => scope.requireTenantId({ db }, "user_1"),
    (err: any) => err.data?.code === "NO_ACTIVE_TENANT",
  );
});

test("requireTenantId: throws FORBIDDEN when the active tenant has no active membership row", async () => {
  const db = makeDb({
    users: [{ _id: "user_1", activeOrganizationId: "org_1" }],
    userOrganizations: [],
  });
  await assert.rejects(
    () => scope.requireTenantId({ db }, "user_1"),
    (err: any) => err.data?.code === "FORBIDDEN",
  );
});

// ---------------------------------------------------------------------------
// activeTenantMemberIds
// ---------------------------------------------------------------------------

test("activeTenantMemberIds: returns the set of active member user ids for the tenant", async () => {
  const db = makeDb({
    userOrganizations: [
      { userId: "user_1", organizationId: "org_1", isActive: true },
      { userId: "user_2", organizationId: "org_1", isActive: true },
      { userId: "user_3", organizationId: "org_1", isActive: false },
      { userId: "user_4", organizationId: "org_2", isActive: true },
    ],
  });
  const ids = await scope.activeTenantMemberIds({ db }, "org_1");
  assert.deepEqual([...ids].sort(), ["user_1", "user_2"]);
});
