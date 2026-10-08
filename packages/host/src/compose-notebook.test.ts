import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD } from "@sidecar/gateway";
import type { NotebookAnswer } from "@sidecar/hosted";
import { Effect } from "effect";
import { composeNotebook } from "./compose-notebook.js";

const NOTEBOOK: NotebookAnswer = {
  files: [{ path: "MEMORY.md", content: "# Memory\n", chars: 9, updatedAt: 1 }],
  omittedNotes: 0,
};

function harness(options: { sendsNetwork?: boolean; active?: boolean } = {}) {
  const calls: string[] = [];
  let answer: NotebookAnswer | undefined = NOTEBOOK;
  const composer = composeNotebook({
    runMode: { sendsNetwork: options.sendsNetwork ?? true },
    account: { capabilitiesActive: () => options.active ?? true },
    client: {
      notebook: () =>
        Effect.sync(() => {
          calls.push("notebook");
          return answer;
        }),
    },
  });
  const read = () => {
    const handler = composer.methods[GATEWAY_METHOD.NOTEBOOK_READ];
    assert.ok(handler);
    return handler({}, { client: { clientId: "test", role: GATEWAY_CLIENT_ROLE.OPERATOR } });
  };
  const unanswered = () => {
    answer = undefined;
  };
  return { read, calls, unanswered };
}

it.effect(
  "the notebook read carries the service's own record, and answers empty behind a closed gate or an unanswered call",
  () =>
    Effect.gen(function* () {
      const { read, calls, unanswered } = harness();
      assert.deepEqual(yield* read(), NOTEBOOK);
      assert.deepEqual(calls, ["notebook"]);

      // The service did not answer: an empty record, which the client reads as
      // unreadable just now rather than as a notebook with nothing in it.
      unanswered();
      assert.deepEqual(yield* read(), {});

      // A run that sends nothing, or an account whose capabilities are down,
      // never asks at all.
      const offline = harness({ sendsNetwork: false });
      assert.deepEqual(yield* offline.read(), {});
      const signedOut = harness({ active: false });
      assert.deepEqual(yield* signedOut.read(), {});
      assert.deepEqual(offline.calls, []);
      assert.deepEqual(signedOut.calls, []);
    }),
);
