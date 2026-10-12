import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LINEAR_CALL_FAILURE } from "@sidecar/hosted/linear-view";
import { LINEAR_STATUS } from "@sidecar/hosted/linear-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { linearActRows } from "./linear-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

function fixture() {
  const asked: string[] = [];
  const rows = linearActRows({
    host: {
      linearStatus: () =>
        Effect.sync(() => {
          asked.push("status");
          return { status: LINEAR_STATUS.CONNECTED };
        }),
      linearConnect: () =>
        Effect.sync(() => {
          asked.push("connect");
          return { failure: LINEAR_CALL_FAILURE.NOT_OPENED };
        }),
      linearDisconnect: () =>
        Effect.sync(() => {
          asked.push("disconnect");
          return { status: LINEAR_STATUS.DISCONNECTED };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}

it.effect("the panel's Linear acts carry the host's answers to it, whole", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.LINEAR_STATUS }, PANEL), {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { status: LINEAR_STATUS.CONNECTED },
    });
    assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.LINEAR_CONNECT }, PANEL), {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { failure: LINEAR_CALL_FAILURE.NOT_OPENED },
    });
    assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.LINEAR_DISCONNECT }, PANEL), {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { status: LINEAR_STATUS.DISCONNECTED },
    });
    assert.deepEqual(asked, ["status", "connect", "disconnect"]);
  }),
);

it.effect(
  "the voice and call windows are refused every Linear act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      for (const sender of [VOICE, CALL]) {
        for (const kind of [
          ACT_KIND.LINEAR_STATUS,
          ACT_KIND.LINEAR_CONNECT,
          ACT_KIND.LINEAR_DISCONNECT,
        ]) {
          assert.deepEqual(yield* router.performAct({ kind }, sender), {
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: ACT[kind].refusal,
          });
        }
      }
      assert.deepEqual(asked, []);
    }),
);
