import assert from "node:assert/strict";
import { afterEach, it } from "@effect/vitest";
import { INTEGRATION_CALL_FAILURE } from "@luke/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@luke/features/integration-wire";
import { Effect } from "effect";
import type { ActSender } from "../act-router/router.js";
import { type ActPortClient, INTEGRATION_ACT_KIND } from "../contract/index.js";
import type { IntegrationProceduresDependencies } from "./index.js";
import {
  CALL,
  closeWindowPorts,
  openWindowPort,
  PANEL,
  settled,
  UNREACHED_DEPENDENCIES,
  VOICE,
} from "./testing.js";

/**
 * Settings' integration acts, through the act port as a window calls them:
 * only a panel of this build's own renderer asks; the voice and call
 * windows, and a frame this build does not trust, are refused in each
 * kind's own words before the host is asked; and a panel's ask reaches the
 * host, the status read with no payload at all.
 */

const LINEAR = { provider: INTEGRATION_PROVIDER.LINEAR } as const;
const RENAME = {
  provider: INTEGRATION_PROVIDER.LINEAR,
  connection: "linear-2",
  label: "Work",
} as const;

// SAFETY: the entries are built from INTEGRATION_PROVIDER_LIST, so every provider is a key.
const DISCONNECTED = Object.fromEntries(
  INTEGRATION_PROVIDER_LIST.map((provider) => [provider, INTEGRATION_STATUS.DISCONNECTED]),
) as Record<IntegrationProvider, IntegrationStatus>;

/** Each kind's refusal, as the window drew it before the kinds moved onto the port. */
const REFUSAL = {
  [INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS]: "Could not read your integrations on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT]: "Could not connect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS]:
    "Could not read that integration's tools on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL]:
    "Could not cancel connecting that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT]:
    "Could not disconnect that integration on this system.",
  [INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME]: "Could not rename that account on this system.",
} as const;

type Kind = keyof typeof REFUSAL;

/** One call of each kind, as a panel makes it. */
const ACTS: readonly { kind: Kind; call: (client: ActPortClient) => Promise<unknown> }[] = [
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS](),
  },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT](LINEAR),
  },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_TOOLS](LINEAR),
  },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_CANCEL](LINEAR),
  },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_DISCONNECT](LINEAR),
  },
  {
    kind: INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME,
    call: (client) => client[INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME](RENAME),
  },
];

afterEach(closeWindowPorts);

/** A window's act port over a host that answers each integration ask, and what it was asked, in order. */
function windowPort(actor: ActSender, trusted = true) {
  const asked: string[] = [];
  const host: IntegrationProceduresDependencies["host"] = {
    integrationsStatus: () =>
      Effect.sync(() => {
        asked.push("status");
        return { integrations: { ...DISCONNECTED, linear: INTEGRATION_STATUS.CONNECTED } };
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
        return { account: { provider, connection, label, status: INTEGRATION_STATUS.CONNECTED } };
      }),
  };
  const client = openWindowPort(
    { ...UNREACHED_DEPENDENCIES, integrations: { host } },
    actor,
    trusted,
  );
  return { client, asked };
}

it("the voice and call windows are refused every integration act in the kind's own words, and the host is not asked", async () => {
  for (const actor of [VOICE, CALL]) {
    const { client, asked } = windowPort(actor);
    for (const act of ACTS) {
      assert.deepEqual(await settled(() => act.call(client)), { refused: REFUSAL[act.kind] });
    }
    assert.deepEqual(asked, []);
  }
});

it("a frame this build does not trust is refused every integration act, even as a panel, and the host is not asked", async () => {
  const { client, asked } = windowPort(PANEL, false);
  for (const act of ACTS) {
    assert.deepEqual(await settled(() => act.call(client)), { refused: REFUSAL[act.kind] });
  }
  assert.deepEqual(asked, []);
});

it("a panel's ask reaches the host, and the host's answer is the panel's", async () => {
  const { client, asked } = windowPort(PANEL);

  assert.deepEqual(await settled(() => client[INTEGRATION_ACT_KIND.INTEGRATIONS_STATUS]()), {
    answer: { integrations: { ...DISCONNECTED, linear: INTEGRATION_STATUS.CONNECTED } },
  });
  assert.deepEqual(await settled(() => client[INTEGRATION_ACT_KIND.INTEGRATIONS_CONNECT](LINEAR)), {
    answer: { failure: INTEGRATION_CALL_FAILURE.NOT_OPENED },
  });
  assert.deepEqual(await settled(() => client[INTEGRATION_ACT_KIND.INTEGRATIONS_RENAME](RENAME)), {
    answer: {
      account: {
        provider: INTEGRATION_PROVIDER.LINEAR,
        connection: "linear-2",
        label: "Work",
        status: INTEGRATION_STATUS.CONNECTED,
      },
    },
  });
  assert.deepEqual(asked, ["status", "connect linear", "rename linear linear-2"]);
});
