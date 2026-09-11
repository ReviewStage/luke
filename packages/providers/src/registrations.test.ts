import assert from "node:assert/strict";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { PROVIDER_ID, PROVIDER_ID_LIST, PROVIDER_IDENTITY_BY_ID } from "@sidecar/session";
import { test } from "vitest";
import { providerDeclarations } from "./registrations.js";

const registrations = providerDeclarations({
  readApiKey: async () => undefined,
  observationHookInstallation: (providerId) => ({
    providerHome: `/missing/${providerId}`,
    hookScriptPath: `/missing/${providerId}-hook`,
    spoolDirectory: `/missing/${providerId}-spool`,
  }),
});

test("registers every provider exactly once", () => {
  assert.deepEqual(
    registrations.map((registration) => registration.plugin.provider.id).sort(),
    [...PROVIDER_ID_LIST].sort(),
  );
  for (const providerId of PROVIDER_ID_LIST) {
    const registration = registrations.find((entry) => entry.plugin.provider.id === providerId);
    assert.deepEqual(registration?.plugin.provider, {
      id: providerId,
      displayName: PROVIDER_IDENTITY_BY_ID[providerId].displayName,
    });
  }
});

test("declares credentials and observation hooks beside their adapters", () => {
  assert.deepEqual(
    registrations
      .flatMap((registration) => ("credential" in registration ? registration.credential.id : []))
      .sort(),
    [CREDENTIAL_PROVIDER_ID.CONDUCTOR],
  );
  assert.deepEqual(
    registrations
      .filter((registration) => "registerObservationHook" in registration)
      .map((registration) => registration.plugin.provider.id)
      .sort(),
    [PROVIDER_ID.CLAUDE_CODE, PROVIDER_ID.CODEX].sort(),
  );
});

test("every registration publishes a roster before it names any action", () => {
  for (const { plugin } of registrations) {
    assert.ok(plugin.observe instanceof Function);
    assert.ok(plugin.latest instanceof Function);
    // An absent handler is the unsupported answer, so what a registration
    // must have is the pass and the roster it publishes — never every action.
    assert.deepEqual(plugin.latest(), []);
  }
});
