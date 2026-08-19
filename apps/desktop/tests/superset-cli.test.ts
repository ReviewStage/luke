import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { isRecord, PROVIDER_ACT_RESULT_STATUS, PROVIDER_ID, text } from "@sidecar/core";
import {
  isSupersetControlId,
  SUPERSET_CONTROL_ID,
  SupersetCli,
  SupersetWorkspaceAdapter,
} from "../src/superset-cli";
import type { SupersetSessionContext } from "../src/superset-workspaces";

async function connectedHome(t: TestContext): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-cli-"));
  t.after(async () => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, "bin"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(home, "config.json"), '{"organizationId":"org-1"}'),
    fs.writeFile(path.join(home, "bin", "superset"), "#!/bin/sh\n"),
  ]);
  return home;
}

function testCliOptions(homeDirectory: string) {
  return {
    homeDirectory,
    organizationId: async () => {
      try {
        const parsed: unknown = JSON.parse(
          await fs.readFile(path.join(homeDirectory, "config.json"), "utf8"),
        );
        return isRecord(parsed) ? text(parsed.organizationId) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

const CONTEXT: SupersetSessionContext = {
  providerId: PROVIDER_ID.CODEX,
  providerSessionId: "session-1",
  organizationId: "org-1",
  workspaceId: "workspace-1",
  workspaceName: "power-vacation",
  terminalId: "terminal-1",
  updatedAt: 100,
  spawnableAgents: [],
};

test("recognizes only controls owned by Superset", () => {
  assert.equal(isSupersetControlId(SUPERSET_CONTROL_ID.OPEN_WORKSPACE), true);
  assert.equal(isSupersetControlId(SUPERSET_CONTROL_ID.CLOSE_TERMINAL), true);
  assert.equal(isSupersetControlId("provider-native-control"), false);
});

test("login state uses only the injected organization-id answer", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli(testCliOptions(home));
  assert.equal(await cli.activeOrganization(), "org-1");
  assert.equal(await cli.connected(), true);
  await fs.writeFile(path.join(home, "config.json"), '{"organizationId":""}');
  assert.equal(await cli.activeOrganization(), undefined);
  assert.equal(await cli.connected(), false);
  await fs.writeFile(path.join(home, "config.json"), "not json");
  assert.equal(await cli.connected(), false);
});

test("a missing CLI login exposes no Superset actions", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-cli-"));
  t.after(async () => fs.rm(home, { recursive: true, force: true }));
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async () => assert.fail("an unavailable CLI must not run"),
  });

  assert.equal(await cli.connected(), false);
  assert.deepEqual(await cli.sendMessage(CONTEXT, "hello"), {
    status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED,
  });
});

test("organization selection is refreshed and switched by exact slug", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "luke-superset-cli-"));
  t.after(async () => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, "bin"), { recursive: true });
  await fs.writeFile(path.join(home, "bin", "superset"), "#!/bin/sh\n");
  const organizations = [
    { id: "org-1", name: "Acme", slug: "acme" },
    { id: "org-2", name: "Luke", slug: "luke" },
  ];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[1] === "list") return JSON.stringify({ data: organizations });
      await fs.writeFile(path.join(home, "config.json"), '{"organizationId":"org-2"}');
      return "{}";
    },
  });

  assert.deepEqual(await cli.organizations(), organizations);
  assert.equal(await cli.chooseOrganization("invented"), false);
  assert.equal(await cli.chooseOrganization("luke"), true);
});

test("message and controls target this machine with fixed arguments and no shell", async (t) => {
  const home = await connectedHome(t);
  const calls: Array<{ executable: string; arguments_: readonly string[] }> = [];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async (executable, arguments_) => {
      calls.push({ executable, arguments_ });
    },
  });

  assert.equal(
    (await cli.sendMessage(CONTEXT, "ship it")).status,
    PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal(
    (await cli.executeControl(CONTEXT, SUPERSET_CONTROL_ID.OPEN_WORKSPACE)).status,
    PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal(
    (await cli.executeControl(CONTEXT, SUPERSET_CONTROL_ID.CLOSE_TERMINAL)).status,
    PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal(
    (await cli.createAgent(CONTEXT, "claude", "Review the change")).status,
    PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.deepEqual(calls, [
    {
      executable: path.join(home, "bin", "superset"),
      arguments_: [
        "terminals",
        "send",
        "--workspace",
        "workspace-1",
        "--terminal",
        "terminal-1",
        "--text",
        "ship it",
        "--json",
      ],
    },
    {
      executable: path.join(home, "bin", "superset"),
      arguments_: ["workspaces", "open", "workspace-1", "--json"],
    },
    {
      executable: path.join(home, "bin", "superset"),
      arguments_: [
        "terminals",
        "close",
        "--workspace",
        "workspace-1",
        "--terminal",
        "terminal-1",
        "--json",
      ],
    },
    {
      executable: path.join(home, "bin", "superset"),
      arguments_: [
        "agents",
        "create",
        "--workspace",
        "workspace-1",
        "--agent",
        "claude",
        "--prompt",
        "Review the change",
        "--json",
      ],
    },
  ]);
});

test("a CLI failure becomes a bounded rejection", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async () => {
      throw new Error("secret provider output");
    },
  });

  assert.deepEqual(await cli.sendMessage(CONTEXT, "hello"), {
    status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
    reason: "Superset could not deliver that message.",
  });
});

test("discovers host-scoped projects and creates a workspace with a generated branch", async (t) => {
  const home = await connectedHome(t);
  const commands: readonly string[][] = [];
  // SAFETY: Test harness mutates the captured command list for assertions.
  const mutableCommands = commands as string[][];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    uniqueId: () => "deadbeef-0000-0000-0000-000000000000",
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "hosts") return "[]";
      if (arguments_[0] === "projects") {
        return JSON.stringify([{ id: "project-1", name: "Luke", path: "/private/path" }]);
      }
      if (arguments_[0] === "agents") {
        return JSON.stringify([
          { id: "agent-1", presetId: "codex", label: "Codex" },
          { id: "agent-2", presetId: "claude", label: "Claude" },
        ]);
      }
      if (arguments_[0] === "workspaces") {
        mutableCommands.push([...arguments_]);
        return JSON.stringify({ workspaceId: "workspace-new" });
      }
      return "[]";
    },
    run: async (_executable, arguments_) => {
      mutableCommands.push([...arguments_]);
    },
  });

  assert.deepEqual(await cli.workspaceProjects("codex"), [
    {
      providerProjectId: "project-1",
      repository: "Luke",
      taskSupport: "required",
      providerTargetId: "local",
      targetName: "This Mac",
      spawnableAgents: ["codex", "claude"],
      defaultAgent: "codex",
    },
  ]);
  assert.deepEqual(
    await cli.createWorkspace({
      providerProjectId: "project-1",
      providerTargetId: "local",
      agent: "codex",
      task: "Fix the panel transitions",
    }),
    { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED },
  );
  assert.deepEqual(mutableCommands, [
    [
      "workspaces",
      "create",
      "--local",
      "--project",
      "project-1",
      "--name",
      "luke-fix-the-panel-transitions-deadbeef",
      "--branch",
      "luke-fix-the-panel-transitions-deadbeef",
      "--agent",
      "codex",
      "--prompt",
      "Fix the panel transitions",
      "--json",
    ],
    ["workspaces", "open", "workspace-new", "--json"],
  ]);
});

test("reuses recently discovered workspace projects", async (t) => {
  const home = await connectedHome(t);
  let projectQueries = 0;
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "projects") {
        projectQueries += 1;
        return JSON.stringify([{ id: "project-1", name: "Luke" }]);
      }
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      return "[]";
    },
  });
  const adapter = new SupersetWorkspaceAdapter(cli);

  await adapter.refresh("codex", true);
  await adapter.refresh("codex", true);

  assert.equal(projectQueries, 1);
  assert.equal(adapter.workspaceProjects()[0]?.defaultAgent, "codex");
});

test("retries workspace discovery after an empty result", async (t) => {
  const home = await connectedHome(t);
  let projectQueries = 0;
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "projects") {
        projectQueries += 1;
        return projectQueries === 1 ? "[]" : JSON.stringify([{ id: "project-1", name: "Luke" }]);
      }
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      return "[]";
    },
  });
  const adapter = new SupersetWorkspaceAdapter(cli);

  await adapter.refresh("codex", true);
  await adapter.refresh("codex", true);

  assert.equal(projectQueries, 2);
  assert.equal(adapter.workspaceProjects()[0]?.providerProjectId, "project-1");
});

test("creates on an observed remote host and preserves success when opening fails", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "hosts") return JSON.stringify([{ id: "host-1", name: "Studio" }]);
      if (arguments_[0] === "projects") {
        return arguments_.includes("host-1")
          ? JSON.stringify([{ id: "project-1", name: "Luke" }])
          : "[]";
      }
      if (arguments_[0] === "agents") {
        return arguments_.includes("host-1") ? JSON.stringify([{ presetId: "codex" }]) : "[]";
      }
      if (arguments_[0] === "workspaces") {
        assert.deepEqual(arguments_.slice(0, 5), [
          "workspaces",
          "create",
          "--host",
          "host-1",
          "--project",
        ]);
        return JSON.stringify({ workspaceId: "workspace-new" });
      }
      return "[]";
    },
    run: async (_executable, arguments_) => {
      assert.deepEqual(arguments_, [
        "workspaces",
        "open",
        "workspace-new",
        "--host",
        "host-1",
        "--json",
      ]);
      throw new Error("Superset is not reachable");
    },
  });

  assert.deepEqual(
    await cli.createWorkspace({
      providerProjectId: "project-1",
      providerTargetId: "host-1",
      agent: "codex",
      task: "Review the branch",
    }),
    {
      status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
      warning: "The workspace was created, but Superset could not open it.",
    },
  );
});

test("workspace creation reports Superset's bounded first error line", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "hosts") return "[]";
      if (arguments_[0] === "projects") return JSON.stringify([{ id: "project-1", name: "Luke" }]);
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      throw Object.assign(new Error("command included private arguments"), {
        stderr: `\u001b[31mError: Branch names cannot begin with that prefix.\u001b[0m\n${"x".repeat(500)}`,
      });
    },
  });

  assert.deepEqual(
    await cli.createWorkspace({
      providerProjectId: "project-1",
      providerTargetId: "local",
      agent: "codex",
      task: "private task text",
    }),
    {
      status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
      reason: "Branch names cannot begin with that prefix.",
    },
  );
});
