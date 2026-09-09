import assert from "node:assert/strict";
import test from "node:test";
import { sharedInFlight } from "./screen-geometry";

test("concurrent reads share one probe, and a later read probes again", async () => {
  let readCount = 0;
  const pending: Array<(value: string) => void> = [];
  const read = sharedInFlight(
    () =>
      new Promise<string>((resolve) => {
        readCount += 1;
        pending.push(resolve);
      }),
  );

  const overlapping = [read(), read(), read()];
  assert.equal(readCount, 1);

  pending.shift()?.("first");
  assert.deepEqual(await Promise.all(overlapping), ["first", "first", "first"]);

  // The share lasts exactly as long as the read does: a caller after it settles
  // gets a fresh probe rather than an answer from before the display changed.
  const later = read();
  assert.equal(readCount, 2);
  pending.shift()?.("second");
  assert.equal(await later, "second");
});
