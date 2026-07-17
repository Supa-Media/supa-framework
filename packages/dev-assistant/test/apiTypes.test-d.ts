/**
 * TYPE-LEVEL regression test — guards the whole "package functions vanish from
 * (or degrade on) the consumer's generated Convex api/internal" defect class,
 * including the deeper VISIBILITY-WIDENING drop that the factory architecture
 * could not fix (supa-framework PR #27's diagnosis; this file is that fix's
 * decisive test).
 *
 * This file is not executed at runtime (it is `*.test-d.ts`, not `*.test.ts`);
 * it is compiled by `tsconfig.typecheck.json` (wired into `pnpm test`). A
 * compile error here IS the failing test.
 *
 * WHAT THE CONSUMER DOES (the mounting contract this asserts): each re-export
 * file imports the consumer's config module for its side effect and re-exports
 * the package's MODULE-LEVEL function consts from a package subpath, e.g.
 *
 *   // functions/devAssistant/bugs.ts
 *   import "./config"; // runs setDevAssistantConfig(...) before any handler
 *   export { getBug, applyCallback, … } from "@supa-media/dev-assistant/functions/bugs";
 *
 * Convex then builds the consumer's typed api by static inference:
 *   ApiFromModules → FunctionReferenceFromExport → FilterApi
 * and splits it into two VISIBILITY PARTITIONS, exactly as codegen does:
 *   api      = FilterApi<AllApi, FunctionReference<any, "public">>
 *   internal = FilterApi<AllApi, FunctionReference<any, "internal">>
 *
 * A function survives onto its partition with concrete args ONLY if its `typeof`
 * is a GENUINE builder output (`Registered{Query,Mutation,Action}<ConcreteVis,
 * ConcreteArgs, …>`). The OLD `createDevAssistant(config)` factory returned the
 * functions through one large inferred return type, which WIDENED each phantom
 * visibility parameter from its `"internal"`/`"public"` literal to the whole
 * `FunctionVisibility` union — dropping every function from BOTH partitions. The
 * fix (this architecture) exposes each function as a module-level const, so a
 * plain re-export survives. This test reconstructs the real partitioned surface
 * over the real re-export modules and asserts survival + partition + non-`any`
 * args. It FAILS if someone reintroduces a factory (the named re-exports would
 * disappear) or re-adds `(ctx: any, args: any)`/`as any` validators (args
 * collapse to `any`).
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import { internalActionGeneric, internalMutationGeneric } from "convex/server";
import { v } from "convex/values";

// The package's real re-export modules (what the consumer re-exports verbatim).
import * as bugs from "../src/functions/bugs";
import * as actions from "../src/functions/actions";
import * as contributions from "../src/functions/contributions";
import * as maintainers from "../src/functions/maintainers";

// ---- tiny hand-rolled type assertions (no devDependency) ----
type Expect<T extends true> = T;
type IsAny<T> = 0 extends 1 & T ? true : false;
type IsNotAny<T> = IsAny<T> extends true ? false : true;
type HasKey<Node, K extends string> = K extends keyof Node ? true : false;
type ArgsOf<Ref> = Ref extends FunctionReference<any, any, infer A, any>
  ? A
  : "NOT_A_FUNCTION_REFERENCE";

// Mirror the consumer's real modules: the package's re-exports, mixed (in bugs
// and actions) with the consumer's OWN concrete local functions co-located in
// the same module (exactly how Togather's bugs.ts mixes createBug and actions.ts
// mixes processThreadMention). They must coexist on the api node, not be
// collapsed by the package functions beside them. (Spreading the module
// namespaces also carries the non-function exports — validators — which
// `FunctionReferencesInModule` filters out, same as codegen.)
const bugsModule = {
  ...bugs,
  localCreateBug: internalMutationGeneric({
    args: { title: v.string() },
    handler: async (_ctx, args) => ({ title: args.title }),
  }),
};
const actionsModule = {
  ...actions,
  processThreadMention: internalActionGeneric({
    args: { note: v.string() },
    handler: async (_ctx, args) => ({ note: args.note }),
  }),
};
const contributionsModule = { ...contributions };
const maintainersModule = { ...maintainers };

type AllApi = ApiFromModules<{
  "functions/devAssistant/bugs": typeof bugsModule;
  "functions/devAssistant/actions": typeof actionsModule;
  "functions/devAssistant/contributions": typeof contributionsModule;
  "functions/devAssistant/maintainers": typeof maintainersModule;
}>;

// The two visibility partitions codegen produces (`_generated/api`).
type Api = FilterApi<AllApi, FunctionReference<any, "public">>;
type Internal = FilterApi<AllApi, FunctionReference<any, "internal">>;

type InternalBugs = Internal["functions"]["devAssistant"]["bugs"];
type InternalActions = Internal["functions"]["devAssistant"]["actions"];
type InternalMaintainers = Internal["functions"]["devAssistant"]["maintainers"];
type PublicBugs = Api["functions"]["devAssistant"]["bugs"];
type PublicContributions = Api["functions"]["devAssistant"]["contributions"];

// ---------------------------------------------------------------------------
// (a) SURVIVAL + CORRECT PARTITION — every re-exported function lands on the
// right visibility partition (the residual PR #27 blockers: getBug + dispatchBug
// on `internal`; the mobile-referenced contributions on `api`).
// ---------------------------------------------------------------------------
type _internalBugsSurvive = [
  Expect<HasKey<InternalBugs, "getBug">>,
  Expect<HasKey<InternalBugs, "getThreadHistory">>,
  Expect<HasKey<InternalBugs, "applyCallback">>,
  Expect<HasKey<InternalBugs, "markDispatched">>,
  Expect<HasKey<InternalBugs, "handleGithubPrClosed">>,
  Expect<HasKey<InternalBugs, "handleWorkflowRunEvent">>,
  // the consumer's own concrete local mutation must coexist
  Expect<HasKey<InternalBugs, "localCreateBug">>,
];
type _internalActionsSurvive = [
  Expect<HasKey<InternalActions, "dispatchBug">>,
  Expect<HasKey<InternalActions, "dispatchSpec">>,
  Expect<HasKey<InternalActions, "dispatchReview">>,
  Expect<HasKey<InternalActions, "dispatchFix">>,
  Expect<HasKey<InternalActions, "attemptAutoMerge">>,
  Expect<HasKey<InternalActions, "handleRoutineCallback">>,
  Expect<HasKey<InternalActions, "reconcileMergedPrs">>,
  // the consumer's own concrete local action must coexist, not be collapsed
  Expect<HasKey<InternalActions, "processThreadMention">>,
];
type _internalMaintainersSurvive = Expect<
  HasKey<InternalMaintainers, "getAutoMergeCapForUser">
>;
// The public review-screen ops (query/mutation → "public") land on `api`.
type _publicBugsSurvive = [
  Expect<HasKey<PublicBugs, "getBugForReview">>,
  Expect<HasKey<PublicBugs, "rejectBug">>,
  Expect<HasKey<PublicBugs, "markBugMerged">>,
  Expect<HasKey<PublicBugs, "retryDispatch">>,
];
// The whole contributor dashboard surface the mobile client references via
// `api.functions.devAssistant.contributions.*`.
type _publicContributionsSurvive = [
  Expect<HasKey<PublicContributions, "submit">>,
  Expect<HasKey<PublicContributions, "approveSpec">>,
  Expect<HasKey<PublicContributions, "myContributions">>,
  Expect<HasKey<PublicContributions, "listAll">>,
  Expect<HasKey<PublicContributions, "getContribution">>,
  Expect<HasKey<PublicContributions, "getThread">>,
  Expect<HasKey<PublicContributions, "getGithubUsername">>,
];

// ---------------------------------------------------------------------------
// (b) PARTITION EXCLUSION — an internal function must NOT leak onto `api`, and a
// public function must NOT leak onto `internal`. This is what the visibility
// widening destroyed (a widened `"public" | "internal"` matched NEITHER filter);
// asserting both directions proves the literals are preserved.
// ---------------------------------------------------------------------------
type _internalNotOnPublic = [
  Expect<HasKey<PublicBugs, "getBug"> extends false ? true : false>,
  Expect<HasKey<PublicBugs, "applyCallback"> extends false ? true : false>,
];
type _publicNotOnInternal = [
  Expect<HasKey<InternalBugs, "getBugForReview"> extends false ? true : false>,
  Expect<HasKey<InternalBugs, "rejectBug"> extends false ? true : false>,
];

// ---------------------------------------------------------------------------
// (c) NON-ANY ARGS — the arg types survive inference (the arg-collapse defect).
// ---------------------------------------------------------------------------
type _argsAreConcrete = [
  Expect<IsNotAny<ArgsOf<InternalBugs["getBug"]>>>,
  Expect<IsNotAny<ArgsOf<InternalBugs["applyCallback"]>>>,
  Expect<IsNotAny<ArgsOf<InternalBugs["markDispatched"]>>>,
  Expect<IsNotAny<ArgsOf<InternalBugs["handleWorkflowRunEvent"]>>>,
  Expect<IsNotAny<ArgsOf<InternalActions["dispatchBug"]>>>,
  Expect<IsNotAny<ArgsOf<InternalActions["handleRoutineCallback"]>>>,
  Expect<IsNotAny<ArgsOf<PublicContributions["submit"]>>>,
];

// Spot-check specific fields flow through (validator → arg type).
type _applyCallbackArgs = ArgsOf<InternalBugs["applyCallback"]>;
type _fieldsFlowThrough = [
  Expect<"bugId" extends keyof _applyCallbackArgs ? true : false>,
  Expect<"status" extends keyof _applyCallbackArgs ? true : false>,
  Expect<_applyCallbackArgs["status"] extends string ? true : false>,
];

// Reference the assertion aliases so `noUnusedLocals`-style lints stay quiet and
// the aliases are part of the compiled program.
export type __ApiTypeRegression = [
  _internalBugsSurvive,
  _internalActionsSurvive,
  _internalMaintainersSurvive,
  _publicBugsSurvive,
  _publicContributionsSurvive,
  _internalNotOnPublic,
  _publicNotOnInternal,
  _argsAreConcrete,
  _fieldsFlowThrough,
];
