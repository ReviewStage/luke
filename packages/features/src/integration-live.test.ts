import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  type IntegrationStatusesAnswer,
  integrationLiveRowsOf,
  integrationStatusesOfLive,
} from "./integration-live.js";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  type IntegrationProvider,
} from "./integration-wire.js";

/**
 * Where each provider and account stands as the live read's rows say, as
 * the statuses read that settles nothing answers it: each row below and
 * what it draws is worked out by hand from that read
 * (`integrations-procedures.ts`'s `statusesAnswer`).
 */

const { GITHUB, GRANOLA, LINEAR, NOTION } = INTEGRATION_PROVIDER;

/** One row as the statement delivers it. */
function row(connection: string, provider: string, status: string, label?: string) {
  return { id: `id-${connection}`, connection, provider, label: label ?? null, status };
}

it.each<{
  readonly name: string;
  readonly rows: readonly unknown[];
  readonly offered: readonly string[];
  readonly multiple: readonly string[];
  readonly drawn: Partial<IntegrationStatusesAnswer["integrations"]>;
  readonly accounts: IntegrationStatusesAnswer["accounts"];
  readonly addable: IntegrationStatusesAnswer["addable"];
}>([
  {
    name: "a provider the account is not offered stands unavailable, its rows read as none",
    rows: [row(LINEAR, LINEAR, INTEGRATION_STATUS.CONNECTED)],
    offered: [GRANOLA],
    multiple: [],
    drawn: { [LINEAR]: INTEGRATION_STATUS.UNAVAILABLE, [GRANOLA]: INTEGRATION_STATUS.DISCONNECTED },
    accounts: undefined,
    addable: undefined,
  },
  {
    name: "a provider stands as its first account does, and every account is listed in its place's order",
    rows: [
      row("notion-2", NOTION, INTEGRATION_STATUS.PENDING, "Home"),
      row(NOTION, NOTION, INTEGRATION_STATUS.EXPIRED, ""),
      row("unknown", "outlook", INTEGRATION_STATUS.CONNECTED),
    ],
    offered: [NOTION, "outlook"],
    multiple: [],
    drawn: { [NOTION]: INTEGRATION_STATUS.EXPIRED },
    accounts: [
      { provider: NOTION, connection: NOTION, status: INTEGRATION_STATUS.EXPIRED },
      {
        provider: NOTION,
        connection: "notion-2",
        label: "Home",
        status: INTEGRATION_STATUS.PENDING,
      },
    ],
    addable: undefined,
  },
  {
    name: "a first sign-in that lapsed stands for nothing, and frees its place",
    rows: [row(GRANOLA, GRANOLA, INTEGRATION_STATUS.DISCONNECTED)],
    offered: [GRANOLA],
    multiple: [GRANOLA],
    drawn: { [GRANOLA]: INTEGRATION_STATUS.DISCONNECTED },
    accounts: undefined,
    addable: [GRANOLA],
  },
  {
    name: "a provider holding the most accounts may add none, and GitHub stands as its sign-in does",
    rows: [NOTION, "notion-2", "notion-3", "notion-4", "notion-5"].map((connection) =>
      row(connection, NOTION, INTEGRATION_STATUS.CONNECTED, connection),
    ),
    offered: [NOTION, GRANOLA],
    multiple: [NOTION, GRANOLA],
    drawn: { [NOTION]: INTEGRATION_STATUS.CONNECTED, [GITHUB]: INTEGRATION_STATUS.EXPIRED },
    accounts: [NOTION, "notion-2", "notion-3", "notion-4", "notion-5"].map((connection) => ({
      provider: NOTION,
      connection,
      label: connection,
      status: INTEGRATION_STATUS.CONNECTED,
    })),
    addable: [GRANOLA],
  },
])("$name", ({ rows, offered, multiple, drawn, accounts, addable }) => {
  const answer = integrationStatusesOfLive(
    integrationLiveRowsOf(rows),
    offered,
    multiple,
    INTEGRATION_STATUS.EXPIRED,
  );
  for (const [provider, status] of Object.entries(drawn)) {
    assert.equal(answer.integrations[provider as IntegrationProvider], status, provider);
  }
  assert.deepEqual(answer.accounts, accounts);
  assert.deepEqual(answer.addable, addable);
});
