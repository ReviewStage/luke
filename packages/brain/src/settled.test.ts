import assert from "node:assert/strict";
import { drainMicrotasks } from "@sidecar/runtime/testing";
import { describe, it } from "vitest";
import { claimedUnlessAborted, settledUnlessAborted } from "./settled.js";

const whileWatchingRejections = async (body: () => Promise<void>): Promise<readonly unknown[]> => {
  const unhandled: unknown[] = [];
  const record: NodeJS.UnhandledRejectionListener = (reason) => {
    unhandled.push(reason);
  };
  process.on("unhandledRejection", record);
  try {
    await body();
    await drainMicrotasks();
  } finally {
    process.off("unhandledRejection", record);
  }
  return unhandled;
};

const abortedSignal = (): AbortSignal => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};

describe("settledUnlessAborted", () => {
  it("answers aborted on a signal that had already fired", async () => {
    assert.deepEqual(await settledUnlessAborted(Promise.resolve("answer"), abortedSignal()), {
      aborted: true,
    });
  });

  it("carries the promise's own rejection", async () => {
    const failure = new Error("refused");

    const caught = await settledUnlessAborted(
      Promise.reject(failure),
      new AbortController().signal,
    ).then(
      () => undefined,
      (error: Error) => error,
    );

    assert.equal(caught, failure);
  });

  it("observes a rejection it never waits on, so none goes unhandled", async () => {
    const unhandled = await whileWatchingRejections(async () => {
      const settled = await settledUnlessAborted(
        Promise.reject(new Error("refused")),
        abortedSignal(),
      );
      assert.deepEqual(settled, { aborted: true });
    });

    assert.deepEqual(unhandled, []);
  });
});

describe("claimedUnlessAborted", () => {
  it("observes a rejection it never claims, so none goes unhandled", async () => {
    const discarded: string[] = [];

    const unhandled = await whileWatchingRejections(async () => {
      const settled = await claimedUnlessAborted<string>(
        Promise.reject(new Error("refused")),
        abortedSignal(),
        (value) => discarded.push(value),
      );
      assert.deepEqual(settled, { aborted: true });
    });

    assert.deepEqual({ unhandled, discarded }, { unhandled: [], discarded: [] });
  });

  it("hands a value arriving after the abort to the discard", async () => {
    const discarded: string[] = [];

    await whileWatchingRejections(async () => {
      const settled = await claimedUnlessAborted(
        Promise.resolve("held"),
        abortedSignal(),
        (value) => discarded.push(value),
      );
      assert.deepEqual(settled, { aborted: true });
    });

    assert.deepEqual(discarded, ["held"]);
  });
});
