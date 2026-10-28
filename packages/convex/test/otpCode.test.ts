/**
 * The email sign-in code is uniform over 100000-999999. `uint32 % 900000`
 * favoured the low codes by about 0.02%, because 2^32 is not a multiple of
 * 900000; values at or above the last whole multiple are now drawn again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateOtpCode, OTP_UNBIASED_LIMIT, type RandomFill } from "../src/auth/otpCode";

/** A random source that answers with the given values in turn, counting draws. */
function scripted(values: number[]): RandomFill & { draws: number } {
  const fill = ((array: Uint32Array) => {
    array[0] = values[fill.draws++]!;
    return array;
  }) as RandomFill & { draws: number };
  fill.draws = 0;
  return fill;
}

test("the limit is the largest multiple of 900000 below 2^32", () => {
  assert.equal(OTP_UNBIASED_LIMIT % 900_000, 0);
  assert.ok(OTP_UNBIASED_LIMIT <= 2 ** 32);
  assert.ok(OTP_UNBIASED_LIMIT + 900_000 > 2 ** 32);
});

test("a value in the biased tail is drawn again, never folded onto a low code", () => {
  const fill = scripted([OTP_UNBIASED_LIMIT, 2 ** 32 - 1, 123_456]);
  assert.equal(generateOtpCode(fill), "223456");
  assert.equal(fill.draws, 3);
});

test("values below the limit map onto the whole range, ends included", () => {
  assert.equal(generateOtpCode(scripted([0])), "100000");
  assert.equal(generateOtpCode(scripted([899_999])), "999999");
  assert.equal(generateOtpCode(scripted([OTP_UNBIASED_LIMIT - 1])), "999999");
});

test("every accepted value gives each code exactly the same number of preimages", () => {
  // Below the limit, each code has OTP_UNBIASED_LIMIT / 900000 preimages: no code is favoured.
  assert.equal(OTP_UNBIASED_LIMIT / 900_000, 4772);
});

test("with the real random source: six digits, in range, and spread out", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const code = generateOtpCode();
    assert.match(code, /^[1-9]\d{5}$/);
    seen.add(code);
  }
  assert.ok(seen.size > 1990, `only ${seen.size} distinct codes in 2000 draws`);
});
