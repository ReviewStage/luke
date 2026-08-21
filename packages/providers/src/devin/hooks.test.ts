import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  type ObservationHookInstallation,
  pruneObservationHookSpool,
} from "../shared/hook-merge.js";
import {
  DEVIN_HOOK_EVENT,
  DEVIN_HOOK_SCRIPT_NAME,
  installDevinObservationHooks,
  readDevinHookEvent,
  removeDevinObservationHooks,
} from "./hooks.js";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
/** The shape Devin mints: lowercase words joined by hyphens. */
const TEST_SESSION_ID = "solid-rest";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const DEVIN_CONFIGURATION_FILE_NAME = "config.json";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
/** Every lifecycle event the build registers, as config.json names them. */
const REGISTERED_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
  "SessionEnd",
] as const;

async function temporaryInstallation(t: TestContext): Promise<ObservationHookInstallation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-devin-hooks-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const providerHome = path.join(directory, "devin-config-home");
  await fs.mkdir(providerHome, { recursive: true });
  return {
    providerHome,
    hookScriptPath: path.join(directory, "luke-data", DEVIN_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

function configurationPath(installation: ObservationHookInstallation): string {
  return path.join(installation.providerHome, DEVIN_CONFIGURATION_FILE_NAME);
}

async function readConfiguration(
  installation: ObservationHookInstallation,
): Promise<ParsedJsonObject> {
  return JSON.parse(await fs.readFile(configurationPath(installation), "utf8"));
}

function hookEntries(configuration: ParsedJsonObject, eventName: string): unknown[] {
  // SAFETY: Parsed JSON matches the event object shape this harness exercises.
  const events = configuration.hooks as ParsedJsonObject;
  const entries = events[eventName];
  return Array.isArray(entries) ? entries : [];
}

function entryCommands(entries: unknown[]): string[] {
  return entries.flatMap((entry) => {
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    const hooks = (entry as { hooks?: { command?: unknown }[] }).hooks;
    if (!Array.isArray(hooks)) return [];
    return hooks
      .map((hook) => hook.command)
      .filter(
        (command): command is string =>
          Object.prototype.toString.call(command) === "[object String]",
      );
  });
}

/**
 * Runs the installed script the way Devin would: the event as its one
 * argument, the envelope on stdin. `execFile` cannot feed stdin, so the
 * envelope rides in from a file beside the script through `sh -c`.
 */
async function pipeToHookScript(
  installation: ObservationHookInstallation,
  eventArgument: string,
  envelope: string,
): Promise<void> {
  const envelopeFile = path.join(path.dirname(installation.hookScriptPath), "envelope.json");
  await fs.writeFile(envelopeFile, envelope, "utf8");
  await execFileAsync("sh", [
    "-c",
    `"${installation.hookScriptPath}" "${eventArgument}" < "${envelopeFile}"`,
  ]);
  await fs.rm(envelopeFile, { force: true });
}

test("registers every lifecycle event beside the user's own configuration", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    configurationPath(installation),
    JSON.stringify({
      version: 1,
      theme_mode: "dark",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );

  await installDevinObservationHooks(installation);

  const configuration = await readConfiguration(installation);
  // The user's own settings and hook all survive the merge untouched.
  assert.equal(configuration.theme_mode, "dark");
  const stopCommands = entryCommands(hookEntries(configuration, "Stop"));
  assert.ok(stopCommands.includes("afplay /System/done.aiff"));
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const commands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(DEVIN_HOOK_SCRIPT_NAME),
    );
    assert.equal(commands.length, 1, `${eventName} carries exactly one Luke entry`);
    // Guarded on the script's own presence, so an entry outliving an
    // uninstalled Luke is a no-op rather than a "not found" in every session.
    assert.ok(commands[0]?.startsWith(`[ -x "${installation.hookScriptPath}" ]`));
    assert.ok(commands[0]?.endsWith("|| true"));
  }

  const script = await fs.readFile(installation.hookScriptPath, "utf8");
  assert.ok(script.includes(installation.spoolDirectory));
  const mode = (await fs.stat(installation.hookScriptPath)).mode & 0o777;
  assert.equal(mode, 0o755);
});

test("creates the configuration file for a Devin home that has none yet", async (t) => {
  const installation = await temporaryInstallation(t);

  await installDevinObservationHooks(installation);

  const configuration = await readConfiguration(installation);
  assert.equal(entryCommands(hookEntries(configuration, "Stop")).length, 1);
  // A file being created gets the documented schema version beside the hooks.
  assert.equal(configuration.version, 1);
});

test("the user's own schema version is never rewritten", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(configurationPath(installation), JSON.stringify({ version: 2, hooks: {} }));

  await installDevinObservationHooks(installation);

  assert.equal((await readConfiguration(installation)).version, 2);
});

test("touches nothing on a machine with no Devin home at all", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.rm(installation.providerHome, { recursive: true, force: true });

  await installDevinObservationHooks(installation);

  // No provider directory is created on the provider's behalf, and no script
  // or spool is staged for sessions that cannot exist.
  await assert.rejects(fs.stat(installation.providerHome));
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("leaves a configuration file it cannot parse exactly as it was", async (t) => {
  const installation = await temporaryInstallation(t);
  const corrupt = "{ this is not json";
  await fs.writeFile(configurationPath(installation), corrupt);

  await installDevinObservationHooks(installation);

  assert.equal(await fs.readFile(configurationPath(installation), "utf8"), corrupt);
});

test("converges rather than accumulates: reinstalling changes nothing", async (t) => {
  const installation = await temporaryInstallation(t);

  await installDevinObservationHooks(installation);
  const first = await fs.readFile(configurationPath(installation), "utf8");
  await installDevinObservationHooks(installation);

  assert.equal(await fs.readFile(configurationPath(installation), "utf8"), first);
});

test("reconciles entries an older build registered under another path", async (t) => {
  const installation = await temporaryInstallation(t);
  const staleCommand = `/old/data/${DEVIN_HOOK_SCRIPT_NAME} stop`;
  await fs.writeFile(
    configurationPath(installation),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: staleCommand }] }],
        // An event this build no longer registers is cleaned up too.
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: staleCommand }] }],
      },
    }),
  );

  await installDevinObservationHooks(installation);

  const configuration = await readConfiguration(installation);
  const stopCommands = entryCommands(hookEntries(configuration, "Stop")).filter((command) =>
    command.includes(DEVIN_HOOK_SCRIPT_NAME),
  );
  assert.equal(stopCommands.length, 1);
  assert.ok(!stopCommands[0]?.includes("/old/data/"));
  assert.equal(hookEntries(configuration, "PostToolUse").length, 0);
});

test("removal strips Luke's entries and leaves the user's configuration standing", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    configurationPath(installation),
    JSON.stringify({
      version: 1,
      theme_mode: "dark",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );
  await installDevinObservationHooks(installation);

  await removeDevinObservationHooks(installation);

  const configuration = await readConfiguration(installation);
  assert.equal(configuration.theme_mode, "dark");
  assert.deepEqual(entryCommands(hookEntries(configuration, "Stop")), ["afplay /System/done.aiff"]);
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const lukeCommands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(DEVIN_HOOK_SCRIPT_NAME),
    );
    assert.equal(lukeCommands.length, 0, `${eventName} carries no Luke entry after removal`);
  }
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("removal drops the hooks container once nothing of the user's remains", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);

  await removeDevinObservationHooks(installation);

  const configuration = await readConfiguration(installation);
  assert.equal("hooks" in configuration, false);
  // The settings around the container are the user's file, and stay.
  assert.equal(configuration.version, 1);
});

test("removal never creates a configuration file", async (t) => {
  const installation = await temporaryInstallation(t);

  await removeDevinObservationHooks(installation);

  await assert.rejects(fs.stat(configurationPath(installation)));
});

test("the script writes one fixed token named by the session, and nothing else", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);
  const envelope = JSON.stringify({
    hook_event_name: "Stop",
    session_id: TEST_SESSION_ID,
    // A per-turn id in the same hyphenated alphabet: only the session field
    // may name the spool file.
    prompt_id: "c57624f6-52e6-4ac1-b450-90ac2b50b8ec",
    prompt: SECRET_ENVELOPE_TEXT,
  });

  await pipeToHookScript(installation, DEVIN_HOOK_EVENT.STOP, envelope);

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), [`${TEST_SESSION_ID}.json`]);
  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  // The whole file is the fixed token: the envelope's text never reaches disk.
  assert.equal(spooled, '{"event":"stop"}');
  assert.ok(!spooled.includes(SECRET_ENVELOPE_TEXT));
});

test("a later event replaces the earlier one", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);
  const envelope = JSON.stringify({ session_id: TEST_SESSION_ID });

  await pipeToHookScript(installation, DEVIN_HOOK_EVENT.STOP, envelope);
  await pipeToHookScript(installation, DEVIN_HOOK_EVENT.PROMPT, envelope);

  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  assert.equal(spooled, '{"event":"prompt"}');
});

test("the script refuses a token the build never registered", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);

  await pipeToHookScript(
    installation,
    "made-up-event",
    JSON.stringify({ session_id: TEST_SESSION_ID }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script refuses a session id outside the shape Devin mints", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);

  // A path is not a petname, and neither is a single word: the id pattern
  // demands the hyphenated shape, so nothing else can name a spool file.
  for (const sessionId of ["../../../etc/passwd", "solidrest", "SOLID-REST"]) {
    await pipeToHookScript(
      installation,
      DEVIN_HOOK_EVENT.STOP,
      JSON.stringify({ session_id: sessionId }),
    );
  }

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script is silent once the spool is gone", async (t) => {
  const installation = await temporaryInstallation(t);
  await installDevinObservationHooks(installation);
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });

  await pipeToHookScript(
    installation,
    DEVIN_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: TEST_SESSION_ID }),
  );

  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("reads the spooled event back with the file's own clock", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const filePath = path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`);
  await fs.writeFile(filePath, '{"event":"stop"}');
  await fs.utimes(filePath, TEST_TIME / 1000, TEST_TIME / 1000);

  const event = await readDevinHookEvent(installation.spoolDirectory, TEST_SESSION_ID);

  assert.equal(event?.event, DEVIN_HOOK_EVENT.STOP);
  assert.equal(event?.atMs, TEST_TIME);
});

test("reads nothing from a missing, foreign, or oversized spool file", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const write = (name: string, content: string) =>
    fs.writeFile(path.join(installation.spoolDirectory, `${name}.json`), content);
  await write("unknown-token", '{"event":"reboot"}');
  await write("not-json", "not json at all");
  await write("oversized", `{"event":"stop","padding":"${"x".repeat(512)}"}`);

  assert.equal(await readDevinHookEvent(installation.spoolDirectory, "absent"), undefined);
  assert.equal(await readDevinHookEvent(installation.spoolDirectory, "unknown-token"), undefined);
  assert.equal(await readDevinHookEvent(installation.spoolDirectory, "not-json"), undefined);
  assert.equal(await readDevinHookEvent(installation.spoolDirectory, "oversized"), undefined);
});

test("pruning drops only the events past the observation window", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const dayMs = 24 * 60 * 60 * 1000;
  const freshPath = path.join(installation.spoolDirectory, "fresh.json");
  const stalePath = path.join(installation.spoolDirectory, "stale.json");
  await fs.writeFile(freshPath, '{"event":"stop"}');
  await fs.writeFile(stalePath, '{"event":"stop"}');
  await fs.utimes(freshPath, (TEST_TIME - 60_000) / 1000, (TEST_TIME - 60_000) / 1000);
  await fs.utimes(stalePath, (TEST_TIME - 2 * dayMs) / 1000, (TEST_TIME - 2 * dayMs) / 1000);

  await pruneObservationHookSpool(installation.spoolDirectory, dayMs, TEST_TIME);

  await fs.stat(freshPath);
  await assert.rejects(fs.stat(stalePath));
  // A spool that does not exist is nothing to prune rather than a failure.
  await pruneObservationHookSpool(
    path.join(installation.spoolDirectory, "absent"),
    dayMs,
    TEST_TIME,
  );
});

test("removal leaves a file with no Luke entries byte-for-byte alone", async (t) => {
  const installation = await temporaryInstallation(t);
  // Formatted unlike anything this module writes: compact, no trailing line.
  const foreign = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"afplay /a.aiff"}]}]}}';
  await fs.writeFile(configurationPath(installation), foreign);

  await removeDevinObservationHooks(installation);

  assert.equal(await fs.readFile(configurationPath(installation), "utf8"), foreign);
});

test("the configuration write keeps the file's own mode and leaves no debris", async (t) => {
  const installation = await temporaryInstallation(t);
  // The CLI writes its config.json owner-only, and the merge must not widen it.
  await fs.writeFile(configurationPath(installation), "{}\n", { mode: 0o600 });
  await fs.chmod(configurationPath(installation), 0o600);

  await installDevinObservationHooks(installation);

  // The rename replaced the file, and the user's own protection rode along.
  assert.equal((await fs.stat(configurationPath(installation))).mode & 0o777, 0o600);
  const leftovers = (await fs.readdir(installation.providerHome)).filter((name) =>
    name.includes(".luke-tmp"),
  );
  assert.deepEqual(leftovers, []);
});

test("the configuration write lands through a symlink rather than replacing it", async (t) => {
  const installation = await temporaryInstallation(t);
  // A dotfiles-managed home: config.json is a link into a synced store.
  const syncedPath = path.join(installation.providerHome, "synced-config.json");
  await fs.writeFile(syncedPath, "{}\n");
  await fs.symlink(syncedPath, configurationPath(installation));

  await installDevinObservationHooks(installation);

  const linked = await fs.lstat(configurationPath(installation));
  assert.ok(linked.isSymbolicLink(), "the link survives the write");
  const synced = JSON.parse(await fs.readFile(syncedPath, "utf8"));
  assert.equal(entryCommands(hookEntries(synced, "Stop")).length, 1);
});
