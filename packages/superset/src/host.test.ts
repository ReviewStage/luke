import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ACT_RESULT_STATUS, PROVIDER_ID, SESSION_STATUS } from "@sidecar/session";
import { SUPERSET_CONTROL_ID, SupersetCli } from "./cli.js";
import { SupersetWorkspaceHost } from "./host.js";
import { type SupersetSessionContext, SupersetWorkspaceSnapshot } from "./workspaces.js";

const CHAT: SupersetSessionContext = {
  providerId: PROVIDER_ID.CODEX,
  providerSessionId: "session-1",
  organizationId: "org-1",
  workspaceId: "workspace-1",
  workspaceName: "power-vacation",
  terminalId: "terminal-1",
  updatedAt: 100,
  spawnableAgents: ["claude"],
};

const CHATLESS: SupersetSessionContext = {
  providerId: PROVIDER_ID.CODEX,
  providerSessionId: "session-2",
  organizationId: "org-1",
  workspaceId: "workspace-2",
  workspaceName: "idle",
  updatedAt: 100,
  spawnableAgents: [],
};

const OTHER_ORGANIZATION: SupersetSessionContext = {
  ...CHAT,
  providerSessionId: "session-3",
  organizationId: "org-2",
};

async function installedHome(t: TestContext): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-host-"));
  t.after(async () => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, "bin"), { recursive: true });
  await fs.writeFile(path.join(home, "bin", "superset"), "#!/bin/sh\n");
  return home;
}

interface Harness {
  host: SupersetWorkspaceHost;
  calls: Array<readonly string[]>;
  reports: string[];
  signIn: (organization: string | undefined) => void;
}

function harness(
  home: string,
  snapshot: () => Promise<SupersetWorkspaceSnapshot>,
  initialOrganization: string | undefined,
): Harness {
  let organization = initialOrganization;
  const calls: Array<readonly string[]> = [];
  const reports: string[] = [];
  const cli = new SupersetCli({
    homeDirectory: home,
    organizationId: async () => organization ?? "",
    run: async (_executable, arguments_) => {
      calls.push(arguments_);
    },
    query: async () => "[]",
  });
  const host = new SupersetWorkspaceHost({
    cli,
    homeDirectory: home,
    reader: { read: snapshot },
    agentDefault: async () => undefined,
    report: (message) => {
      reports.push(message);
    },
  });
  return {
    host,
    calls,
    reports,
    signIn: (next) => {
      organization = next;
    },
  };
}

const observed = async () => new SupersetWorkspaceSnapshot([CHAT, CHATLESS, OTHER_ORGANIZATION]);

test("claims only sessions the latest read resolved inside the signed-in organization", async (t) => {
  const { host } = harness(await installedHome(t), observed, "org-1");
  assert.equal(host.claim(CHAT), undefined, "nothing is claimed before the first read");
  await host.read();

  assert.ok(host.claim(CHAT));
  assert.equal(host.claim(OTHER_ORGANIZATION), undefined);
  assert.equal(
    host.claim({ providerId: PROVIDER_ID.CODEX, providerSessionId: "unknown" }),
    undefined,
  );
});

test("a signed-out CLI claims nothing and reports itself disconnected", async (t) => {
  const { host, signIn } = harness(await installedHome(t), observed, undefined);
  await host.read();
  assert.equal(host.connected(), false);
  assert.equal(host.claim(CHAT), undefined);

  signIn("org-1");
  await host.read();
  assert.equal(host.connected(), true);
  assert.ok(host.claim(CHAT));

  signIn(undefined);
  await host.read();
  assert.equal(host.connected(), false);
  assert.equal(host.claim(CHAT), undefined);
});

test("a claimed chatless workspace takes its delete and rename but never a message", async (t) => {
  const { host, calls } = harness(await installedHome(t), observed, "org-1");
  await host.read();
  const acts = host.claim(CHATLESS);
  assert.ok(acts);

  assert.deepEqual(await acts.sendMessage("hello"), {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(
    (await acts.executeControl(SUPERSET_CONTROL_ID.DELETE_WORKSPACE)).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal((await acts.renameWorkspace("Cleaned up")).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(calls, [
    ["workspaces", "delete", "workspace-2", "--json"],
    ["workspaces", "update", "workspace-2", "--name", "Cleaned up"],
  ]);
});

test("a claimed chat's acts carry its own bound terminal and workspace", async (t) => {
  const { host, calls } = harness(await installedHome(t), observed, "org-1");
  await host.read();
  const acts = host.claim(CHAT);
  assert.ok(acts);

  assert.equal((await acts.sendMessage("hello")).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(
    (await acts.spawnAgent("claude", "Fix the tests")).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.deepEqual(calls, [
    [
      "terminals",
      "send",
      "--workspace",
      "workspace-1",
      "--terminal",
      "terminal-1",
      "--text",
      "hello",
      "--json",
    ],
    [
      "agents",
      "create",
      "--workspace",
      "workspace-1",
      "--agent",
      "claude",
      "--prompt",
      "Fix the tests",
      "--json",
    ],
  ]);
});

test("owns only the controls its own enrichment adds to a row", async (t) => {
  const { host } = harness(await installedHome(t), observed, "org-1");
  assert.equal(host.ownsControl(SUPERSET_CONTROL_ID.DELETE_WORKSPACE), true);
  assert.equal(host.ownsControl("cancel"), false);
});

test("a failed read stands in with no enrichment, no rows, and no claims", async (t) => {
  const { host, reports } = harness(
    await installedHome(t),
    async () => {
      throw new Error("host state unreadable");
    },
    "org-1",
  );
  const observations = [
    {
      providerSessionId: "session-1",
      title: "Checkout",
      status: SESSION_STATUS.WORKING,
      lastActivityAt: 1,
    },
  ];
  const enrichment = await host.read();

  assert.deepEqual(enrichment(PROVIDER_ID.CODEX, observations), observations);
  assert.deepEqual(host.emptyEnrichment(PROVIDER_ID.CODEX, observations), observations);
  assert.deepEqual(await host.adapter.observe(), []);
  assert.equal(host.claim(CHAT), undefined);
  assert.deepEqual(reports, ["Superset observation failed: host state unreadable\n"]);
});
