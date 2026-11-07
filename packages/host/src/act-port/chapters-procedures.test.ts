import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { Effect } from "effect";
import { CHAPTERS_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { chaptersProcedures } from "./chapters-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * The Pull request tab's chapters acts, through the act port as a window
 * calls them: any other window than a panel, and a frame this build does
 * not trust, are refused in each kind's own words before the host or the
 * service is asked. Synthetic ids.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const AGENT_ID = "6b1f3c2e-9d4a-4f1b-8c7d-2e3f4a5b6c7d";

const RETRY = {
  kind: CHAPTERS_ACT_KIND.CHAPTERS_RETRY,
  payload: { agentId: AGENT_ID, number: 11 },
} as const;
const GENERATE = {
  kind: CHAPTERS_ACT_KIND.CHAPTERS_GENERATE,
  payload: { agentId: AGENT_ID },
} as const;

const RETRY_REFUSAL = "Could not read the pull request's chapters again on this system.";
const GENERATE_REFUSAL = "Could not generate the pull request's chapters on this system.";

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused in each kind's own words, and neither the host nor the service is asked",
  () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const held = testActPort<unknown>(
        chaptersProcedures({
          host: {
            chaptersFollow: () => Effect.sync(() => void asked.push("follow")),
            chaptersUnfollow: () => Effect.sync(() => void asked.push("unfollow")),
            chaptersRetry: () => Effect.sync(() => void asked.push("retry")),
          },
        }),
      );
      ports.push(held);
      const { port, requests } = yield* hostActPort();

      const refused = [];
      for (const { actor, trusted } of [
        { actor: OTHER_WINDOW, trusted: true },
        { actor: PANEL, trusted: false },
      ]) {
        refused.push(yield* held.perform(RETRY, actor, { trusted }));
        refused.push(yield* port.perform(GENERATE, actor, { trusted }));
      }

      assert.deepEqual(refused, [
        { refused: RETRY_REFUSAL },
        { refused: GENERATE_REFUSAL },
        { refused: RETRY_REFUSAL },
        { refused: GENERATE_REFUSAL },
      ]);
      assert.deepEqual(asked, []);
      assert.deepEqual(requests, []);
    }),
);
