import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { SESSION_STATUS, SUPERSET_WORKSPACE_PROVIDER_ID } from "@sidecar/session";
import { type TestContext, test } from "vitest";
import { temporaryDirectory } from "../testing/temporary-directory.js";
import { type SupersetPluginOptions, supersetPlugin } from "./plugin.js";

/** A Superset home with the CLI installed and a login on file, and no host state. */
async function connectedHome(t: TestContext): Promise<string> {
  const home = await temporaryDirectory(t, "luke-superset-plugin-");
  await fs.mkdir(path.join(home, "bin"), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(home, "config.json"), '{"organizationId":"org-1"}'),
    fs.writeFile(path.join(home, "bin", "superset"), "#!/bin/sh\n"),
  ]);
  return home;
}

function pluginFor(homeDirectory: string, overrides: Partial<SupersetPluginOptions> = {}) {
  return supersetPlugin({
    homeDirectory,
    query: async () => "[]",
    run: async () => undefined,
    ...overrides,
  });
}

test("reports the idle workspaces its own pass read, and nothing before one", async (t) => {
  const home = await connectedHome(t);
  const database = path.join(home, "host", "org-1");
  await fs.mkdir(database, { recursive: true });
  const plugin = pluginFor(home);

  // Nothing until a pass has run: the rows are the pass's, never state this
  // reads for itself.
  assert.deepEqual(await plugin.observe(), []);
  await plugin.refresh(undefined);
  assert.deepEqual(await plugin.observe(), []);
  assert.equal(plugin.provider.id, SUPERSET_WORKSPACE_PROVIDER_ID);
  assert.equal(plugin.activeOrganization(), "org-1");
});

test("reuses recently discovered workspace projects", async (t) => {
  const home = await connectedHome(t);
  let projectQueries = 0;
  const plugin = pluginFor(home, {
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "projects") {
        projectQueries += 1;
        return JSON.stringify([{ id: "project-1", name: "Luke" }]);
      }
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      return "[]";
    },
  });

  await plugin.refresh("codex");
  await plugin.refresh("codex");

  assert.equal(projectQueries, 1);
  assert.equal(plugin.projects?.()[0]?.defaultAgent, "codex");
});

test("retries workspace discovery after an empty result", async (t) => {
  const home = await connectedHome(t);
  let projectQueries = 0;
  const plugin = pluginFor(home, {
    query: async (_executable, arguments_) => {
      if (arguments_[0] === "projects") {
        projectQueries += 1;
        return projectQueries === 1 ? "[]" : JSON.stringify([{ id: "project-1", name: "Luke" }]);
      }
      if (arguments_[0] === "agents") return JSON.stringify([{ presetId: "codex" }]);
      return "[]";
    },
  });

  await plugin.refresh("codex");
  await plugin.refresh("codex");

  assert.equal(projectQueries, 2);
  assert.equal(plugin.projects?.()[0]?.providerProjectId, "project-1");
});

test("a signed-out home observes its workspaces and offers no project", async (t) => {
  const home = await temporaryDirectory(t, "luke-superset-plugin-");
  const plugin = pluginFor(home, {
    query: async () => {
      throw new Error("observation must not query a signed-out CLI");
    },
  });

  const enrich = await plugin.refresh("codex");

  // Host state reads without a login, so the rows stand — undecorated with
  // actions — however the connection looks.
  assert.deepEqual(await plugin.observe(), []);
  assert.equal(plugin.activeOrganization(), undefined);
  assert.deepEqual(plugin.projects?.(), []);
  const observation = {
    providerSessionId: "session-1",
    title: "somewhere",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: 1,
  };
  assert.deepEqual(enrich("codex", [observation]), [observation]);
});

test("a failed pass stands in with an enrichment that annotates nothing", async (t) => {
  const home = await connectedHome(t);
  const plugin = pluginFor(home);
  const observation = {
    providerSessionId: "session-1",
    title: "somewhere",
    status: SESSION_STATUS.WAITING,
    lastActivityAt: 1,
  };

  assert.deepEqual(plugin.emptyEnrichment("codex", [observation]), [observation]);
});
