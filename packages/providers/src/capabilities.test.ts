import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CONNECTION_KIND, type ConnectionKind } from "@sidecar/credentials/connections";
import { CLOUD_AGENT_PROVIDER_LIST } from "@sidecar/credentials/vocabulary";
import {
  CompositeSessionProviderAdapter,
  PROVIDER_ID_LIST,
  PROVIDER_IDENTITY_BY_ID,
  type ProviderId,
  type SessionProviderAdapter,
  WORKSPACE_AGENT_MODELS,
} from "@sidecar/session";
import {
  providerCapabilities as capabilities,
  PROVIDER_ACT,
  type ProviderAct,
  providersWithAct,
} from "./capabilities.js";
import { CodexCloudSessionAdapter } from "./codex/cloud-adapter.js";
import { OBSERVATION_HOOK_PROVIDER_IDS } from "./hook-registry.js";
import { type ProviderRegistration, providerRegistrations } from "./registrations.js";
import { CliSessionAdapter } from "./shared/cli-session-adapter.js";
import { implementedActs } from "./testing/adapter-acts.js";

const registrations = providerRegistrations({
  readApiKey: async () => undefined,
  codexCloudAdapter: new CodexCloudSessionAdapter({
    run: async () => ({ exitCode: 1, stdout: "" }),
  }),
  observationHookInstallation: (providerId) => ({
    providerHome: `/missing/${providerId}`,
    hookScriptPath: `/missing/${providerId}-hook`,
    spoolDirectory: `/missing/${providerId}-spool`,
  }),
});

function declaredActs(providerId: ProviderId): ReadonlySet<ProviderAct> {
  return new Set(capabilities(providerId).acts);
}

function isCliLoginAdapter(adapter: SessionProviderAdapter): boolean {
  if (adapter instanceof CompositeSessionProviderAdapter) {
    return adapter.members.some(isCliLoginAdapter);
  }
  return adapter instanceof CliSessionAdapter;
}

test("every provider's declared acts are exactly the seams its adapter overrides", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    assert.deepEqual(
      implementedActs(registrations[providerId].adapter),
      declaredActs(providerId),
      providerId,
    );
  }
});

test("the declared credential matches the registration and the adapter", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    const registration: ProviderRegistration = registrations[providerId];
    const declared: ConnectionKind = capabilities(providerId).credential;
    const stored =
      registration.credential !== undefined ? registration.credential.connection : undefined;
    const cliLogin = isCliLoginAdapter(registration.adapter);
    if (declared === CONNECTION_KIND.KEY || declared === CONNECTION_KIND.CONSENT) {
      assert.equal(stored, declared, providerId);
      assert.equal(cliLogin, false, providerId);
    } else if (declared === CONNECTION_KIND.CLI_LOGIN) {
      assert.equal(stored, undefined, providerId);
      assert.equal(cliLogin, true, providerId);
    } else {
      assert.equal(stored, undefined, providerId);
      assert.equal(cliLogin, false, providerId);
    }
  }
});

test("the declared observation hook matches the registration and the hook table", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    const declared = capabilities(providerId).observationHook;
    assert.equal("registerObservationHook" in registrations[providerId], declared, providerId);
    assert.equal(
      OBSERVATION_HOOK_PROVIDER_IDS.some((hooked) => hooked === providerId),
      declared,
      providerId,
    );
  }
});

test("the declared location is the identity catalog's", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    assert.equal(
      capabilities(providerId).location,
      PROVIDER_IDENTITY_BY_ID[providerId].location,
      providerId,
    );
  }
});

test("a provider with an agent models table or an add-agent act hosts agents", () => {
  for (const providerId of PROVIDER_ID_LIST) {
    if (!Object.hasOwn(WORKSPACE_AGENT_MODELS, providerId)) continue;
    assert.equal(capabilities(providerId).hostsAgents, true, providerId);
  }
  for (const providerId of providersWithAct(PROVIDER_ACT.ADD_AGENT)) {
    assert.equal(capabilities(providerId).hostsAgents, true, providerId);
  }
});

test("the credential vocabulary's cloud agent list is the key- and consent-connected providers", () => {
  const stored = PROVIDER_ID_LIST.filter((providerId) => {
    const kind = capabilities(providerId).credential;
    return kind === CONNECTION_KIND.KEY || kind === CONNECTION_KIND.CONSENT;
  });
  assert.deepEqual(
    CLOUD_AGENT_PROVIDER_LIST.map((provider) => provider.id),
    stored,
  );
});

// --- Prose coverage: hand-written lists must name exactly the declared providers ---

function repositoryFile(relativePath: string): string {
  return readFileSync(new URL(`../../../${relativePath}`, import.meta.url), "utf8");
}

function sliceBetween(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing anchor ${JSON.stringify(start)}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing anchor ${JSON.stringify(end)} after ${JSON.stringify(start)}`);
  return text.slice(from + start.length, to);
}

function displayName(providerId: ProviderId): string {
  return PROVIDER_IDENTITY_BY_ID[providerId].displayName;
}

function assertNamesExactly(slice: string, providers: readonly ProviderId[], label: string): void {
  for (const providerId of PROVIDER_ID_LIST) {
    assert.equal(
      slice.includes(displayName(providerId)),
      providers.includes(providerId),
      `${label}: ${displayName(providerId)}`,
    );
  }
}

const LUKE_GUIDE = "apps/desktop/src/renderer/luke-guide.ts";
const ROOT_GUIDE = "AGENTS.md";
const PRIVACY = "PRIVACY.md";

test("Luke's guide names the transcript-reading providers the declaration lists", () => {
  const guide = repositoryFile(LUKE_GUIDE);
  assertNamesExactly(
    sliceBetween(guide, "own recent transcript — ", " on this machine today"),
    providersWithAct(PROVIDER_ACT.READ_TRANSCRIPT),
    LUKE_GUIDE,
  );
});

test("Luke's guide names the agent-adding providers the declaration lists", () => {
  const guide = repositoryFile(LUKE_GUIDE);
  assertNamesExactly(
    sliceBetween(guide, "provider documents it — ", " today — the same kind of ask"),
    providersWithAct(PROVIDER_ACT.ADD_AGENT),
    LUKE_GUIDE,
  );
});

test("the root agent guide names the transcript-reading and hooked providers the declaration lists", () => {
  const prose = repositoryFile(ROOT_GUIDE).replace(/\n\s+/gu, " ");
  assertNamesExactly(
    sliceBetween(prose, "transcript this build documents reading (", " today)"),
    providersWithAct(PROVIDER_ACT.READ_TRANSCRIPT),
    `${ROOT_GUIDE} transcript reading`,
  );
  assertNamesExactly(
    sliceBetween(prose, "hook to a provider's own user-level hook surface (today", "nothing else"),
    PROVIDER_ID_LIST.filter((providerId) => capabilities(providerId).observationHook),
    `${ROOT_GUIDE} observation hooks`,
  );
});

test("PRIVACY.md names the connected, CLI-observed, and conversation-read providers", () => {
  const prose = repositoryFile(PRIVACY).replace(/\n\s+/gu, " ");
  assertNamesExactly(
    sliceBetween(prose, "Coding agent providers you connect (", ")"),
    PROVIDER_ID_LIST.filter(
      (providerId) => capabilities(providerId).credential === CONNECTION_KIND.KEY,
    ),
    `${PRIVACY} connected providers`,
  );
  for (const providerId of PROVIDER_ID_LIST) {
    assert.equal(
      prose.includes(`For ${displayName(providerId)} cloud tasks`),
      capabilities(providerId).credential === CONNECTION_KIND.CLI_LOGIN,
      `${PRIVACY} CLI login: ${displayName(providerId)}`,
    );
    assert.equal(
      prose.includes(`reads that session's conversation from ${displayName(providerId)}`),
      declaredActs(providerId).has(PROVIDER_ACT.READ_CONVERSATION),
      `${PRIVACY} conversation read: ${displayName(providerId)}`,
    );
  }
});
