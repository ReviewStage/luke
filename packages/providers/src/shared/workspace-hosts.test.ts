import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { PROVIDER_ID, SESSION_APPLICATION_ID, SESSION_STATUS } from "@sidecar/session";
import { CmuxSessionApplicationReader } from "../cmux/session-applications.js";
import { ConductorSessionApplicationReader } from "../conductor/session-applications.js";
import { OrcaWorkspaceReader } from "../orca/workspaces.js";
import { type WorkspaceHostRegistration, workspaceHostRegistrations } from "./workspace-hosts.js";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-workspace-hosts-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

function registrations(directory: string, superset?: WorkspaceHostRegistration) {
  return workspaceHostRegistrations({
    superset: superset ?? {
      observationFailureLabel: "Superset observation",
      read: async () => (_providerId, observations) => observations,
      emptyEnrichment: (_providerId, observations) => observations,
    },
    conductorApplications: new ConductorSessionApplicationReader({
      databasePath: path.join(directory, "conductor.db"),
    }),
    orcaWorkspaces: new OrcaWorkspaceReader({ dataDirectory: path.join(directory, "orca") }),
    cmuxApplications: new CmuxSessionApplicationReader({
      stateDirectory: path.join(directory, "cmux"),
    }),
  });
}

test("registers the managers in the claim order the trays grew up with", async (t) => {
  const superset: WorkspaceHostRegistration = {
    observationFailureLabel: "Superset observation",
    read: async () => (_providerId, observations) => observations,
    emptyEnrichment: (_providerId, observations) => observations,
  };
  const hosts = registrations(await temporaryDirectory(t), superset);
  assert.equal(hosts[0], superset);
  assert.deepEqual(
    hosts.map((host) => host.observationFailureLabel),
    [
      "Superset observation",
      "Conductor application observation",
      "Orca application observation",
      "cmux application observation",
    ],
  );
});

test("a failed read's stand-in enriches with nothing", async (t) => {
  const hosts = registrations(await temporaryDirectory(t));
  const observations = [
    { providerSessionId: "local", title: "Local", status: SESSION_STATUS.WORKING, observedAt: 1 },
  ];
  for (const host of hosts) {
    assert.equal(host.emptyEnrichment(PROVIDER_ID.CLAUDE_CODE, observations), observations);
  }
});

test("reads each manager's absent app as annotating nothing", async (t) => {
  const hosts = registrations(await temporaryDirectory(t));
  const observations = [
    { providerSessionId: "local", title: "Local", status: SESSION_STATUS.WORKING, observedAt: 1 },
  ];
  for (const host of hosts) {
    const enrichment = await host.read();
    assert.equal(enrichment(PROVIDER_ID.CLAUDE_CODE, observations), observations);
  }
});

test("a read enrichment annotates from the manager's own records", async (t) => {
  const directory = await temporaryDirectory(t);
  const cmuxDirectory = path.join(directory, "cmux");
  await fs.mkdir(cmuxDirectory, { recursive: true });
  await fs.writeFile(
    path.join(cmuxDirectory, "claude-hook-sessions.json"),
    JSON.stringify({
      version: 1,
      sessions: { local: { sessionId: "local", workspaceId: "w", surfaceId: "s" } },
    }),
  );
  const hosts = registrations(directory);
  const cmux = hosts[hosts.length - 1];
  assert.ok(cmux);
  const enrichment = await cmux.read();
  const observations = enrichment(PROVIDER_ID.CLAUDE_CODE, [
    { providerSessionId: "local", title: "Local", status: SESSION_STATUS.WORKING, observedAt: 1 },
  ]);
  assert.equal(observations[0]?.applications?.[0]?.id, SESSION_APPLICATION_ID.CMUX);
});
