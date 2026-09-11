import assert from "node:assert/strict";
import { test } from "vitest";
import { singleFlight } from "./single-flight.js";

test("concurrent refresh asks share one in-flight run, so a rotated token is never spent twice", async () => {
  let runs = 0;
  let release: (() => void) | undefined;
  const refresh = singleFlight(
    () =>
      new Promise<void>((resolve) => {
        runs += 1;
        release = resolve;
      }),
  );

  const first = refresh();
  const second = refresh();
  assert.equal(runs, 1);

  release?.();
  await Promise.all([first, second]);

  // A finished flight is over: the next ask holds the newly rotated token and
  // may start a refresh of its own.
  const third = refresh();
  assert.equal(runs, 2);
  release?.();
  await third;
});

test("a failed flight rejects every waiter and still ends, so the next ask can try again", async () => {
  let runs = 0;
  const refresh = singleFlight(async () => {
    runs += 1;
    throw new Error("token endpoint unreachable");
  });

  const first = refresh();
  const second = refresh();
  await assert.rejects(first, /unreachable/);
  await assert.rejects(second, /unreachable/);
  assert.equal(runs, 1);

  await assert.rejects(refresh(), /unreachable/);
  assert.equal(runs, 2);
});
