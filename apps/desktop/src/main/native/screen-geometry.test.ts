import assert from "node:assert/strict";
import test from "node:test";
import type { NativeNotchGeometry } from "@sidecar/surface";
import { createCoalescedScreenGeometryReader } from "./screen-geometry";

const geometry = (displayId: number): Map<number, NativeNotchGeometry> =>
  new Map([
    [
      displayId,
      {
        displayId,
        safeAreaTop: 38,
        notchWidth: 210,
        hasNotch: true,
      },
    ],
  ]);

test("screen geometry reads are serial, coalesced, and latest-wins", async () => {
  let activeReads = 0;
  let maximumActiveReads = 0;
  let readCount = 0;
  const pendingReads: Array<(screens: Map<number, NativeNotchGeometry>) => void> = [];
  const readGeometry = createCoalescedScreenGeometryReader(
    () =>
      new Promise((resolve) => {
        readCount += 1;
        activeReads += 1;
        maximumActiveReads = Math.max(maximumActiveReads, activeReads);
        pendingReads.push((screens) => {
          activeReads -= 1;
          resolve(screens);
        });
      }),
  );

  const first = readGeometry();
  const second = readGeometry();
  const third = readGeometry();
  let resolved = false;
  void Promise.all([first, second, third]).then(() => {
    resolved = true;
  });

  assert.equal(readCount, 1);
  assert.equal(maximumActiveReads, 1);

  const stale = geometry(1);
  pendingReads.shift()?.(stale);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(readCount, 2);
  assert.equal(maximumActiveReads, 1);
  assert.equal(resolved, false);

  const newest = geometry(2);
  pendingReads.shift()?.(newest);
  const results = await Promise.all([first, second, third]);

  assert.equal(readCount, 2);
  assert.equal(maximumActiveReads, 1);
  assert.deepEqual(results, [newest, newest, newest]);
  assert.ok(results.every((result) => result !== stale));
});
