import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@luke/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { ACT, ACT_KIND, ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { Effect } from "effect";
import type { WebContents } from "electron";
import { type ActRows, type ActSender, createActRouter } from "../act-router";
import { integrationActRows } from "./integration-acts";

// SAFETY: the router reads the sender by identity alone; one inert object is one window.
const SENDER = {} as WebContents;

const PANEL: ActSender = { sender: SENDER, panel: true, voice: false, call: false };
const VOICE: ActSender = { ...PANEL, panel: false, voice: true };
const CALL: ActSender = { ...PANEL, panel: false, call: true };

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const DISCONNECTED = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.DISCONNECTED]),
) as Record<IntegrationProvider, IntegrationStatus>;

function fixture() {
  const asked: string[] = [];
  const rows = integrationActRows({
    host: {
      integrationsStatus: () =>
        Effect.sync(() => {
          asked.push("status");
          return {
            integrations: { ...DISCONNECTED, linear: INTEGRATION_STATUS.CONNECTED },
          };
        }),
      integrationsConnect: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`connect ${provider}`);
          return { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED };
        }),
      integrationsTools: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`tools ${provider}`);
          return { tools: [{ name: "list_issues", description: "List issues." }] };
        }),
      integrationsCancel: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`cancel ${provider}`);
          return { status: INTEGRATION_STATUS.DISCONNECTED };
        }),
      integrationsDisconnect: ({ provider }) =>
        Effect.sync(() => {
          asked.push(`disconnect ${provider}`);
          return { status: INTEGRATION_STATUS.DISCONNECTED };
        }),
      integrationsRename: ({ provider, connection, label }) =>
        Effect.sync(() => {
          asked.push(`rename ${provider} ${connection}`);
          return {
            account: {
              provider,
              connection,
              label,
              status: INTEGRATION_STATUS.CONNECTED,
            },
          };
        }),
    },
  });
  // SAFETY: the router dispatches on the kind alone; the rows under test are the only ones reached.
  const router = createActRouter(rows as ActRows);
  return { router, asked };
}
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
        for (const kind of [
          ACT_KIND.INTEGRATIONS_CONNECT,
          ACT_KIND.INTEGRATIONS_CANCEL,
          ACT_KIND.INTEGRATIONS_DISCONNECT,
          ACT_KIND.INTEGRATIONS_TOOLS,
        ]) {
          assert.deepEqual(yield* router.performAct({ kind, payload: LINEAR }, sender), {
            status: ACT_OUTCOME_STATUS.REFUSED,
            reason: ACT[kind].refusal,
          });
        }
      }
      assert.deepEqual(asked, []);
    }),
);
