import assert from "node:assert/strict";
import test from "node:test";
import {
  CLI_LOGIN_CONNECTION_IDS,
  CONNECTION_ID,
  CONNECTION_KIND,
  CONNECTION_LIST,
  CONNECTIONS,
  CONSENT_CONNECTION_IDS,
  type ConnectionDeclaration,
  connectionDeclaration,
  isConnectionId,
} from "./connections.js";
import { CREDENTIAL_PROVIDER_LIST, VOICE_CREDENTIAL_PROVIDER_ID } from "./credential-providers.js";

const declarations: readonly ConnectionDeclaration[] = Object.values(CONNECTIONS);

test("every credential provider is declared exactly once, under its own kind", () => {
  for (const provider of CREDENTIAL_PROVIDER_LIST) {
    const rows = declarations.filter((connection) => connection.credential?.id === provider.id);
    assert.equal(rows.length, 1, provider.id);
    assert.equal(rows[0]?.id, provider.id);
    assert.equal(rows[0]?.kind, provider.connection);
  }
  assert.equal(
    connectionDeclaration(VOICE_CREDENTIAL_PROVIDER_ID).section,
    "voice",
    "the voice key's row is drawn on the Voice page",
  );
});

test("a CLI login is declared if and only if the row's kind is a CLI login", () => {
  for (const connection of declarations) {
    assert.equal(
      connection.cliLogin !== undefined,
      connection.kind === CONNECTION_KIND.CLI_LOGIN,
      connection.id,
    );
    assert.equal(
      connection.credential !== undefined,
      connection.kind === CONNECTION_KIND.KEY || connection.kind === CONNECTION_KIND.CONSENT,
      connection.id,
    );
  }
  assert.deepEqual(
    declarations.filter((c) => c.kind === CONNECTION_KIND.CLI_LOGIN).map((c) => c.id),
    CLI_LOGIN_CONNECTION_IDS,
  );
  assert.deepEqual(
    declarations.filter((c) => c.kind === CONNECTION_KIND.CONSENT).map((c) => c.id),
    CONSENT_CONNECTION_IDS,
  );
});

test("a nested row hangs under a row of its own section", () => {
  for (const connection of declarations) {
    if (!connection.nestsUnder) continue;
    const parent = connectionDeclaration(connection.nestsUnder);
    assert.equal(parent.section, connection.section, connection.id);
    assert.equal(parent.nestsUnder, undefined, connection.id);
  }
});

test("the settings order is pinned", () => {
  assert.deepEqual(
    CONNECTION_LIST.map((connection) => connection.id),
    [
      CONNECTION_ID.CODEX,
      CONNECTION_ID.CONDUCTOR,
      CONNECTION_ID.CONDUCTOR_LOCAL,
      CONNECTION_ID.SUPERSET,
      CONNECTION_ID.LINEAR,
      CONNECTION_ID.OPENAI,
    ],
  );
  assert.equal(CONNECTION_LIST.length, declarations.length);
});

test("guards an id arriving over the bridge", () => {
  assert.equal(isConnectionId(CONNECTION_ID.SUPERSET), true);
  assert.equal(isConnectionId("toString"), false);
  assert.equal(isConnectionId("github"), false);
});
