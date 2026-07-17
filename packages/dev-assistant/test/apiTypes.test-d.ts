/**
 * TYPE-LEVEL regression test — guards the "factory functions vanish from the
 * consumer's generated Convex api/internal" defect class.
 *
 * This file is not executed at runtime (it is `*.test-d.ts`, not `*.test.ts`);
 * it is compiled by `tsconfig.typecheck.json` (wired into `pnpm test`). A
 * compile error here IS the failing test.
 *
 * The defect: a consumer mounts the package by re-exporting the factory's Convex
 * functions from their own modules, e.g.
 *
 *   // functions/devAssistant/bugs.ts
 *   export const { getBug, applyCallback, … } = devAssistant.bugs;
 *
 * Convex builds the consumer's typed `api`/`internal` by static inference:
 * `ApiFromModules` → `FunctionReferenceFromExport` → `FilterApi`. That pipeline
 * only carries a function's ARG types through if the function's `typeof` is a
 * concrete `Registered{Query,Mutation,Action}<Vis, ConcreteArgs, …>`. When the
 * package authored handlers as `(ctx: any, args: any)` (and cast its validators
 * `as any`), every re-exported function collapsed to
 * `Registered…<Vis, any, …>` — its args typed `any` on the consumer surface,
 * which cascaded into `convex typecheck` failures (mobile hooks + internal
 * scheduling + tests all reference these via the generated api). See the
 * "consumer api types" PR.
 *
 * This test reconstructs exactly that mounting shape (a fake module built from
 * the real factory output), runs Convex's own `ApiFromModules` over it, and
 * asserts every function both (a) SURVIVES onto the api node and (b) keeps
 * NON-`any` args. If a future edit reintroduces `(ctx: any, args: any)` or an
 * `as any` validator, an assertion below fails to compile.
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
  RegisteredAction,
  RegisteredQuery,
} from "convex/server";
import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { createDevAssistant } from "../src/functions/index";
import { internalGroup, publicGroup } from "../src/functions/visibility";

// ---- tiny hand-rolled type assertions (no devDependency) ----
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNotAny<T> = IsAny<T> extends true ? false : true;
type HasKey<Node, K extends string> = K extends keyof Node ? true : false;
type ArgsOf<Ref> = Ref extends FunctionReference<any, any, infer A, any>
  ? A
  : "NOT_A_FUNCTION_REFERENCE";

// A representative, fully-defaulted config (values are irrelevant to the types).
const devAssistant = createDevAssistant({
  functionsPath: "functions/devAssistant",
  authenticate: async () => "user",
  canUseDevAssistant: async () => true,
  repo: {
    owner: "acme",
    name: "app",
    baseBranch: "main",
    branchPrefix: "claude/devbug-",
    stagingDeployWorkflowNames: [],
    productionDeployWorkflowName: "Deploy to Production",
    productionDeployWorkflowFile: "deploy-to-production.yml",
    productionDeployInputs: {},
  },
});

// Mirror the README's documented mounting: destructured re-export into modules,
// mixed (in actions) with a consumer's own concrete local function.
const bugsModule = { ...devAssistant.bugs };
const actionsModule = {
  ...devAssistant.actions,
  // A consumer's OWN concrete local function, co-located in the same module as
  // the re-exported package functions (exactly how Togather's actions.ts mixes
  // `processThreadMention` with the package's dispatch actions). It must coexist
  // on the api node, not be collapsed by the package functions beside it.
  localConcrete: internalActionGeneric({
    args: { note: v.string() },
    handler: async (_ctx, args) => ({ note: args.note }),
  }),
};
const contributionsModule = { ...devAssistant.contributions };
const maintainersModule = { ...devAssistant.maintainers };

type Api = ApiFromModules<{
  "functions/devAssistant/bugs": typeof bugsModule;
  "functions/devAssistant/actions": typeof actionsModule;
  "functions/devAssistant/contributions": typeof contributionsModule;
  "functions/devAssistant/maintainers": typeof maintainersModule;
}>;

type Bugs = Api["functions"]["devAssistant"]["bugs"];
type Actions = Api["functions"]["devAssistant"]["actions"];
type Contributions = Api["functions"]["devAssistant"]["contributions"];
type Maintainers = Api["functions"]["devAssistant"]["maintainers"];

// The consumer's generated `api` / `internal` are NOT the raw `ApiFromModules`
// output — they are visibility PARTITIONS of it:
//   export const internal = FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
//   export const api      = FilterApi<typeof fullApi, FunctionReference<any, "public">>;
// A function survives `ApiFromModules` even if its visibility is widened to
// `"public" | "internal"`, but such a function is dropped from BOTH partitions
// (its `_visibility` is assignable to neither literal). The original defect
// slipped past a test that only checked `ApiFromModules`; these partition types
// are what actually matter to a consumer.
type InternalApi = FilterApi<Api, FunctionReference<any, "internal">>;
type PublicApi = FilterApi<Api, FunctionReference<any, "public">>;
type InternalBugs = InternalApi["functions"]["devAssistant"]["bugs"];
type InternalActions = InternalApi["functions"]["devAssistant"]["actions"];
type InternalMaintainers =
  InternalApi["functions"]["devAssistant"]["maintainers"];
type PublicBugs = PublicApi["functions"]["devAssistant"]["bugs"];
type PublicContributions =
  PublicApi["functions"]["devAssistant"]["contributions"];

// ---------------------------------------------------------------------------
// (a) SURVIVAL — every re-exported function is present on its api node.
// ---------------------------------------------------------------------------
type _bugsSurvive = [
  Expect<HasKey<Bugs, "getBug">>,
  Expect<HasKey<Bugs, "getThreadHistory">>,
  Expect<HasKey<Bugs, "applyCallback">>,
  Expect<HasKey<Bugs, "markDispatched">>,
  Expect<HasKey<Bugs, "handleGithubPrClosed">>,
  Expect<HasKey<Bugs, "handleWorkflowRunEvent">>,
  Expect<HasKey<Bugs, "getBugForReview">>,
  Expect<HasKey<Bugs, "rejectBug">>,
  Expect<HasKey<Bugs, "markBugMerged">>,
  Expect<HasKey<Bugs, "retryDispatch">>,
];
type _actionsSurvive = [
  Expect<HasKey<Actions, "dispatchBug">>,
  Expect<HasKey<Actions, "dispatchSpec">>,
  Expect<HasKey<Actions, "dispatchReview">>,
  Expect<HasKey<Actions, "dispatchFix">>,
  Expect<HasKey<Actions, "attemptAutoMerge">>,
  Expect<HasKey<Actions, "handleRoutineCallback">>,
  Expect<HasKey<Actions, "reconcileMergedPrs">>,
  // the consumer's own concrete local function must coexist, not be collapsed
  Expect<HasKey<Actions, "localConcrete">>,
];
type _contributionsSurvive = Expect<
  keyof Contributions extends never ? false : true
>;
type _maintainersSurvive = Expect<HasKey<Maintainers, "getAutoMergeCapForUser">>;

// ---------------------------------------------------------------------------
// (b) NON-ANY ARGS — the arg types survive inference (the actual regression).
// ---------------------------------------------------------------------------
type _argsAreConcrete = [
  Expect<IsNotAny<ArgsOf<Bugs["getBug"]>>>,
  Expect<IsNotAny<ArgsOf<Bugs["applyCallback"]>>>,
  Expect<IsNotAny<ArgsOf<Bugs["markDispatched"]>>>,
  Expect<IsNotAny<ArgsOf<Bugs["handleWorkflowRunEvent"]>>>,
  Expect<IsNotAny<ArgsOf<Actions["dispatchBug"]>>>,
  Expect<IsNotAny<ArgsOf<Actions["handleRoutineCallback"]>>>,
];

// Spot-check specific fields flow through (validator → arg type).
type _applyCallbackArgs = ArgsOf<Bugs["applyCallback"]>;
type _fieldsFlowThrough = [
  Expect<"bugId" extends keyof _applyCallbackArgs ? true : false>,
  Expect<"status" extends keyof _applyCallbackArgs ? true : false>,
  Expect<_applyCallbackArgs["status"] extends string ? true : false>,
];

// ---------------------------------------------------------------------------
// (c) VISIBILITY PARTITION — the decisive check. Every function must land on the
// correct partition (`internal` vs `api`). A widened `"public" | "internal"`
// visibility drops the function from BOTH — this is the exact failure a real
// consumer hits, and what the original test missed.
// ---------------------------------------------------------------------------
type _internalSurvive = [
  // internal bugs pipeline ops
  Expect<HasKey<InternalBugs, "getBug">>,
  Expect<HasKey<InternalBugs, "applyCallback">>,
  Expect<HasKey<InternalBugs, "handleWorkflowRunEvent">>,
  // internal actions (dispatch/auto-merge/callback)
  Expect<HasKey<InternalActions, "dispatchBug">>,
  Expect<HasKey<InternalActions, "handleRoutineCallback">>,
  Expect<HasKey<InternalActions, "reconcileMergedPrs">>,
  // internal maintainers
  Expect<HasKey<InternalMaintainers, "getAutoMergeCapForUser">>,
];
type _publicSurvive = [
  // public maintainer review-screen ops (mobile-facing)
  Expect<HasKey<PublicBugs, "getBugForReview">>,
  Expect<HasKey<PublicBugs, "rejectBug">>,
  Expect<HasKey<PublicBugs, "markBugMerged">>,
  Expect<HasKey<PublicBugs, "retryDispatch">>,
  // public contribution dashboard functions
  Expect<HasKey<PublicContributions, "submit">>,
  Expect<HasKey<PublicContributions, "getContribution">>,
];
// And the partitions must be DISJOINT: an internal-only function must NOT appear
// on the public partition (proves visibility stayed a concrete literal, not the
// `"public" | "internal"` union — a union would land it on neither, so if it
// wrongly showed on public the pin would be wrong the other way).
type _partitionDisjoint = [
  // an internal bug op must NOT appear on the public partition
  Expect<"getBug" extends keyof PublicBugs ? false : true>,
  // the all-internal `actions` node is dropped entirely from the public
  // partition (an empty node is removed) — so `actions` is absent under public
  Expect<"actions" extends keyof PublicApi["functions"]["devAssistant"]
    ? false
    : true>,
];

// ---------------------------------------------------------------------------
// (d) THE MECHANISM, version-independently. The visibility widening only
// reproduces under some tsc/convex-version combos, so the assertions above can
// pass on a convex version that happens not to widen. This block deterministically
// exercises the FIX itself: feed `pinGroupVisibility` a group whose member has an
// ALREADY-WIDENED visibility (`FunctionVisibility`, the failure mode) and assert
// the pinned result (a) survives the visibility partition and (b) keeps its args.
declare const widenedGroup: {
  // widened visibility (`"public" | "internal"`), concrete args — exactly the
  // shape the factory produced before the pin.
  widenedAction: RegisteredAction<
    import("convex/server").FunctionVisibility,
    { bugId: string },
    Promise<null>
  >;
  widenedQuery: RegisteredQuery<
    import("convex/server").FunctionVisibility,
    { token: string },
    Promise<null>
  >;
};
const pinnedInternal = internalGroup({
  widenedAction: widenedGroup.widenedAction,
});
const pinnedPublic = publicGroup({ widenedQuery: widenedGroup.widenedQuery });
type PinnedInternalApi = FilterApi<
  ApiFromModules<{ "m/i": typeof pinnedInternal }>,
  FunctionReference<any, "internal">
>;
type PinnedPublicApi = FilterApi<
  ApiFromModules<{ "m/p": typeof pinnedPublic }>,
  FunctionReference<any, "public">
>;
type _pinFixesInternal = Expect<
  "widenedAction" extends keyof PinnedInternalApi["m"]["i"] ? true : false
>;
type _pinFixesPublic = Expect<
  "widenedQuery" extends keyof PinnedPublicApi["m"]["p"] ? true : false
>;
// args preserved through the pin
type _pinKeepsArgs = Expect<
  IsNotAny<ArgsOf<PinnedInternalApi["m"]["i"]["widenedAction"]>>
>;

// Reference the assertion aliases so `noUnusedLocals`-style lints stay quiet and
// the aliases are part of the compiled program.
export type __ApiTypeRegression = [
  _bugsSurvive,
  _actionsSurvive,
  _contributionsSurvive,
  _maintainersSurvive,
  _argsAreConcrete,
  _fieldsFlowThrough,
  _internalSurvive,
  _publicSurvive,
  _partitionDisjoint,
  _pinFixesInternal,
  _pinFixesPublic,
  _pinKeepsArgs,
];
