import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ACT_RESULT_STATUS, PROVIDER_ID, SESSION_STATUS } from "@sidecar/session";
import { isRecord, text, type UnparsedWireValue } from "@sidecar/wire";
import {
  isSupersetControlId,
  SUPERSET_CONTROL_ID,
  SupersetCli,
  SupersetWorkspaceAdapter,
} from "./cli.js";
import type { SupersetSessionContext } from "./workspaces.js";

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
        const parsed: UnparsedWireValue = JSON.parse(
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
  assert.equal(isSupersetControlId(SUPERSET_CONTROL_ID.DELETE_WORKSPACE), true);
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

test("sign-out runs the documented logout and answers with the CLI's own state", async (t) => {
  const home = await connectedHome(t);
  const calls: Array<readonly string[]> = [];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async (executable, arguments_) => {
      calls.push(arguments_);
      assert.equal(executable, path.join(home, "bin", "superset"));
      await fs.writeFile(path.join(home, "config.json"), "{}");
    },
  });

  assert.equal(await cli.signOut(), true);
  assert.deepEqual(calls, [["auth", "logout", "--json"]]);
  assert.equal(await cli.connected(), false);
});

test("a logout the CLI refused or ignored is not reported as a disconnect", async (t) => {
  const home = await connectedHome(t);
  const refused = new SupersetCli({
    ...testCliOptions(home),
    run: async () => {
      throw new Error("refused");
    },
  });
  assert.equal(await refused.signOut(), false);

  const ignored = new SupersetCli({
    ...testCliOptions(home),
    run: async () => undefined,
  });
  assert.equal(await ignored.signOut(), false);
  assert.equal(await ignored.connected(), true);
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
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That act is not supported by the latest observation.",
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

test("message and controls use fixed arguments without a shell", async (t) => {
  const home = await connectedHome(t);
  const calls: Array<{ executable: string; arguments_: readonly string[] }> = [];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async (executable, arguments_) => {
      calls.push({ executable, arguments_ });
    },
  });

  assert.equal((await cli.sendMessage(CONTEXT, "ship it")).status, ACT_RESULT_STATUS.ACCEPTED);
  assert.equal(
    (await cli.executeControl(CONTEXT, SUPERSET_CONTROL_ID.DELETE_WORKSPACE)).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  // The one workspace-opening invocation left is the follow-through on a
  // creation; an observed chat's open is an address handed to the OS instead.
  assert.equal(
    (await cli.executeControl(CONTEXT, "superset-open-workspace")).status,
    ACT_RESULT_STATUS.UNSUPPORTED,
  );
  assert.equal(
    (await cli.createAgent(CONTEXT, "claude", "Review the change")).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal(
    (await cli.renameWorkspace(CONTEXT, "Payments rollout")).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  // No `--host` on any bound-workspace act: the observed host state is this
  // machine's own, which is the CLI's default, and the flag's machineId is an
  // identifier that state does not carry.
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
      // The one deletion the agent guide authorizes: the observed workspace
      // id as the command's single argument.
      executable: path.join(home, "bin", "superset"),
      arguments_: ["workspaces", "delete", "workspace-1", "--json"],
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
    {
      executable: path.join(home, "bin", "superset"),
      // No `--json` rides the rename: `workspaces update` does not document
      // it, and nothing reads the output.
      arguments_: ["workspaces", "update", "workspace-1", "--name", "Payments rollout"],
    },
  ]);
});

test("a refused rename answers with the CLI's own bounded error line", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async () => {
      throw Object.assign(new Error("exit 1"), {
        stderr: "error: unknown option '--host'\nusage: superset workspaces update <id>\n",
      });
    },
  });

  assert.deepEqual(await cli.renameWorkspace(CONTEXT, "Payments rollout"), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "unknown option '--host'",
  });

  const silent = new SupersetCli({
    ...testCliOptions(home),
    run: async () => {
      throw new Error("exit 1");
    },
  });
  assert.deepEqual(await silent.renameWorkspace(CONTEXT, "Payments rollout"), {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "Superset could not rename that workspace.",
  });
});

test("a chatless workspace context takes the delete but never a message", async (t) => {
  const home = await connectedHome(t);
  const calls: Array<readonly string[]> = [];
  const cli = new SupersetCli({
    ...testCliOptions(home),
    run: async (_executable, arguments_) => {
      calls.push(arguments_);
    },
  });
  const { terminalId: _terminalId, ...chatless } = CONTEXT;

  // No terminal exists for a message to land in, so no invocation may run.
  assert.deepEqual(await cli.sendMessage(chatless, "hello"), {
    status: ACT_RESULT_STATUS.UNSUPPORTED,
    reason: "That act is not supported by the latest observation.",
  });
  assert.equal(
    (await cli.executeControl(chatless, SUPERSET_CONTROL_ID.DELETE_WORKSPACE)).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.equal(
    (await cli.renameWorkspace(chatless, "Cleaned up")).status,
    ACT_RESULT_STATUS.ACCEPTED,
  );
  assert.deepEqual(calls, [
    ["workspaces", "delete", "workspace-1", "--json"],
    ["workspaces", "update", "workspace-1", "--name", "Cleaned up"],
  ]);
});

test("the workspace adapter reports the rows it was refreshed with", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({ ...testCliOptions(home), query: async () => "[]" });
  const adapter = new SupersetWorkspaceAdapter(cli);
  const row = {
    providerSessionId: "workspace-1",
    title: "power-vacation",
    status: SESSION_STATUS.COMPLETE,
    observedAt: 100,
    standing: true,
  };

  assert.deepEqual(await adapter.observe(), []);
  // Observation reads host state, which needs no login, so the rows stand
  // while the CLI is signed out — only their acts wait for the connection.
  await adapter.refresh(undefined, false, [row]);
  assert.deepEqual(await adapter.observe(), [row]);
  await adapter.refresh(undefined, false, []);
  assert.deepEqual(await adapter.observe(), []);
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
    status: ACT_RESULT_STATUS.REJECTED,
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
        // The CLI's creation answer: the id sits on the workspace itself.
        return JSON.stringify({
          workspace: { id: "workspace-new", name: "luke-fix-the-panel-transitions-deadbeef" },
          alreadyExists: false,
        });
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
    { status: ACT_RESULT_STATUS.ACCEPTED },
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

test("lists a project once when the local machine is also a listed host", async (t) => {
  const home = await connectedHome(t);
  const cli = new SupersetCli({
    ...testCliOptions(home),
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "hosts") {
        // The hosts list names every host in the organization, this machine's
        // own row included — the CLI has no way to say which row is local.
        return JSON.stringify([
          { id: "host-me", name: "My Mac" },
          { id: "host-studio", name: "Studio" },
        ]);
      }
      if (arguments_[0] === "projects") {
        if (arguments_.includes("--local") || arguments_.includes("host-me")) {
          return JSON.stringify([{ id: "project-1", name: "Luke" }]);
        }
        return JSON.stringify([{ id: "project-2", name: "Studio site" }]);
      }
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      return "[]";
    },
  });

  const projects = await cli.workspaceProjects();

  // The local target lists project-1 first, so this machine's own host row
  // repeating it adds nothing; the genuinely remote project stays.
  assert.deepEqual(
    projects.map((project) => [project.providerProjectId, project.providerTargetId]),
    [
      ["project-1", "local"],
      ["project-2", "host-studio"],
    ],
  );
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

  await adapter.refresh("codex", true, []);
  await adapter.refresh("codex", true, []);

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

  await adapter.refresh("codex", true, []);
  await adapter.refresh("codex", true, []);

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
        return JSON.stringify({ workspace: { id: "workspace-new", name: "Luke" } });
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
      status: ACT_RESULT_STATUS.ACCEPTED,
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
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "Branch names cannot begin with that prefix.",
    },
  );
});
