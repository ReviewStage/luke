import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import { PROVIDER_ID, PROVIDER_ID_LIST, PROVIDER_IDENTITY_BY_ID } from "@sidecar/session";
import { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { providerRegistrations } from "./registrations.js";

const registrations = providerRegistrations({
  readApiKey: async () => undefined,
  // A runner that answers signed-out, so no test can spawn a real CLI.
  codexCloudAdapter: new CodexCloudSessionAdapter({
    run: async () => ({ exitCode: 1, stdout: "" }),
  }),
  observationHookInstallation: (providerId) => ({
    providerHome: `/missing/${providerId}`,
    hookScriptPath: `/missing/${providerId}-hook`,
    spoolDirectory: `/missing/${providerId}-spool`,
  }),
});

test("registers every provider exactly once", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    assert.deepEqual(registrations[providerId].adapter.provider, {
      id: providerId,
      displayName: PROVIDER_IDENTITY_BY_ID[providerId].displayName,
    });
  }
});

test("declares credentials and observation hooks beside their adapters", () => {
  assert.deepEqual(
    Object.values(registrations)
      .flatMap((registration) => ("credential" in registration ? registration.credential.id : []))
      .sort(),
    [
      CREDENTIAL_PROVIDER_ID.CONDUCTOR,
      CREDENTIAL_PROVIDER_ID.COPILOT,
      CREDENTIAL_PROVIDER_ID.CURSOR,
      CREDENTIAL_PROVIDER_ID.DEVIN,
      CREDENTIAL_PROVIDER_ID.JULES,
      CREDENTIAL_PROVIDER_ID.REPLICAS,
    ].sort(),
  );
  assert.deepEqual(
    Object.entries(registrations)
      .filter(([, registration]) => "registerObservationHook" in registration)
      .map(([providerId]) => providerId)
      .sort(),
    [
      PROVIDER_ID.CLAUDE_CODE,
      PROVIDER_ID.CODEX,
      PROVIDER_ID.CURSOR,
      PROVIDER_ID.DEVIN,
      PROVIDER_ID.GEMINI_CLI,
      PROVIDER_ID.OPENCODE,
    ].sort(),
  );
});

test("every registration exposes the one total adapter interface", () => {
  for (const { adapter } of Object.values(registrations)) {
    assert.ok(adapter.observe instanceof Function);
    assert.ok(adapter.readTranscript instanceof Function);
    assert.ok(adapter.sendMessage instanceof Function);
    assert.ok(adapter.executeControl instanceof Function);
    assert.ok(adapter.createWorkspace instanceof Function);
    assert.ok(adapter.spawnWorkspaceAgent instanceof Function);
  }
});
