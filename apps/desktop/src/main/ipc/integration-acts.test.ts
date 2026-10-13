import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import { INTEGRATION_PROVIDER, INTEGRATION_STATUS } from "@sidecar/hosted/integration-wire";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "#shared/messages/acts";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { integrationActRows } from "./integration-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

function fixture() {
  const asked: string[] = [];
  const rows = integrationActRows({
    host: {
      integrationsStatus: () =>
        Effect.sync(() => {
          asked.push("status");
          return { integrations: { linear: INTEGRATION_STATUS.CONNECTED } };
        }),
      integrationsConnect: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`connect ${provider}`);
          return { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED };
        }),
      integrationsDisconnect: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`disconnect ${provider}`);
          return { status: INTEGRATION_STATUS.DISCONNECTED };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}

it.effect("the panel's integration acts carry the host's answers to it, whole", () =>
  Effect.gen(function* () {
    const { router, asked } = fixture();

    assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.INTEGRATIONS_STATUS }, PANEL), {
      status: ACT_OUTCOME_STATUS.DONE,
      value: { integrations: { linear: INTEGRATION_STATUS.CONNECTED } },
    });
    assert.deepEqual(
      yield* router.performAct({ kind: ACT_KIND.INTEGRATIONS_CONNECT, payload: LINEAR }, PANEL),
      { status: ACT_OUTCOME_STATUS.DONE, value: { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED } },
    );
    assert.deepEqual(
      yield* router.performAct({ kind: ACT_KIND.INTEGRATIONS_DISCONNECT, payload: LINEAR }, PANEL),
      { status: ACT_OUTCOME_STATUS.DONE, value: { status: INTEGRATION_STATUS.DISCONNECTED } },
    );
    assert.deepEqual(asked, ["status", "connect linear", "disconnect linear"]);
  }),
);

it.effect(
  "the voice and call windows are refused every integration act in the kind's own words, and the host is not asked",
  () =>
    Effect.gen(function* () {
      const { router, asked } = fixture();

      for (const sender of [VOICE, CALL]) {
        assert.deepEqual(yield* router.performAct({ kind: ACT_KIND.INTEGRATIONS_STATUS }, sender), {
          status: ACT_OUTCOME_STATUS.REFUSED,
          reason: ACT[ACT_KIND.INTEGRATIONS_STATUS].refusal,
        });
        for (const kind of [ACT_KIND.INTEGRATIONS_CONNECT, ACT_KIND.INTEGRATIONS_DISCONNECT]) {
          assert.deepEqual(yield* router.performAct({ kind, payload: LINEAR }, sender), {
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: ACT[kind].refusal,
          });
        }
      }
      assert.deepEqual(asked, []);
    }),
);
