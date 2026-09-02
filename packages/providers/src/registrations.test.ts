import assert from "node:assert/strict";
import test from "node:test";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials/vocabulary";
import {
  PROVIDER_ID,
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderId,
} from "@sidecar/session";
import { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { providerRegistrations } from "./registrations.js";
import {
  ADAPTER_DIAGNOSTIC_KIND,
  type AdapterDiagnosticKind,
} from "./shared/adapter-diagnostics.js";

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
    [CREDENTIAL_PROVIDER_ID.CONDUCTOR],
  );
  assert.deepEqual(
    Object.entries(registrations)
      .filter(([, registration]) => "registerObservationHook" in registration)
      .map(([providerId]) => providerId)
      .sort(),
    [PROVIDER_ID.CLAUDE_CODE, PROVIDER_ID.CODEX].sort(),
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

test("a diagnostic reported by a cloud adapter reaches the callback tagged with its provider", () => {
  const diagnostics: { providerId: ProviderId; kind: AdapterDiagnosticKind; message: string }[] =
    [];
  const tagged = providerRegistrations({
    readApiKey: async () => undefined,
    codexCloudAdapter: new CodexCloudSessionAdapter({
      run: async () => ({ exitCode: 1, stdout: "" }),
    }),
    observationHookInstallation: (providerId) => ({
      providerHome: `/missing/${providerId}`,
      hookScriptPath: `/missing/${providerId}-hook`,
      spoolDirectory: `/missing/${providerId}-spool`,
    }),
    onDiagnostic: (providerId, kind, error) =>
      diagnostics.push({ providerId, kind, message: error.message }),
  });

  const report = (providerId: ProviderId) => {
    // SAFETY: the adapter named below extends CloudSessionAdapter, whose
    // protected `reportDiagnostic` is exactly this signature; reaching the
    // seam directly is the narrowest way to prove the closure tags its own
    // provider, since a real report needs a live pass.
    const adapter = tagged[providerId].adapter as unknown as {
      reportDiagnostic(kind: AdapterDiagnosticKind, error: Error): void;
    };
    adapter.reportDiagnostic(ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE, new Error(providerId));
  };
  report(PROVIDER_ID.CONDUCTOR);

  assert.deepEqual(diagnostics, [
    {
      providerId: PROVIDER_ID.CONDUCTOR,
      kind: ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE,
      message: PROVIDER_ID.CONDUCTOR,
    },
  ]);
});
