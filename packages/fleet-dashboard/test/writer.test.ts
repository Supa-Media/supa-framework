import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { MAX_APPROVE_BATCH } from "../src/sources/github/queries";
import { createGitHubWriter } from "../src/sources/github/writer";

/**
 * The write layer, driven against a stubbed `fetch`.
 *
 * Two of v2's review findings live here and neither is visible from a type:
 * GitHub answers a partially-applied batch with `HTTP 200` carrying `data` AND
 * `errors`, and the REST issues endpoints *create* a label they don't recognize
 * instead of rejecting it.
 */

interface Call {
  url: string;
  method: string;
  body: unknown;
}

const calls: Call[] = [];
let handler: (call: Call) => unknown = () => ({});

const originalFetch = globalThis.fetch;

function stubFetch(): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    const payload = handler(call);
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  calls.length = 0;
});

/** The GraphQL documents sent, in order. */
function documents(): string[] {
  return calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => (call.body as { query: string }).query);
}

function mutations(): Array<{ query: string; variables: Record<string, unknown> }> {
  return calls
    .filter((call) => call.url.endsWith("/graphql"))
    .map((call) => call.body as { query: string; variables: Record<string, unknown> })
    .filter((body) => body.query.includes("mutation ApprovePlan"));
}

/** Every label lookup answers with an id — the label exists. */
function labelsExist(call: Call): unknown {
  const body = call.body as { query?: string; variables: Record<string, unknown> };
  if (typeof body?.query !== "string" || !body.query.includes("query LabelIds")) return null;
  const repository: Record<string, { id: string }> = {};
  for (const key of Object.keys(body.variables)) {
    const match = /^label(\d+)$/.exec(key);
    if (match) repository[`l${match[1]}`] = { id: `LABEL_${match[1]}` };
  }
  return { data: { repository } };
}

test("the approve batch is chunked, and every issue is accounted for", async () => {
  stubFetch();
  handler = (call) => labelsExist(call) ?? { data: {} };

  const nodes = Array.from({ length: 45 }, (_, i) => `node-${i}`);
  const writer = createGitHubWriter("t");
  const outcome = await writer.addLabelToMany("o/r", nodes, "plan:approved");

  const sizes = mutations().map(
    (body) => Object.keys(body.variables).filter((key) => key.startsWith("target")).length,
  );
  assert.deepEqual(sizes, [MAX_APPROVE_BATCH, MAX_APPROVE_BATCH, 5]);
  assert.equal(outcome.labelled.length, 45);
  assert.equal(outcome.failed.length, 0);

  // No document may carry more aliases than the cap — the point of the cap is
  // that GitHub runs mutation aliases serially.
  for (const query of mutations().map((body) => body.query)) {
    assert.ok(!query.includes(`add${MAX_APPROVE_BATCH}:`));
  }
});

test("a 200 carrying both data and errors reports per issue, not success", async () => {
  stubFetch();
  handler = (call) => {
    const existing = labelsExist(call);
    if (existing !== null) return existing;
    // Exactly the shape GitHub returns for one bad node id among good ones.
    return {
      data: { add0: { clientMutationId: null }, add1: null, add2: { clientMutationId: null } },
      errors: [
        {
          type: "NOT_FOUND",
          path: ["add1"],
          message: "Could not resolve to a node with the global id of 'node-b'.",
        },
      ],
    };
  };

  const writer = createGitHubWriter("t");
  const outcome = await writer.addLabelToMany("o/r", ["node-a", "node-b", "node-c"], "plan:approved");

  assert.deepEqual(outcome.labelled, ["node-a", "node-c"]);
  assert.equal(outcome.failed.length, 1);
  assert.equal(outcome.failed[0]?.nodeId, "node-b");
  assert.match(outcome.failed[0]?.message ?? "", /Could not resolve/);
});

test("an error naming no alias fails its whole chunk, since nothing says which ran", async () => {
  stubFetch();
  handler = (call) =>
    labelsExist(call) ?? {
      data: null,
      errors: [{ message: "API rate limit exceeded" }],
    };

  const writer = createGitHubWriter("t");
  const outcome = await writer.addLabelToMany("o/r", ["a", "b"], "plan:approved");

  assert.deepEqual(outcome.labelled, []);
  assert.deepEqual(
    outcome.failed.map((failure) => failure.nodeId),
    ["a", "b"],
  );
});

test("a partial batch still reports the chunks that landed", async () => {
  stubFetch();
  let chunk = 0;
  handler = (call) => {
    const existing = labelsExist(call);
    if (existing !== null) return existing;
    chunk += 1;
    // First chunk clean, second chunk loses one alias.
    return chunk === 1
      ? { data: {} }
      : { data: {}, errors: [{ path: ["add2"], message: "Resource not accessible" }] };
  };

  const nodes = Array.from({ length: 25 }, (_, i) => `node-${i}`);
  const outcome = await createGitHubWriter("t").addLabelToMany("o/r", nodes, "plan:approved");

  assert.equal(outcome.labelled.length, 24);
  assert.deepEqual(
    outcome.failed.map((failure) => failure.nodeId),
    ["node-22"],
  );
});

test("addLabels refuses a label the repo does not have, and never reaches REST", async () => {
  stubFetch();
  handler = () => ({ data: { repository: { l0: null } } });

  await assert.rejects(
    () => createGitHubWriter("t").addLabels("o/r", 7, ["agent:redy"]),
    /no label "agent:redy"/,
  );
  assert.equal(
    calls.filter((call) => call.url.includes("/issues/")).length,
    0,
    "the REST endpoint creates unknown labels, so it must not be reached at all",
  );
});

test("createIssue refuses an unknown label before filing anything", async () => {
  stubFetch();
  handler = () => ({ data: { repository: { l0: null } } });

  await assert.rejects(
    () =>
      createGitHubWriter("t").createIssue("o/r", {
        title: "x",
        body: "y",
        labels: ["agent:ready"],
      }),
    /create it in the repo first/,
  );
  assert.equal(calls.filter((call) => call.method === "POST" && !call.url.endsWith("/graphql")).length, 0);
});

test("a known label passes, is checked once per repo, and then writes", async () => {
  stubFetch();
  handler = (call) =>
    labelsExist(call) ?? { html_url: "https://github.com/o/r/issues/1", number: 1 };

  const writer = createGitHubWriter("t");
  await writer.addLabels("o/r", 7, ["agent:ready"]);
  await writer.addLabels("o/r", 8, ["agent:ready"]);

  assert.equal(
    documents().filter((query) => query.includes("query LabelIds")).length,
    1,
    "the resolved id is cached for the session",
  );
  assert.equal(calls.filter((call) => call.url.includes("/issues/7/labels")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/issues/8/labels")).length, 1);
});

test("the writer exposes no way to run a workflow", () => {
  const writer = createGitHubWriter("t") as unknown as Record<string, unknown>;
  assert.equal(writer["dispatchWorkflow"], undefined);
  assert.deepEqual(Object.keys(writer).sort(), [
    "addLabelToMany",
    "addLabels",
    "closeIssue",
    "comment",
    "createIssue",
    "removeLabel",
  ]);
});
