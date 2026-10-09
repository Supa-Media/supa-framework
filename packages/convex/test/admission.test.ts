/**
 * Invite-only admission. What matters is that both hooks fail closed and that
 * a returning account never reaches the new-user check.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertMayCreateUser,
  assertMayReceiveEmailCode,
  NOT_ADMITTED_MESSAGE,
} from "../src/auth/admission";
import { userCallback } from "../src/auth/users";

const ctx = {} as never;

test("no admission config lets everybody through", async () => {
  await assertMayReceiveEmailCode(undefined, ctx, "a@example.com");
  await assertMayCreateUser(undefined, ctx, { provider: "email", email: "a@example.com" });
});

test("a refused address is not mailed a code", async () => {
  const admission = { canReceiveEmailCode: async (_: unknown, email: string) => email === "in@example.com" };
  await assertMayReceiveEmailCode(admission, ctx, "in@example.com");
  await assert.rejects(
    () => assertMayReceiveEmailCode(admission, ctx, "out@example.com"),
    new RegExp(NOT_ADMITTED_MESSAGE),
  );
});

test("the code check fails closed without a ctx or when the hook throws", async () => {
  const yes = { canReceiveEmailCode: async () => true };
  await assert.rejects(() => assertMayReceiveEmailCode(yes, undefined, "in@example.com"));
  const broken = {
    canReceiveEmailCode: async () => {
      throw new Error("database down");
    },
  };
  await assert.rejects(() => assertMayReceiveEmailCode(broken, ctx, "in@example.com"));
  const truthy = { canReceiveEmailCode: async () => "yes" as unknown as boolean };
  await assert.rejects(() => assertMayReceiveEmailCode(truthy, ctx, "in@example.com"));
});

/** A db that holds one user, and records inserts. */
function fakeCtx(existing: { _id: string; email?: string; phone?: string } | null) {
  const inserted: unknown[] = [];
  const patches: Record<string, unknown>[] = [];
  const db = {
    get: async (id: string) => (existing && existing._id === id ? existing : null),
    patch: async (_id: string, data: Record<string, unknown>) => {
      patches.push(data);
    },
    insert: async (_table: string, row: unknown) => {
      inserted.push(row);
      return "new-user";
    },
    query: () => ({
      filter: (f: (q: unknown) => unknown) => {
        let wanted: unknown;
        f({ eq: (_: unknown, v: unknown) => ((wanted = v), true), field: (n: string) => n });
        return { first: async () => (existing && existing.email === wanted ? existing : null) };
      },
    }),
  };
  return { ctx: { db } as never, inserted, patches };
}

const refuseAll = { canCreateUser: async () => false };
const emailProvider = { id: "email" } as never;

test("a stranger is refused a new account and nothing is written", async () => {
  const { ctx: c, inserted } = fakeCtx(null);
  await assert.rejects(
    () =>
      userCallback(refuseAll)(c, {
        existingUserId: null,
        type: "email",
        provider: emailProvider,
        profile: { email: "out@example.com" },
      }),
    new RegExp(NOT_ADMITTED_MESSAGE),
  );
  assert.equal(inserted.length, 0);
});

test("a returning account is never asked", async () => {
  const { ctx: c } = fakeCtx({ _id: "u1", email: "old@example.com" });
  const id = await userCallback(refuseAll)(c, {
    existingUserId: "u1" as never,
    type: "email",
    provider: emailProvider,
    profile: { email: "old@example.com" },
  });
  assert.equal(id, "u1");
});

test("a new sign-in method for an existing user's email links instead of asking", async () => {
  const { ctx: c } = fakeCtx({ _id: "u1", email: "old@example.com" });
  const id = await userCallback(refuseAll)(c, {
    existingUserId: null,
    type: "email",
    provider: emailProvider,
    profile: { email: "old@example.com" },
  });
  assert.equal(id, "u1");
});

test("the new-user check sees the provider id and the address", async () => {
  const seen: unknown[] = [];
  const admission = {
    canCreateUser: async (_: unknown, who: unknown) => {
      seen.push(who);
      return true;
    },
  };
  const { ctx: c, inserted } = fakeCtx(null);
  await userCallback(admission)(c, {
    existingUserId: null,
    type: "email",
    provider: { id: "magic-link" } as never,
    profile: { email: "in@example.com" },
  });
  assert.deepEqual(seen, [{ provider: "magic-link", email: "in@example.com" }]);
  assert.equal(inserted.length, 1);
});

test("onUserCreated runs once, after the insert, with the new id and who it is", async () => {
  const calls: unknown[] = [];
  const { ctx: c, inserted } = fakeCtx(null);
  const onUserCreated = async (_: unknown, created: unknown) => {
    // The row is already written when the hook runs, so it can read it.
    assert.equal(inserted.length, 1);
    calls.push(created);
  };
  await userCallback(undefined, onUserCreated)(c, {
    existingUserId: null,
    type: "email",
    provider: { id: "magic-link" } as never,
    profile: { email: "in@example.com" },
  });
  assert.deepEqual(calls, [{ userId: "new-user", provider: "magic-link", email: "in@example.com" }]);
});

test("onUserCreated never runs for a returning account, a linked one, or a refusal", async () => {
  const calls: unknown[] = [];
  const onUserCreated = async (_: unknown, created: unknown) => {
    calls.push(created);
  };
  const returning = fakeCtx({ _id: "u1", email: "old@example.com" });
  await userCallback(undefined, onUserCreated)(returning.ctx, {
    existingUserId: "u1" as never,
    type: "email",
    provider: emailProvider,
    profile: { email: "old@example.com" },
  });
  await userCallback(undefined, onUserCreated)(returning.ctx, {
    existingUserId: null,
    type: "email",
    provider: emailProvider,
    profile: { email: "old@example.com" },
  });
  await assert.rejects(() =>
    userCallback(refuseAll, onUserCreated)(fakeCtx(null).ctx, {
      existingUserId: null,
      type: "email",
      provider: emailProvider,
      profile: { email: "out@example.com" },
    }),
  );
  assert.deepEqual(calls, []);
});

test("a throwing onUserCreated fails the sign-in, so its writes and the user roll back together", async () => {
  const { ctx: c } = fakeCtx(null);
  await assert.rejects(
    () =>
      userCallback(undefined, async () => {
        throw new Error("hook broke");
      })(c, {
        existingUserId: null,
        type: "email",
        provider: emailProvider,
        profile: { email: "in@example.com" },
      }),
    /hook broke/,
  );
});

test("signing in through a second address keeps the address the user has", async () => {
  const { ctx: c, patches } = fakeCtx({ _id: "u1", email: "home@example.com", phone: "+15555550100" });
  await userCallback(undefined)(c, {
    existingUserId: "u1" as never,
    type: "email",
    provider: emailProvider,
    profile: { email: "work@example.com" },
  });
  assert.equal(patches.length, 1);
  assert.equal(patches[0]!.email, undefined);
  assert.equal(typeof patches[0]!.emailVerificationTime, "number");
});

test("a returning user with no address on file gets the one they signed in with", async () => {
  const { ctx: c, patches } = fakeCtx({ _id: "u1" });
  await userCallback(undefined)(c, {
    existingUserId: "u1" as never,
    type: "email",
    provider: emailProvider,
    profile: { email: "home@example.com" },
  });
  assert.equal(patches[0]!.email, "home@example.com");
});

test("an address the app attached to a user signs in as that user, not a new one", async () => {
  const { ctx: c, inserted, patches } = fakeCtx({ _id: "u1", email: "home@example.com" });
  const created: unknown[] = [];
  const id = await userCallback(
    refuseAll,
    async (_: unknown, user: unknown) => {
      created.push(user);
    },
    async (_: unknown, email: string) => (email === "work@example.com" ? ("u1" as never) : null),
  )(c, {
    existingUserId: null,
    type: "email",
    provider: emailProvider,
    profile: { email: "work@example.com" },
  });
  assert.equal(id, "u1");
  assert.equal(inserted.length, 0);
  assert.deepEqual(created, []);
  assert.equal(patches[0]!.email, undefined);
});

test("an address the app does not know falls through to the usual rules", async () => {
  const { ctx: c } = fakeCtx(null);
  await assert.rejects(() =>
    userCallback(refuseAll, undefined, async () => null)(c, {
      existingUserId: null,
      type: "email",
      provider: emailProvider,
      profile: { email: "stranger@example.com" },
    }),
  );
});
