import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import { PROVIDER_ID, PROVIDER_ID_LIST } from "@sidecar/session";
import { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { providerRegistrations } from "./registrations.js";

const registrations = providerRegistrations({
  readApiKey: async () => undefined,
  // A runner that answers signed-out, so no test can spawn a real CLI.
  codexCloudAdapter: new CodexCloudSessionAdapter({
    run: async () => ({ exitCode: 1, stdout: "" }),
  }),
  claudeHookInstallation: () => ({
    claudeHome: "/missing/claude",
    hookScriptPath: "/missing/claude-hook",
    spoolDirectory: "/missing/claude-spool",
  }),
  codexHookInstallation: () => ({
    codexHome: "/missing/codex",
    hookScriptPath: "/missing/codex-hook",
    spoolDirectory: "/missing/codex-spool",
  }),
});

test("registers every provider exactly once", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    assert.equal(registrations[providerId].adapter.provider.id, providerId);
  }
});

test("declares credentials and observation hooks beside their adapters", () => {
  assert.equal(
    registrations[PROVIDER_ID.CONDUCTOR].credential?.id,
    CREDENTIAL_PROVIDER_ID.CONDUCTOR,
  );
  assert.equal(registrations[PROVIDER_ID.CURSOR].credential?.id, CREDENTIAL_PROVIDER_ID.CURSOR);
  assert.ok(registrations[PROVIDER_ID.CLAUDE_CODE].registerObservationHook instanceof Function);
  assert.ok(registrations[PROVIDER_ID.CODEX].registerObservationHook instanceof Function);
  assert.equal("credential" in registrations[PROVIDER_ID.OPENCODE], false);
  assert.equal("credential" in registrations[PROVIDER_ID.GEMINI_CLI], false);
  assert.equal("registerObservationHook" in registrations[PROVIDER_ID.GEMINI_CLI], false);
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
