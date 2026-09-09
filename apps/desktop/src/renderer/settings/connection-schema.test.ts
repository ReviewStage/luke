import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_AGENT_PROVIDER_LIST, CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  SUPERSET_WORKSPACE_PROVIDER_ID,
} from "@sidecar/session";
import { VOICE_SOURCE } from "@sidecar/settings/wire";
import {
  connectionInput,
  connectionVisibility,
  everyConnectionOffered,
} from "#testing/connection-fixtures";
import { settingsView } from "#testing/settings-fixtures";
import { SETTINGS_VIEW } from "../settings-views";
import {
  CONNECTION_SCHEMA,
  type ConnectionVisibility,
  offeredConnections,
} from "./connection-schema";

/** Local Conductor stands only where its own index reported a repository. */
function everything(): ConnectionVisibility {
  return {
    ...everyConnectionOffered(),
    workspaceProjects: [{ id: CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID, name: "Conductor (local)" }],
  };
}

test("a connection is named once, and lands where its own id says", () => {
  const ids = CONNECTION_SCHEMA.map((spec) => spec.id);
  assert.deepEqual([...new Set(ids)], ids, "two rows sharing an id would land one press on both");
  for (const spec of CONNECTION_SCHEMA) {
    assert.ok(spec.id.length > 0, "every row is somewhere a pressed result can land");
    assert.ok(spec.name(everything()).length > 0, spec.id);
  }
});

test("a section's rows stand in an order the table fixes rather than the literal's", () => {
  const places = new Map<string, Set<number>>();
  for (const spec of CONNECTION_SCHEMA) {
    const key = `${spec.page}/${spec.section}`;
    const orders = places.get(key) ?? new Set<number>();
    assert.equal(orders.has(spec.order), false, `${key} draws two rows at ${spec.order}`);
    orders.add(spec.order);
    places.set(key, orders);
  }
});

test("a build that can offer nothing draws no connection but the ones always there", () => {
  const offered = offeredConnections(connectionVisibility()).map((spec) => spec.id);
  // Codex is observed through a CLI this build always asks about, and every
  // cloud agent's key row is listed whether or not a key is stored — the list
  // is how you learn which services Luke can watch at all.
  assert.deepEqual(offered, [
    "codex-cloud",
    ...CLOUD_AGENT_PROVIDER_LIST.map((provider) => provider.id),
  ]);
});

test("every connection this build can offer stands when its condition is true", () => {
  const offered = offeredConnections(everything()).map((spec) => spec.id);
  for (const id of [
    CREDENTIAL_PROVIDER_ID.OPENAI,
    CREDENTIAL_PROVIDER_ID.LINEAR,
    SUPERSET_WORKSPACE_PROVIDER_ID,
    CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
    "apple-calendar",
    "google-calendar",
  ]) {
    assert.ok(offered.includes(id), id);
  }
});

test("the voice key's row stands with the half that supplies it, and nowhere else", () => {
  const spec = CONNECTION_SCHEMA.find((entry) => entry.page === SETTINGS_VIEW.VOICE);
  assert.ok(spec);
  assert.equal(spec.offered(everything()), true);
  // On the account, the section's own toggle is where a key is begun from, so
  // the row itself is not drawn — and is not offered by a search either.
  assert.equal(
    spec.offered(connectionVisibility({ accountDrawn: true, settings: settingsView() })),
    false,
    "the account half describes itself",
  );
  assert.equal(
    spec.offered(
      connectionVisibility({ settings: settingsView({ voiceSource: VOICE_SOURCE.KEY }) }),
    ),
    false,
    "no account, no Provider section",
  );
});

test("a connection made somewhere else offers no control that pretends otherwise", () => {
  // Codex connects by `codex login` in the user's own terminal, and local
  // Conductor by an index on disk. Both are declarations of having nothing to
  // press rather than an absence of code.
  for (const id of ["codex-cloud", CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID]) {
    const spec = CONNECTION_SCHEMA.find((entry) => entry.id === id);
    assert.ok(spec, id);
    assert.equal(spec.actions(connectionInput()).length, 0, id);
  }
});

test("at most one of a row's actions asks first", () => {
  for (const spec of CONNECTION_SCHEMA) {
    const asking = spec.actions(connectionInput()).filter((action) => action.confirm !== undefined);
    assert.ok(asking.length <= 1, `${spec.id} asks ${asking.length} questions in one cell`);
  }
});

test("every action either asks first or runs, and says which", () => {
  for (const spec of CONNECTION_SCHEMA) {
    for (const action of spec.actions(connectionInput())) {
      assert.equal(
        (action.confirm === undefined) !== (action.run === undefined),
        true,
        `${spec.id}: ${action.label}`,
      );
      assert.ok(action.label.length > 0, spec.id);
    }
  }
});

test("a query reads the connections in the order the page draws them", () => {
  // An entry's own `order` places it inside its section alone — the calendars'
  // 10 and 20 sit below the providers' 100 on the page — so results ordered by
  // `order` by itself would read in the reverse of what is drawn.
  const offered = offeredConnections(everything())
    .filter((spec) => spec.page === SETTINGS_VIEW.CONNECTIONS)
    .map((spec) => spec.id);
  assert.deepEqual(offered, [
    "codex-cloud",
    ...CLOUD_AGENT_PROVIDER_LIST.map((provider) => provider.id),
    CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
    SUPERSET_WORKSPACE_PROVIDER_ID,
    CREDENTIAL_PROVIDER_ID.LINEAR,
    "apple-calendar",
    "google-calendar",
  ]);
});
