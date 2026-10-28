/**
 * Six-digit sign-in codes, every value from 100000 to 999999 equally likely.
 *
 * A 32-bit random value taken `% 900000` favours the low codes slightly,
 * because 2^32 is not a multiple of 900000. Values at or above the largest
 * multiple are drawn again instead (rejection sampling), so what remains maps
 * onto the codes evenly. A redraw happens about once in 25,000 codes.
 */

const SPAN = 900_000;
/** The largest multiple of SPAN that fits in 32 bits: values below it map evenly. */
export const OTP_UNBIASED_LIMIT = Math.floor(0x1_0000_0000 / SPAN) * SPAN;

/** Fills an array with cryptographically secure random values, like `crypto.getRandomValues`. */
export type RandomFill = (array: Uint32Array) => Uint32Array;

const secureFill: RandomFill = (array) => crypto.getRandomValues(array);

export function generateOtpCode(fill: RandomFill = secureFill): string {
  const draw = new Uint32Array(1);
  for (;;) {
    fill(draw);
    if (draw[0] < OTP_UNBIASED_LIMIT) return (100_000 + (draw[0] % SPAN)).toString();
  }
}
