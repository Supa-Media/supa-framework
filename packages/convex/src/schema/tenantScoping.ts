/**
 * Tenant Scoping Discipline
 *
 * Query-time complement to `supaTenantTables` (`./tenantTables`). Where
 * `supaTenantTables` defines the tenant + junction tables, `supaTenantScope`
 * generalizes the read-enforcement discipline Fount Studios built on top of
 * its (hardcoded, `organizationId`-specific) equivalent —
 * `apps/convex/lib/org.ts` (`rowInOrg`, `activeOrgMemberIds`,
 * `resolveActiveOrg`/`getCurrentOrg`/`requireOrg`) — parameterized by
 * `tenantName` instead of a fixed field name, so it derives the exact same
 * `{tenantName}Id` / `user{TenantName}s` identifiers `supaTenantTables` uses.
 *
 * Fount's pattern in one line: resolve the active tenant ONCE at the top of a
 * handler, then filter every collected row with a cheap in-memory check — a
 * null active tenant degrades to unfiltered reads (migration/pre-backfill
 * safety net) rather than an error.
 *
 * Usage:
 * ```ts
 * // convex/schema.ts
 * import { defineSchema } from "convex/server";
 * import { supaAuthTables, supaTenantTables } from "@supa-media/convex/schema";
 *
 * const tenantName = "organization";
 * export default defineSchema({
 *   ...supaAuthTables,
 *   ...supaTenantTables({ tenantName }),
 * });
 *
 * // convex/lib/tenant.ts
 * import { supaTenantScope } from "@supa-media/convex/schema";
 * export const orgScope = supaTenantScope({ tenantName: "organization" });
 *
 * // convex/functions/bookings.ts
 * import { requireAuthId } from "@supa-media/convex/auth";
 * import { orgScope } from "../lib/tenant";
 *
 * export const list = query({
 *   handler: async (ctx) => {
 *     const userId = await requireAuthId(ctx);
 *     const orgId = await orgScope.getCurrentTenantId(ctx, userId);
 *     return (await ctx.db.query("bookings").collect())
 *       .filter((row) => orgScope.rowInTenant(row, orgId));
 *   },
 * });
 * ```
 *
 * Deviations from Fount's `lib/org.ts` (intentional, for genericity — see
 * `packages/convex` PR description for the full callout):
 *  - No Super Admin cross-tenant bypass. Fount's `requireOrg`/`requireMembership`
 *    let a global "Super Admin" role skip the membership check; that assumes an
 *    app-specific roles/permissions system this package doesn't ship. A
 *    consumer that needs a bypass wraps `requireTenantId` with its own check.
 *  - Auth resolution is decoupled. Fount's `requireOrg` calls `requireAuth`
 *    internally; here the caller resolves `userId` itself (e.g. via
 *    `requireAuthId` from `@supa-media/convex/auth`) and passes it in, so this
 *    module has no dependency on the auth module.
 */

import { ConvexError } from "convex/values";

/** Config shared with `supaTenantTables` — must use the same `tenantName`. */
export interface TenantScopeConfig {
  /** Name for the tenant entity (e.g. "organization", "workspace", "community"). Must match the `tenantName` passed to `supaTenantTables`. */
  tenantName: string;
}

/** Minimal DB context — works with Convex `QueryCtx` and `MutationCtx` without importing generated types. */
interface TenantScopeCtx {
  db: {
    get: (id: any) => Promise<any>;
    query: (table: string) => any;
  };
}

/** A row carrying a `{tenantName}Id` field, of unknown shape otherwise. */
type TenantScopedRow = Record<string, any>;

export interface SupaTenantScope {
  /** The tenant id field name on scoped rows/documents, e.g. "organizationId". */
  tenantIdField: string;
  /** The field on `users` storing the user's active tenant, e.g. "activeOrganizationId". Not added by `supaAuthTables` — the consumer owns this field on their `users` table. */
  activeTenantField: string;
  /** The junction table name from `supaTenantTables`, e.g. "userOrganizations". */
  junctionTableName: string;

  /**
   * Whether an org-stamped row belongs to the given tenant. A `null` tenantId
   * (unresolvable — e.g. mid-migration, before backfill) degrades to
   * unfiltered reads so the app keeps working; once a tenant is active, only
   * its rows pass. Mirrors fount's `rowInOrg`.
   */
  rowInTenant(row: TenantScopedRow, tenantId: string | null): boolean;

  /**
   * Resolve the active tenant for a user id, or `null` if unresolvable.
   * Prefers `users.{activeTenantField}`; if unset, falls back to the user's
   * sole active membership row (a single-tenant user never needs an explicit
   * switch). Returns `null` when ambiguous (0 or 2+ active memberships) —
   * mirrors fount's `resolveActiveOrg`/`getCurrentOrg`.
   */
  getCurrentTenantId(
    ctx: TenantScopeCtx,
    userId: string,
  ): Promise<string | null>;

  /**
   * Whether a user has an active membership row for the given tenant, via
   * the junction table's `by_userId_{tenantIdField}` compound index.
   */
  isMemberOfTenant(
    ctx: TenantScopeCtx,
    userId: string,
    tenantId: string,
  ): Promise<boolean>;

  /**
   * Require a resolvable active tenant AND an active membership in it.
   * Throws `ConvexError({ code: "NO_ACTIVE_TENANT" })` if no tenant is
   * resolvable, `ConvexError({ code: "FORBIDDEN" })` if the user has no active
   * membership in it. Mirrors fount's `requireOrg` (minus the Super Admin
   * bypass — see module-level deviation note).
   */
  requireTenantId(ctx: TenantScopeCtx, userId: string): Promise<string>;

  /**
   * The set of user ids with an active membership in the tenant, for scoping
   * queries over tables that have no `{tenantName}Id` column of their own
   * (e.g. `users` — tenant membership lives in the junction table). Mirrors
   * fount's `activeOrgMemberIds`.
   */
  activeTenantMemberIds(
    ctx: TenantScopeCtx,
    tenantId: string,
  ): Promise<Set<string>>;
}

/**
 * Build the tenant-scoping helpers for a given `tenantName`. The returned
 * functions derive the same `{tenantName}Id` / `user{TenantName}s` identifiers
 * `supaTenantTables` uses, so the two stay in lockstep as long as both are
 * configured with the same `tenantName`.
 */
export function supaTenantScope(config: TenantScopeConfig): SupaTenantScope {
  const { tenantName } = config;
  const capitalName =
    tenantName.charAt(0).toUpperCase() + tenantName.slice(1);
  const tenantIdField = `${tenantName}Id`;
  const activeTenantField = `active${capitalName}Id`;
  const junctionTableName = `user${capitalName}s`;

  function rowInTenant(row: TenantScopedRow, tenantId: string | null): boolean {
    return tenantId === null || row[tenantIdField] === tenantId;
  }

  async function findMembership(
    ctx: TenantScopeCtx,
    userId: string,
    tenantId: string,
  ): Promise<TenantScopedRow | null> {
    return await ctx.db
      .query(junctionTableName)
      .withIndex(`by_userId_${tenantIdField}`, (q: any) =>
        q.eq("userId", userId).eq(tenantIdField, tenantId),
      )
      .unique();
  }

  async function isMemberOfTenant(
    ctx: TenantScopeCtx,
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    const membership = await findMembership(ctx, userId, tenantId);
    return membership !== null && membership.isActive !== false;
  }

  async function getCurrentTenantId(
    ctx: TenantScopeCtx,
    userId: string,
  ): Promise<string | null> {
    const user = await ctx.db.get(userId);
    if (user === null) return null;
    if (user[activeTenantField]) return user[activeTenantField];

    const memberships = await ctx.db
      .query(junctionTableName)
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .collect();
    const active = memberships.filter(
      (m: TenantScopedRow) => m.isActive !== false,
    );
    return active.length === 1 ? active[0][tenantIdField] : null;
  }

  async function requireTenantId(
    ctx: TenantScopeCtx,
    userId: string,
  ): Promise<string> {
    const tenantId = await getCurrentTenantId(ctx, userId);
    if (tenantId === null) {
      throw new ConvexError({
        code: "NO_ACTIVE_TENANT",
        message: `No active ${tenantName} for this user`,
      });
    }
    if (!(await isMemberOfTenant(ctx, userId, tenantId))) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: `No active membership in the active ${tenantName}`,
      });
    }
    return tenantId;
  }

  async function activeTenantMemberIds(
    ctx: TenantScopeCtx,
    tenantId: string,
  ): Promise<Set<string>> {
    const memberships = await ctx.db
      .query(junctionTableName)
      .withIndex(`by_${tenantIdField}`, (q: any) =>
        q.eq(tenantIdField, tenantId),
      )
      .collect();
    return new Set(
      memberships
        .filter((m: TenantScopedRow) => m.isActive !== false)
        .map((m: TenantScopedRow) => String(m.userId)),
    );
  }

  return {
    tenantIdField,
    activeTenantField,
    junctionTableName,
    rowInTenant,
    getCurrentTenantId,
    isMemberOfTenant,
    requireTenantId,
    activeTenantMemberIds,
  };
}
