import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  CLAUDE_HOOK_EVENT,
  CLAUDE_HOOK_SCRIPT_NAME,
  type ClaudeCodeHookInstallation,
  installClaudeCodeObservationHooks,
  pruneClaudeHookSpool,
  readClaudeHookEvent,
  removeClaudeCodeObservationHooks,
} from "./hooks.js";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-08-11T23:45:00.000Z");
const TEST_SESSION_ID = "3f9a1b2c-4d5e-6789-abcd-ef0123456789";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const CLAUDE_SETTINGS_FILE_NAME = "settings.json";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
/** Every lifecycle event the build registers, as settings.json names them. */
const REGISTERED_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "StopFailure",
  "Notification",
  "SessionEnd",
] as const;

async function temporaryInstallation(t: TestContext): Promise<ClaudeCodeHookInstallation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-claude-hooks-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const claudeHome = path.join(directory, "claude-home");
  await fs.mkdir(claudeHome, { recursive: true });
  return {
    claudeHome,
    hookScriptPath: path.join(directory, "luke-data", CLAUDE_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

function settingsPath(installation: ClaudeCodeHookInstallation): string {
  return path.join(installation.claudeHome, CLAUDE_SETTINGS_FILE_NAME);
}

async function readSettings(installation: ClaudeCodeHookInstallation): Promise<ParsedJsonObject> {
  return JSON.parse(await fs.readFile(settingsPath(installation), "utf8"));
}

function hookEntries(settings: ParsedJsonObject, eventName: string): unknown[] {
  // SAFETY: Parsed JSON matches the event object shape this harness exercises.
  const events = settings.hooks as ParsedJsonObject;
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
 * Runs the installed script the way Claude Code would: the event as its one
 * argument, the envelope on stdin. `execFile` cannot feed stdin, so the
 * envelope rides in from a file beside the script through `sh -c`.
 */
async function pipeToHookScript(
  installation: ClaudeCodeHookInstallation,
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

test("registers every lifecycle event beside the user's own settings", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    settingsPath(installation),
    JSON.stringify({
      model: "opus",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );

  await installClaudeCodeObservationHooks(installation);

  const settings = await readSettings(installation);
  // The user's own setting and hook both survive the merge untouched.
  assert.equal(settings.model, "opus");
  const stopCommands = entryCommands(hookEntries(settings, "Stop"));
  assert.ok(stopCommands.includes("afplay /System/done.aiff"));
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const commands = entryCommands(hookEntries(settings, eventName)).filter((command) =>
      command.includes(CLAUDE_HOOK_SCRIPT_NAME),
    );
    assert.equal(commands.length, 1, `${eventName} carries exactly one Luke entry`);
    // Guarded on the script's own presence, so an entry outliving an
    // uninstalled Luke is a no-op rather than a "not found" in every session.
    assert.ok(commands[0]?.startsWith(`[ -x "${installation.hookScriptPath}" ]`));
    assert.ok(commands[0]?.endsWith("|| true"));
  }
  // The notification entry asks only for the kinds that mean the session is
  // holding for the user.
  const notificationEntry = hookEntries(settings, "Notification").find((entry) =>
    entryCommands([entry]).some((command) => command.includes(CLAUDE_HOOK_SCRIPT_NAME)),
  );
  // SAFETY: Notification hook entry carries matcher metadata this test asserts on.
  const notification = notificationEntry as { matcher?: string };
  assert.equal(notification.matcher, "permission_prompt|elicitation_dialog");

  const script = await fs.readFile(installation.hookScriptPath, "utf8");
  assert.ok(script.includes(installation.spoolDirectory));
  const mode = (await fs.stat(installation.hookScriptPath)).mode & 0o777;
  assert.equal(mode, 0o755);
});

test("creates the settings file for a Claude home that has none yet", async (t) => {
  const installation = await temporaryInstallation(t);

  await installClaudeCodeObservationHooks(installation);

  const settings = await readSettings(installation);
  assert.equal(entryCommands(hookEntries(settings, "Stop")).length, 1);
});

test("touches nothing on a machine with no Claude home at all", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.rm(installation.claudeHome, { recursive: true, force: true });

  await installClaudeCodeObservationHooks(installation);

  // No provider directory is created on the provider's behalf, and no script
  // or spool is staged for sessions that cannot exist.
  await assert.rejects(fs.stat(installation.claudeHome));
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("leaves a settings file it cannot parse exactly as it was", async (t) => {
  const installation = await temporaryInstallation(t);
  const corrupt = "{ this is not json";
  await fs.writeFile(settingsPath(installation), corrupt);

  await installClaudeCodeObservationHooks(installation);

  assert.equal(await fs.readFile(settingsPath(installation), "utf8"), corrupt);
});

test("converges rather than accumulates: reinstalling changes nothing", async (t) => {
  const installation = await temporaryInstallation(t);

  await installClaudeCodeObservationHooks(installation);
  const first = await fs.readFile(settingsPath(installation), "utf8");
  await installClaudeCodeObservationHooks(installation);

  assert.equal(await fs.readFile(settingsPath(installation), "utf8"), first);
});

test("reconciles entries an older build registered under another path", async (t) => {
  const installation = await temporaryInstallation(t);
  const staleCommand = `/old/data/${CLAUDE_HOOK_SCRIPT_NAME} stop`;
  await fs.writeFile(
    settingsPath(installation),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: staleCommand }] }],
        // An event this build no longer registers is cleaned up too.
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: staleCommand }] }],
      },
    }),
  );

  await installClaudeCodeObservationHooks(installation);

  const settings = await readSettings(installation);
  const stopCommands = entryCommands(hookEntries(settings, "Stop")).filter((command) =>
    command.includes(CLAUDE_HOOK_SCRIPT_NAME),
  );
  assert.equal(stopCommands.length, 1);
  assert.ok(!stopCommands[0]?.includes("/old/data/"));
  assert.equal(hookEntries(settings, "PostToolUse").length, 0);
});

test("removal strips Luke's entries and leaves the user's hooks standing", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    settingsPath(installation),
    JSON.stringify({
      model: "opus",
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );
  await installClaudeCodeObservationHooks(installation);

  await removeClaudeCodeObservationHooks(installation);

  const settings = await readSettings(installation);
  assert.equal(settings.model, "opus");
  assert.deepEqual(entryCommands(hookEntries(settings, "Stop")), ["afplay /System/done.aiff"]);
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const lukeCommands = entryCommands(hookEntries(settings, eventName)).filter((command) =>
      command.includes(CLAUDE_HOOK_SCRIPT_NAME),
    );
    assert.equal(lukeCommands.length, 0, `${eventName} carries no Luke entry after removal`);
  }
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("removal drops the hooks container once nothing of the user's remains", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);

  await removeClaudeCodeObservationHooks(installation);

  const settings = await readSettings(installation);
  assert.equal("hooks" in settings, false);
});

test("removal never creates a settings file", async (t) => {
  const installation = await temporaryInstallation(t);

  await removeClaudeCodeObservationHooks(installation);

  await assert.rejects(fs.stat(settingsPath(installation)));
});

test("the script writes one fixed token named by the session, and nothing else", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);
  const envelope = JSON.stringify({
    session_id: TEST_SESSION_ID,
    transcript_path: `/somewhere/${TEST_SESSION_ID}.jsonl`,
    prompt: SECRET_ENVELOPE_TEXT,
  });

  await pipeToHookScript(installation, CLAUDE_HOOK_EVENT.STOP, envelope);

  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  // The whole file is the fixed token: the envelope's text never reaches disk.
  assert.equal(spooled, '{"event":"stop"}');
  for (const entry of await fs.readdir(installation.spoolDirectory)) {
    const content = await fs.readFile(path.join(installation.spoolDirectory, entry), "utf8");
    assert.ok(!content.includes(SECRET_ENVELOPE_TEXT));
  }
});

test("a later event replaces the earlier one", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);
  const envelope = JSON.stringify({ session_id: TEST_SESSION_ID });

  await pipeToHookScript(installation, CLAUDE_HOOK_EVENT.STOP, envelope);
  await pipeToHookScript(installation, CLAUDE_HOOK_EVENT.PROMPT, envelope);

  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  assert.equal(spooled, '{"event":"prompt"}');
});

test("the script refuses a token the build never registered", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);

  await pipeToHookScript(
    installation,
    "made-up-event",
    JSON.stringify({ session_id: TEST_SESSION_ID }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script skips a subagent's events", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);

  await pipeToHookScript(
    installation,
    CLAUDE_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: TEST_SESSION_ID, agent_id: "subagent-1" }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script refuses a session id outside the shape Claude Code mints", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);

  await pipeToHookScript(
    installation,
    CLAUDE_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: "../../../etc/passwd" }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script is silent once the spool is gone", async (t) => {
  const installation = await temporaryInstallation(t);
  await installClaudeCodeObservationHooks(installation);
  await fs.rm(installation.spoolDirectory, { recursive: true, force: true });

  await pipeToHookScript(
    installation,
    CLAUDE_HOOK_EVENT.STOP,
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

  const event = await readClaudeHookEvent(installation.spoolDirectory, TEST_SESSION_ID);

  assert.equal(event?.event, CLAUDE_HOOK_EVENT.STOP);
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

  assert.equal(await readClaudeHookEvent(installation.spoolDirectory, "absent"), undefined);
  assert.equal(await readClaudeHookEvent(installation.spoolDirectory, "unknown-token"), undefined);
  assert.equal(await readClaudeHookEvent(installation.spoolDirectory, "not-json"), undefined);
  assert.equal(await readClaudeHookEvent(installation.spoolDirectory, "oversized"), undefined);
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

  await pruneClaudeHookSpool(installation.spoolDirectory, dayMs, TEST_TIME);

  await fs.stat(freshPath);
  await assert.rejects(fs.stat(stalePath));
  // A spool that does not exist is nothing to prune rather than a failure.
  await pruneClaudeHookSpool(path.join(installation.spoolDirectory, "absent"), dayMs, TEST_TIME);
});

test("removal leaves a file with no Luke entries byte-for-byte alone", async (t) => {
  const installation = await temporaryInstallation(t);
  // Formatted unlike anything this module writes: compact, no trailing line.
  const foreign = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"afplay /a.aiff"}]}]}}';
  await fs.writeFile(settingsPath(installation), foreign);

  await removeClaudeCodeObservationHooks(installation);

  assert.equal(await fs.readFile(settingsPath(installation), "utf8"), foreign);
});

test("the settings write keeps the file's own mode and leaves no debris", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(settingsPath(installation), "{}\n", { mode: 0o600 });
  await fs.chmod(settingsPath(installation), 0o600);

  await installClaudeCodeObservationHooks(installation);

  // The rename replaced the file, and the user's own protection rode along.
  assert.equal((await fs.stat(settingsPath(installation))).mode & 0o777, 0o600);
  const leftovers = (await fs.readdir(installation.claudeHome)).filter((name) =>
    name.includes(".luke-tmp"),
  );
  assert.deepEqual(leftovers, []);
});

test("the settings write lands through a symlink rather than replacing it", async (t) => {
  const installation = await temporaryInstallation(t);
  // A dotfiles-managed home: settings.json is a link into a synced store.
  const syncedPath = path.join(installation.claudeHome, "synced-settings.json");
  await fs.writeFile(syncedPath, "{}\n");
  await fs.symlink(syncedPath, settingsPath(installation));

  await installClaudeCodeObservationHooks(installation);

  const linked = await fs.lstat(settingsPath(installation));
  assert.ok(linked.isSymbolicLink(), "the link survives the write");
  const synced = JSON.parse(await fs.readFile(syncedPath, "utf8"));
  assert.equal(entryCommands(hookEntries(synced, "Stop")).length, 1);
});
