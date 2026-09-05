import assert from "node:assert/strict";
import test from "node:test";
import {
  CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID,
  type ProviderSessionObservation,
  type SessionProvider,
  SessionProviderAdapterBase,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  WORKSPACE_PROVIDER_ID_LIST,
} from "@sidecar/session";
import { workspaceProviderCapabilities } from "./capabilities.js";
import { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import {
  providerRegistrations,
  REGISTRATION_OBSERVATION,
  registrationObservation,
  workspaceProviderRegistrations,
} from "./registrations.js";
import { implementedActs } from "./testing/adapter-acts.js";

class StubSupersetWorkspaceAdapter extends SessionProviderAdapterBase {
  readonly provider: SessionProvider = {
    id: SUPERSET_WORKSPACE_PROVIDER_ID,
    displayName: "Superset",
  };

  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return [];
  }
}

const registrations = workspaceProviderRegistrations({
  registrations: providerRegistrations({
    readApiKey: async () => undefined,
    codexCloudAdapter: new CodexCloudSessionAdapter({
      run: async () => ({ exitCode: 1, stdout: "" }),
    }),
    observationHookInstallation: (providerId) => ({
      providerHome: `/missing/${providerId}`,
      hookScriptPath: `/missing/${providerId}-hook`,
      spoolDirectory: `/missing/${providerId}-spool`,
    }),
  }),
  supersetWorkspace: new StubSupersetWorkspaceAdapter(),
  openExternal: async () => {},
});

test("registers every workspace provider exactly once under its own id", () => {
  assert.deepEqual(Object.keys(registrations).sort(), [...WORKSPACE_PROVIDER_ID_LIST].sort());
  for (const providerId of WORKSPACE_PROVIDER_ID_LIST) {
    assert.equal(registrations[providerId].adapter.provider.id, providerId);
  }
});

test("local Conductor observes nothing and refreshes its repositories each pass", () => {
  const conductorLocal = registrations[CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID];
  assert.equal(registrationObservation(conductorLocal), REGISTRATION_OBSERVATION.NONE);
  assert.equal(conductorLocal.refresh?.failureLabel, "Conductor repository observation");
  assert.ok(conductorLocal.refresh?.run instanceof Function);
});

test("Superset's rows arrive decorated and the observed providers host-enriched", () => {
  assert.equal(
    registrationObservation(registrations[SUPERSET_WORKSPACE_PROVIDER_ID]),
    REGISTRATION_OBSERVATION.DECORATED,
  );
  for (const providerId of WORKSPACE_PROVIDER_ID_LIST) {
    if (
      providerId === SUPERSET_WORKSPACE_PROVIDER_ID ||
      providerId === CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID
    ) {
      continue;
    }
    assert.equal(
      registrationObservation(registrations[providerId]),
      REGISTRATION_OBSERVATION.HOST_ENRICHED,
      providerId,
    );
  }
});

test("local Conductor's adapter implements exactly the acts its declaration lists", () => {
  assert.deepEqual(
    implementedActs(registrations[CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID].adapter),
    new Set(workspaceProviderCapabilities(CONDUCTOR_LOCAL_WORKSPACE_PROVIDER_ID).acts),
  );
});
