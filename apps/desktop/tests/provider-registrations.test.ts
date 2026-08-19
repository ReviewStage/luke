import assert from "node:assert/strict";
import test from "node:test";
import { PROVIDER_ID, PROVIDER_ID_LIST } from "@sidecar/core";
import { CodexCloudSessionAdapter } from "../src/codex-cloud-adapter";
import { providerRegistrations } from "../src/provider-registrations";
import { CREDENTIAL_PROVIDER_ID } from "../src/shared/credential-providers";

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
  assert.deepEqual(
    registrations.map(({ adapter }) => adapter.provider.id),
    PROVIDER_ID_LIST,
  );
  assert.equal(new Set(registrations.map(({ adapter }) => adapter.provider.id)).size, 8);
});

test("declares credentials and observation hooks beside their adapters", () => {
  const byProvider = new Map(registrations.map((entry) => [entry.adapter.provider.id, entry]));
  assert.equal(
    byProvider.get(PROVIDER_ID.CONDUCTOR)?.credential?.id,
    CREDENTIAL_PROVIDER_ID.CONDUCTOR,
  );
  assert.equal(byProvider.get(PROVIDER_ID.CURSOR)?.credential?.id, CREDENTIAL_PROVIDER_ID.CURSOR);
  assert.equal(typeof byProvider.get(PROVIDER_ID.CLAUDE_CODE)?.registerObservationHook, "function");
  assert.equal(typeof byProvider.get(PROVIDER_ID.CODEX)?.registerObservationHook, "function");
  assert.equal(byProvider.get(PROVIDER_ID.OPENCODE)?.credential, undefined);
});

test("every registration exposes the one total adapter interface", () => {
  for (const { adapter } of registrations) {
    assert.equal(typeof adapter.observe, "function");
    assert.equal(typeof adapter.readTranscript, "function");
    assert.equal(typeof adapter.sendMessage, "function");
    assert.equal(typeof adapter.executeControl, "function");
    assert.equal(typeof adapter.createWorkspace, "function");
    assert.equal(typeof adapter.spawnWorkspaceAgent, "function");
  }
});
