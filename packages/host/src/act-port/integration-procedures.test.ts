import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import type { WireBoundaryInput } from "@repo/wire";
import { Effect } from "effect";
import { INTEGRATION_ACT_KIND } from "../contract/index.js";
import { hostActPort } from "../testing/host-act-port.js";
import type { ActSender } from "./base.js";
import { integrationProcedures } from "./integration-procedures.js";
import { type TestActPort, testActPort } from "./testing.js";

/**
 * Settings' integration acts, through the act port as a window calls them:
 * only a panel of this build's own renderer asks; any other window, and a
 * frame this build does not trust, are refused in each kind's own words
 * before the host or the service is asked; and a panel's Try again on the
 * held integrations reaches the host with no payload at all.
 */

// The platform's handle on the window that asked, which no procedure here reads.
const SENDER = Symbol("window");

const PANEL: ActSender = { sender: SENDER, panel: true };
const OTHER_WINDOW: ActSender = { ...PANEL, panel: false };

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY]:
    "Could not read your integrations again on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY]:
    "Could not read that integration's tools again on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: "Could not connect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL]:
    "Could not cancel connecting that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT]:
    "Could not disconnect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME]: "Could not rename that account on this system.",
  [INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE]: "Could not revoke that app on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

/** The kinds the integrations' own procedures answer, the rest declared and answered by the composer. */
const BY_HAND: ReadonlySet<Kind> = new Set([
  INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY,
  INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY,
]);

/** One ask of each kind, with a payload its schema takes. */
const ASKS: readonly { readonly kind: Kind; readonly payload?: WireBoundaryInput }[] = [
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS_RETRY, payload: LINEAR },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT, payload: LINEAR },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL, payload: LINEAR },
  { kind: INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT, payload: LINEAR },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME,
    payload: { ...LINEAR, connection: "linear-2", label: "Work" },
  },
  { kind: INTEGRATION_ACT_KIND.MCP_CLIENTS_REVOKE, payload: { clientId: "client-claude" } },
];

const ports: TestActPort<unknown>[] = [];

afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

/** The holds' act port over a host that writes down what it was asked, in order. */
function heldPort() {
  const asked: string[] = [];
  const noted = (what: string) => () => Effect.sync(() => void asked.push(what));
  const port = testActPort<unknown>(
    integrationProcedures({
      host: {
        integrationsFollow: noted("follow"),
        integrationsUnfollow: noted("unfollow"),
        integrationsRetry: noted("retry"),
        integrationsToolsFollow: noted("tools"),
        integrationsToolsUnfollow: noted("tools let go"),
        integrationsToolsRetry: noted("tools again"),
        mcpClientsFollow: noted("follow clients"),
        mcpClientsUnfollow: noted("unfollow clients"),
        mcpClientsRetry: noted("retry clients"),
      },
    }),
  );
  ports.push(port);
  return { port, asked };
}

it.effect("a panel's Try again on the held integrations reaches the host with no payload", () =>
  Effect.gen(function* () {
    const { port, asked } = heldPort();

    assert.deepEqual(
      yield* port.perform({ kind: INTEGRATION_ACT_KIND.INTEGRATIONS_RETRY }, PANEL),
      { answer: undefined },
    );
    assert.deepEqual(asked, ["retry"]);
  }),
);

it.effect(
  "a window that is not a panel, and a frame this build does not trust, are refused every integration act in the kind's own words, and neither the host nor the service is asked",
  () =>
    Effect.gen(function* () {
      const { port, requests } = yield* hostActPort();
      const held = heldPort();
      const refused = [];
      for (const ask of ASKS) {
        const served = BY_HAND.has(ask.kind) ? held.port : port;
        refused.push(yield* served.perform(ask, OTHER_WINDOW));
        refused.push(yield* served.perform(ask, PANEL, { trusted: false }));
      }

      assert.deepEqual(
        refused,
        ASKS.flatMap((ask) => [{ refused: REFUSAL[ask.kind] }, { refused: REFUSAL[ask.kind] }]),
      );
      assert.deepEqual(held.asked, []);
      assert.deepEqual(requests, []);
    }),
);
