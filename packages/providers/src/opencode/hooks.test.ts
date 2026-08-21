import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import { PROVIDER_ID } from "@sidecar/session";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { ObservationHookRegistry } from "../hook-registry.js";
import type { ObservationHookInstallation } from "../shared/hook-merge.js";
import {
  defaultOpenCodeConfigDirectory,
  installOpenCodeObservationPlugin,
  OPENCODE_HOOK_EVENT,
  OPENCODE_PLUGIN_FILE_NAME,
  openCodePluginDirectory,
  readOpenCodeHookEvent,
  removeOpenCodeObservationPlugin,
} from "./hooks.js";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-08-21T18:30:00.000Z");
const TEST_SESSION_ID = "ses_82f1c3a09b4dXy7Kq2mN8pQrAb";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const PLUGIN_MARKER = "Luke OpenCode observation plugin";

async function temporaryInstallation(t: TestContext): Promise<ObservationHookInstallation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-opencode-hooks-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const providerHome = path.join(directory, "opencode-config");
  await fs.mkdir(providerHome, { recursive: true });
  return {
    providerHome,
    hookScriptPath: path.join(providerHome, "plugin", OPENCODE_PLUGIN_FILE_NAME),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

/**
 * Runs the installed plugin the way OpenCode would: every exported function
 * is called for its hooks object, and the event hook is handed one bus event.
 * The plugin runs under `node` here where OpenCode runs it under Bun; it uses
 * nothing but the builtins both share.
 */
async function firePluginEvent(
  installation: ObservationHookInstallation,
  event: ParsedJsonObject | null,
): Promise<void> {
  const driver = `
import { pathToFileURL } from "node:url";
const plugin = await import(pathToFileURL(${JSON.stringify(installation.hookScriptPath)}).href);
for (const load of Object.values(plugin)) {
  const hooks = await load({});
  await hooks.event({ event: ${JSON.stringify(event)} });
}
`;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", driver]);
}

/**
 * Fires several events the way OpenCode actually dispatches them: without
 * awaiting one before the next, so every handler for one session can be in
 * flight at once.
 */
async function firePluginEventsConcurrently(
  installation: ObservationHookInstallation,
  events: readonly ParsedJsonObject[],
): Promise<void> {
  const driver = `
import { pathToFileURL } from "node:url";
const plugin = await import(pathToFileURL(${JSON.stringify(installation.hookScriptPath)}).href);
for (const load of Object.values(plugin)) {
  const hooks = await load({});
  await Promise.all(${JSON.stringify(events)}.map((event) => hooks.event({ event })));
}
`;
  await execFileAsync(process.execPath, ["--input-type=module", "-e", driver]);
}

async function spooledContent(
  installation: ObservationHookInstallation,
  providerSessionId: string,
): Promise<string> {
  return fs.readFile(path.join(installation.spoolDirectory, `${providerSessionId}.json`), "utf8");
}

test("installs the managed plugin inside OpenCode's own plugin directory", async (t) => {
  const installation = await temporaryInstallation(t);

  await installOpenCodeObservationPlugin(installation);

  const content = await fs.readFile(installation.hookScriptPath, "utf8");
  assert.ok(content.startsWith(`// ${PLUGIN_MARKER} v`));
  assert.ok(content.includes(JSON.stringify(installation.spoolDirectory)));
  await fs.stat(installation.spoolDirectory);
});

test("the registry resolves the plugin into OpenCode's plugin directory", () => {
  const registry = new ObservationHookRegistry(() => path.join(path.sep, "luke-data"));

  const installation = registry.installation(PROVIDER_ID.OPENCODE);

  assert.equal(installation.providerHome, defaultOpenCodeConfigDirectory());
  assert.equal(
    installation.hookScriptPath,
    path.join(openCodePluginDirectory(defaultOpenCodeConfigDirectory()), OPENCODE_PLUGIN_FILE_NAME),
  );
  // The spool stays under Luke's own data: the plugin file is the one
  // artifact inside OpenCode's tree.
  assert.equal(
    installation.spoolDirectory,
    path.join(path.sep, "luke-data", "opencode-hooks", "events"),
  );
});

test("touches nothing on a machine with no OpenCode home at all", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.rm(installation.providerHome, { recursive: true, force: true });

  await installOpenCodeObservationPlugin(installation);

  await assert.rejects(fs.stat(installation.providerHome));
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("converges rather than accumulates: reinstalling changes nothing", async (t) => {
  const installation = await temporaryInstallation(t);

  await installOpenCodeObservationPlugin(installation);
  const first = await fs.stat(installation.hookScriptPath);
  const content = await fs.readFile(installation.hookScriptPath, "utf8");
  await installOpenCodeObservationPlugin(installation);

  assert.equal(await fs.readFile(installation.hookScriptPath, "utf8"), content);
  // An unchanged file keeps its mtime, so nothing watching the directory sees
  // a phantom change at every launch.
  assert.equal((await fs.stat(installation.hookScriptPath)).mtimeMs, first.mtimeMs);
});

test("a foreign file wearing the plugin's name is left exactly as it was", async (t) => {
  const installation = await temporaryInstallation(t);
  const foreign = "export const MyPlugin = async () => ({});\n";
  await fs.mkdir(path.dirname(installation.hookScriptPath), { recursive: true });
  await fs.writeFile(installation.hookScriptPath, foreign);

  await installOpenCodeObservationPlugin(installation);

  assert.equal(await fs.readFile(installation.hookScriptPath, "utf8"), foreign);
  // The arrangement installed nothing, so it stages no spool either.
  await assert.rejects(fs.stat(installation.spoolDirectory));

  await removeOpenCodeObservationPlugin(installation);

  // Removal deletes only what the marker proves is Luke's.
  assert.equal(await fs.readFile(installation.hookScriptPath, "utf8"), foreign);
});

test("removal deletes the marker-bearing file, the spool, and nothing else", async (t) => {
  const installation = await temporaryInstallation(t);
  const userPluginPath = path.join(path.dirname(installation.hookScriptPath), "my-plugin.js");
  await installOpenCodeObservationPlugin(installation);
  await fs.writeFile(userPluginPath, "export const MyPlugin = async () => ({});\n");

  await removeOpenCodeObservationPlugin(installation);

  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
  // The plugin directory is OpenCode's own and may hold the user's plugins.
  await fs.stat(userPluginPath);
});

test("the plugin writes one fixed token named by the session, and nothing else", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "session.idle",
    properties: { sessionID: TEST_SESSION_ID, title: SECRET_ENVELOPE_TEXT },
  });

  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"stop"}');
  const entries = await fs.readdir(installation.spoolDirectory);
  // One file, fully renamed into place: no temporary sibling outlives a write.
  assert.deepEqual(entries, [`${TEST_SESSION_ID}.json`]);
  for (const entry of entries) {
    const content = await fs.readFile(path.join(installation.spoolDirectory, entry), "utf8");
    assert.ok(!content.includes(SECRET_ENVELOPE_TEXT));
  }
});

test("a permission ask under either generation's name reads as holding", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "permission.asked",
    properties: { id: "per_1", sessionID: TEST_SESSION_ID, permission: "bash" },
  });
  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"notification"}');

  await firePluginEvent(installation, {
    type: "permission.updated",
    properties: { id: "per_1", sessionID: TEST_SESSION_ID, type: "bash" },
  });
  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"notification"}');
});

test("an answered permission replaces the hold with a running turn", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);
  await firePluginEvent(installation, {
    type: "permission.asked",
    properties: { id: "per_1", sessionID: TEST_SESSION_ID },
  });

  await firePluginEvent(installation, {
    type: "permission.replied",
    properties: { sessionID: TEST_SESSION_ID, requestID: "per_1", reply: "reject" },
  });

  // Either answer resumes the turn — a rejection is fed back to the model —
  // so the reply's value is not even read.
  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"prompt"}');
});

test("only the developer's own message marks a turn opening", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "message.updated",
    properties: { info: { id: "msg_01", sessionID: TEST_SESSION_ID, role: "assistant" } },
  });
  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);

  await firePluginEvent(installation, {
    type: "message.updated",
    properties: { info: { id: "msg_02", sessionID: TEST_SESSION_ID, role: "user" } },
  });
  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"prompt"}');
});

test("a deletion in the older payload shape still reads from inside info", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "session.deleted",
    properties: { info: { id: TEST_SESSION_ID, title: SECRET_ENVELOPE_TEXT } },
  });

  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"session-end"}');
});

test("an error naming no session records nothing", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "session.error",
    properties: { error: { name: "UnknownError" } },
  });

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the plugin refuses ids outside the shape OpenCode mints", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  // A message's own id, and a path trying to escape the spool.
  await firePluginEvent(installation, {
    type: "session.idle",
    properties: { sessionID: "msg_82f1c3a09b4dXy7Kq2mN8pQrAb" },
  });
  await firePluginEvent(installation, {
    type: "session.idle",
    properties: { sessionID: "../../../etc/passwd" },
  });

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the plugin refuses events the build never registered", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "session.updated",
    properties: { sessionID: TEST_SESSION_ID },
  });
  // An inherited property name can never read as a registered event.
  await firePluginEvent(installation, {
    type: "toString",
    properties: { sessionID: TEST_SESSION_ID },
  });

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the plugin is silent once the spool is gone", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });

  await firePluginEvent(installation, {
    type: "session.idle",
    properties: { sessionID: TEST_SESSION_ID },
  });

  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("no failure escapes into the session that fired the event", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  // OpenCode fires the hook without awaiting it, so a rejection would surface
  // in the developer's own session; a broken envelope must resolve quietly.
  await firePluginEvent(installation, null);
  await firePluginEvent(installation, { type: "session.idle" });

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("a later event replaces the earlier one", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  await firePluginEvent(installation, {
    type: "session.idle",
    properties: { sessionID: TEST_SESSION_ID },
  });
  await firePluginEvent(installation, {
    type: "session.error",
    properties: { sessionID: TEST_SESSION_ID, error: { name: "UnknownError" } },
  });

  assert.equal(await spooledContent(installation, TEST_SESSION_ID), '{"event":"stop-failure"}');
});

test("reads the spooled event back with the file's own clock", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const filePath = path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`);
  await fs.writeFile(filePath, '{"event":"session-end"}');
  await fs.utimes(filePath, TEST_TIME / 1000, TEST_TIME / 1000);

  const event = await readOpenCodeHookEvent(installation.spoolDirectory, TEST_SESSION_ID);

  assert.equal(event?.event, OPENCODE_HOOK_EVENT.SESSION_END);
  assert.equal(event?.atMs, TEST_TIME);
});

test("reads nothing from a token outside OpenCode's own vocabulary", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  await fs.writeFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    '{"event":"reboot"}',
  );

  assert.equal(
    await readOpenCodeHookEvent(installation.spoolDirectory, TEST_SESSION_ID),
    undefined,
  );
});

test("concurrent events for one session each land whole", async (t) => {
  const installation = await temporaryInstallation(t);
  await installOpenCodeObservationPlugin(installation);

  // OpenCode fires the event hook without awaiting it, so these writes race;
  // each must use its own temporary sibling, or one rename strands the other.
  await firePluginEventsConcurrently(installation, [
    { type: "permission.asked", properties: { id: "per_1", sessionID: TEST_SESSION_ID } },
    { type: "session.idle", properties: { sessionID: TEST_SESSION_ID } },
    {
      type: "permission.replied",
      properties: { sessionID: TEST_SESSION_ID, requestID: "per_1", reply: "once" },
    },
  ]);

  // Whichever write finished last, the spool holds one whole token and no
  // temporary debris.
  assert.deepEqual(await fs.readdir(installation.spoolDirectory), [`${TEST_SESSION_ID}.json`]);
  const content = await spooledContent(installation, TEST_SESSION_ID);
  assert.ok(
    ['{"event":"notification"}', '{"event":"stop"}', '{"event":"prompt"}'].includes(content),
  );
});
