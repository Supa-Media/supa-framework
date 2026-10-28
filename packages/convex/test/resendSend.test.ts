/**
 * A refused Resend send is logged as a status and a known error name, never
 * its body: the body is text we do not control and could echo the recipient,
 * the code in the message, or the key in the request.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { RESEND_SEND_FAILED, sendResendEmail } from "../src/auth/resendSend";

const ADDRESS = "victim@example.invalid";
const CODE = "482915";
const KEY = "re_fake_key_never_real_0123456789";

const email = { apiKey: KEY, from: "auth@example.invalid", to: ADDRESS, subject: `${CODE} is your code`, html: `<p>${CODE}</p>` };

/** A fetch that answers once with `body` and `status`, recording what it was sent. */
function answering(status: number, body: string) {
  const sent: RequestInit[] = [];
  const send = (async (_url: unknown, init?: RequestInit) => {
    sent.push(init!);
    return new Response(body, { status });
  }) as typeof fetch;
  return { send, sent };
}

function capture() {
  const lines: string[] = [];
  const log = (message: string, fields: unknown) => lines.push(`${message} ${JSON.stringify(fields)}`);
  return { lines, log };
}

const hostile = [
  // Resend's shape, with every secret echoed into it.
  JSON.stringify({ statusCode: 422, name: "validation_error", message: `Invalid \`to\`: ${ADDRESS}. Subject ${CODE}. Key ${KEY}.` }),
  // An unknown error name that is itself the secret.
  JSON.stringify({ statusCode: 400, name: `${ADDRESS} ${CODE} ${KEY}` }),
  // Not JSON at all: a proxy's error page echoing the request.
  `<html>Bad gateway for ${ADDRESS} with ${CODE} using ${KEY}</html>`,
];

for (const [index, body] of hostile.entries()) {
  test(`a refusal echoing the address, code and key logs none of them (${index + 1})`, async () => {
    const { send } = answering(422, body);
    const { lines, log } = capture();
    await assert.rejects(sendResendEmail(email, send, log), { message: RESEND_SEND_FAILED });
    assert.equal(lines.length, 1);
    for (const secret of [ADDRESS, CODE, KEY]) assert.ok(!lines[0]!.includes(secret), `${secret} reached the log: ${lines[0]}`);
  });
}

test("the line carries the status and Resend's error name when it is a known one", async () => {
  const { send } = answering(429, JSON.stringify({ statusCode: 429, name: "rate_limit_exceeded", message: "Too many requests" }));
  const { lines, log } = capture();
  await assert.rejects(sendResendEmail(email, send, log), { message: RESEND_SEND_FAILED });
  assert.deepEqual(lines, ['Resend email send failed {"status":429,"category":"rate_limit_exceeded"}']);
});

test("an unknown or unreadable error is logged as `other`", async () => {
  for (const body of [JSON.stringify({ name: "something_new" }), "not json", ""]) {
    const { send } = answering(500, body);
    const { lines, log } = capture();
    await assert.rejects(sendResendEmail(email, send, log));
    assert.deepEqual(lines, ['Resend email send failed {"status":500,"category":"other"}']);
  }
});

test("a successful send logs nothing and posts the message to Resend with the key in the header only", async () => {
  const { send, sent } = answering(200, JSON.stringify({ id: "email_1" }));
  const { lines, log } = capture();
  await sendResendEmail(email, send, log);
  assert.deepEqual(lines, []);
  assert.equal((sent[0]!.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(String(sent[0]!.body)), { from: email.from, to: ADDRESS, subject: email.subject, html: email.html });
});
