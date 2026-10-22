import { expect, test } from "vitest";
import { stapleWithRetry } from "./release-config.mjs";

/** A staple that fails the first `failures` times it is tried, as Apple's ticket lookup can. */
function flakyStaple(failures) {
  const tried = { count: 0 };
  const staple = () => {
    tried.count += 1;
    if (tried.count <= failures)
      throw new Error("The staple and validate action failed! Error 68.");
    return "stapled";
  };
  return { staple, tried };
}

test("a staple that fails while Apple's ticket is on its way succeeds on a later try, after a wait each time", async () => {
  const { staple, tried } = flakyStaple(2);
  const waits = [];
  const result = await stapleWithRetry({
    staple,
    wait: (ms) => waits.push(ms),
    attempts: 6,
    intervalMs: 30_000,
  });
  expect([result, tried.count, waits]).toEqual(["stapled", 3, [30_000, 30_000]]);
});

test("a staple that never succeeds fails the release with Apple's own error once the attempts run out", async () => {
  const { staple, tried } = flakyStaple(Number.POSITIVE_INFINITY);
  await expect(
    stapleWithRetry({ staple, wait: () => {}, attempts: 3, intervalMs: 1 }),
  ).rejects.toThrow(/Error 68/);
  expect(tried.count).toBe(3);
});
