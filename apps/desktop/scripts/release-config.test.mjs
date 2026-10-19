import { expect, test } from "vitest";
import { stapleWithRetry } from "./release-config.mjs";

/** A staple that fails its first `failures` tries, as Apple's ticket lookup can, and names the try in what it answers. */
function flakyStaple(failures) {
  let tries = 0;
  return () => {
    tries += 1;
    if (tries <= failures) throw new Error(`Error 68 on try ${tries}`);
    return `stapled on try ${tries}`;
  };
}

test("a staple that fails while Apple's ticket is on its way succeeds on a later try, after a wait each time", async () => {
  const waits = [];
  const result = await stapleWithRetry({
    staple: flakyStaple(2),
    wait: (ms) => waits.push(ms),
    attempts: 6,
    intervalMs: 30_000,
  });
  expect([result, waits]).toEqual(["stapled on try 3", [30_000, 30_000]]);
});

test("a staple that never succeeds fails the release with Apple's error from its last try", async () => {
  await expect(
    stapleWithRetry({
      staple: flakyStaple(Number.POSITIVE_INFINITY),
      wait: () => {},
      attempts: 3,
      intervalMs: 1,
    }),
  ).rejects.toThrow("Error 68 on try 3");
});
