import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { INTEGRATION_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";

/**
 * Settings' integration acts, through the act port as a window calls them:
 * only a panel of this build's own renderer asks; any other window, and a
 * frame this build does not trust, are refused in each kind's own words
 * before the service is asked. The integrations' live follows are held in
 * `live-follows.test.ts`.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: "Could not connect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL]:
    "Could not cancel connecting that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT]:
    "Could not disconnect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME]: "Could not rename that account on this system.",
  [INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE]: "Could not revoke that app on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

/** One ask of each kind, with a payload its schema takes. */
const ASKS: readonly { readonly kind: Kind; readonly payload?: WireBoundaryInput }[] = [
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT, payload: LINEAR },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL, payload: LINEAR },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT, payload: LINEAR },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME,
    payload: { ...LINEAR, connection: "linear-2", label: "Work" },
  },
  { kind: INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE, payload: { clientId: "client-claude" } },
];

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every integration act in the kind's own words, and the service is not asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const refused = [];
      for (const ask of ASKS) {
        refused.push(yield* port.perform(ask, OTHER_WINDOW));
        refused.push(yield* port.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.deepEqual(requests, []);
    }),
);
