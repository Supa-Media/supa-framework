/**
 * Visibility pinning for the factory's returned Convex functions.
 *
 * WHY THIS EXISTS (the consumer-api defect — read before deleting):
 *
 * A function authored with a `*Generic` builder is typed
 * `RegisteredQuery/Mutation/Action<"internal" | "public", Args, Return>` with a
 * CONCRETE visibility literal. Convex's generated `api` / `internal` objects are
 * built by partitioning every function by visibility:
 *
 *   export const internal = FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
 *   export const api      = FilterApi<typeof fullApi, FunctionReference<any, "public">>;
 *
 * A function only lands on `internal` if its reference's `_visibility` is
 * assignable to `"internal"` (and likewise for `api`/`"public"`).
 *
 * The bug: when the ~48 functions this package returns flow through
 * `createDevAssistant`'s single large INFERRED return type, TypeScript can
 * WIDEN the (phantom) visibility type parameter from the concrete literal to the
 * whole `FunctionVisibility` union (`"public" | "internal"`). This was observed
 * with a real consumer on convex 1.31.x. A widened `"public" | "internal"`
 * visibility is assignable to NEITHER `"internal"` NOR `"public"`, so the
 * function silently vanishes from BOTH `api` and `internal` — every re-exported
 * function (mobile hooks, internal scheduling, tests) fails to type-resolve,
 * even though runtime registration is unaffected. The ARGS survive the widening
 * (and are recovered below via `infer`); only the visibility literal is lost.
 *
 * The fix: re-establish each function's concrete visibility literal at the
 * factory boundary. `pinGroupVisibility(group, "internal" | "public")` maps each
 * member back to a concrete-visibility registered-function type, recovering its
 * args/return via `infer` (so arg types are preserved). Applying it inside each
 * `make*Functions` return keeps the visibility concrete all the way to the
 * consumer's generated `api`/`internal`.
 *
 * Regression coverage: `test/apiTypes.test-d.ts` asserts survival through the
 * visibility-partition `FilterApi` (not just `ApiFromModules`), which is the
 * check that would have caught this.
 */

import type {
  FunctionVisibility,
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";

/**
 * Re-pin one registered-function type's visibility to `V`, keeping args/return.
 *
 * IMPORTANT: discriminate on the cheap `isQuery`/`isMutation`/`isAction` marker
 * BEFORE the `infer` branch, and only `infer` inside the matching branch. A
 * flat `T extends RegisteredQuery<any, infer A, infer R> ? … : T extends
 * RegisteredMutation<…> ? …` chain runs the non-matching branches' `infer`s over
 * `T` too; on a function with COMPLEX args/return that extra inference makes the
 * whole conditional bail to the `: T` fallback (leaving the widened visibility
 * in place). Gating each `infer` behind its concrete marker runs inference at
 * most once, on the correct branch — which is what makes this work on the real
 * (heavily-validated) pipeline functions, not just toy ones.
 */
export type PinVisibility<T, V extends FunctionVisibility> = T extends {
  isQuery: true;
}
  ? T extends RegisteredQuery<any, infer A, infer R>
    ? RegisteredQuery<V, A, R>
    : T
  : T extends { isMutation: true }
    ? T extends RegisteredMutation<any, infer A, infer R>
      ? RegisteredMutation<V, A, R>
      : T
    : T extends { isAction: true }
      ? T extends RegisteredAction<any, infer A, infer R>
        ? RegisteredAction<V, A, R>
        : T
      : T;

/** Re-pin every function in a group object to visibility `V`. */
export type PinGroupVisibility<G, V extends FunctionVisibility> = {
  [K in keyof G]: PinVisibility<G[K], V>;
};

/**
 * Runtime identity that pins the STATIC visibility of every function in `group`
 * to `"internal"`. Purely a type-level fix — the returned object is the same
 * object at runtime.
 *
 * NOTE: the visibility literal is hard-coded in the return type rather than
 * taken as a parameter. A generic `<V extends FunctionVisibility>` inferred from
 * a `"internal"` argument widens to the whole `FunctionVisibility` union (the
 * literal is not retained through argument inference here), which would defeat
 * the entire fix — so we expose one function per visibility.
 */
export function internalGroup<G>(group: G): PinGroupVisibility<G, "internal"> {
  return group as unknown as PinGroupVisibility<G, "internal">;
}

/** Like {@link internalGroup}, but pins every function to `"public"`. */
export function publicGroup<G>(group: G): PinGroupVisibility<G, "public"> {
  return group as unknown as PinGroupVisibility<G, "public">;
}
