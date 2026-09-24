"use strict";

/**
 * Line counting and binary detection.
 *
 * Line count matches `wc -l` for any file that ends with a trailing
 * newline (the count of `\n` bytes). A file whose last line has no
 * trailing newline still has that line counted — `wc -l` would silently
 * drop it, which under-counts exactly the kind of hand-edited file this
 * tool exists to flag, so we add 1 for a non-empty file that doesn't end
 * in `\n`. This is a deliberate, documented departure from raw `wc -l`.
 */

const BINARY_SNIFF_BYTES = 8192;

/** True if the buffer looks binary: a NUL byte in the first 8 KB. */
function isBinary(buf) {
  const len = Math.min(buf.length, BINARY_SNIFF_BYTES);
  for (let i = 0; i < len; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Counts physical lines and the longest line's character length.
 * Returns { lineCount, maxLineLength }.
 */
function countLines(buf) {
  const text = buf.toString("utf8");
  if (text.length === 0) return { lineCount: 0, maxLineLength: 0 };

  let lineCount = 0;
  let maxLineLength = 0;
  let currentLength = 0;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      lineCount++;
      if (currentLength > maxLineLength) maxLineLength = currentLength;
      currentLength = 0;
    } else {
      currentLength++;
    }
  }

  // Trailing partial line with no newline: still a real line.
  if (currentLength > 0) {
    lineCount++;
    if (currentLength > maxLineLength) maxLineLength = currentLength;
  }

  return { lineCount, maxLineLength };
}

module.exports = { isBinary, countLines };
