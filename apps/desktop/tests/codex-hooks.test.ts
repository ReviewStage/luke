import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import {
  CODEX_HOOK_EVENT,
  CODEX_HOOK_SCRIPT_NAME,
  type CodexHookInstallation,
  installCodexObservationHooks,
  readCodexHookEvent,
  removeCodexObservationHooks,
} from "../src/codex-hooks";
import type { ParsedJsonObject } from "./support/json";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-08-16T20:15:00.000Z");
const TEST_SESSION_ID = "0198c1f2-4d5e-7789-abcd-ef0123456789";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const CODEX_HOOKS_FILE_NAME = "hooks.json";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
/** Every lifecycle event the build registers, as hooks.json names them. */
const REGISTERED_EVENT_NAMES = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "PermissionRequest",
  "SessionEnd",
] as const;

async function temporaryInstallation(t: TestContext): Promise<CodexHookInstallation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-codex-hooks-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const codexHome = path.join(directory, "codex-home");
  await fs.mkdir(codexHome, { recursive: true });
  return {
    codexHome,
    hookScriptPath: path.join(directory, "luke-data", CODEX_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

function hooksPath(installation: CodexHookInstallation): string {
  return path.join(installation.codexHome, CODEX_HOOKS_FILE_NAME);
}

async function readHooksFile(installation: CodexHookInstallation): Promise<ParsedJsonObject> {
  return JSON.parse(await fs.readFile(hooksPath(installation), "utf8"));
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
 * Runs the installed script the way Codex would: the event as its one
 * argument, the envelope as JSON on stdin. `execFile` cannot feed stdin, so
 * the envelope rides in from a file beside the script through `sh -c`.
 */
async function pipeToHookScript(
  installation: CodexHookInstallation,
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

/**
 * Runs the installed script the other way an agent can hand an envelope over:
 // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
 * as the argument after the token, with nothing on stdin at all. The script
 * must not sit waiting on a pipe no one is writing.
 */
async function callHookScript(
  installation: CodexHookInstallation,
  eventArgument: string,
  envelope: string,
): Promise<void> {
  await execFileAsync("sh", [
    "-c",
    `"${installation.hookScriptPath}" "$1" "$2" < /dev/null`,
    "sh",
    eventArgument,
    envelope,
  ]);
}

test("registers every lifecycle event beside the user's own hooks", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    hooksPath(installation),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );

  await installCodexObservationHooks(installation);

  const configuration = await readHooksFile(installation);
  // The user's own hook survives the merge untouched.
  const stopCommands = entryCommands(hookEntries(configuration, "Stop"));
  assert.ok(stopCommands.includes("afplay /System/done.aiff"));
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const commands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(CODEX_HOOK_SCRIPT_NAME),
    );
    assert.equal(commands.length, 1, `${eventName} carries exactly one Luke entry`);
    // Guarded on the script's own presence and always exiting zero, so an
    // entry outliving an uninstalled Luke is a no-op — and a PermissionRequest
    // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
    // hook can never read as a decision.
    assert.ok(commands[0]?.startsWith(`[ -x "${installation.hookScriptPath}" ]`));
    assert.ok(commands[0]?.endsWith("|| true"));
  }

  const script = await fs.readFile(installation.hookScriptPath, "utf8");
  assert.ok(script.includes(installation.spoolDirectory));
  const mode = (await fs.stat(installation.hookScriptPath)).mode & 0o777;
  assert.equal(mode, 0o755);
});

test("touches nothing on a machine with no Codex home at all", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.rm(installation.codexHome, { recursive: true, force: true });

  await installCodexObservationHooks(installation);

  await assert.rejects(fs.stat(installation.codexHome));
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("leaves a hooks file it cannot parse exactly as it was", async (t) => {
  const installation = await temporaryInstallation(t);
  const corrupt = "{ this is not json";
  await fs.writeFile(hooksPath(installation), corrupt);

  await installCodexObservationHooks(installation);

  assert.equal(await fs.readFile(hooksPath(installation), "utf8"), corrupt);
});

test("converges rather than accumulates: reinstalling changes nothing", async (t) => {
  const installation = await temporaryInstallation(t);

  await installCodexObservationHooks(installation);
  const first = await fs.readFile(hooksPath(installation), "utf8");
  await installCodexObservationHooks(installation);

  assert.equal(await fs.readFile(hooksPath(installation), "utf8"), first);
});

test("appends its entries after the user's, so their trust anchors hold still", async (t) => {
  const installation = await temporaryInstallation(t);
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  // Codex trusts a hook by its position in the file as well as its content,
  // so a merge that slid a user's entry down a slot would silently stop it.
  await fs.writeFile(
    hooksPath(installation),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );

  await installCodexObservationHooks(installation);
  await installCodexObservationHooks(installation);

  const stopCommands = entryCommands(hookEntries(await readHooksFile(installation), "Stop"));
  assert.equal(stopCommands[0], "afplay /System/done.aiff");
  assert.equal(stopCommands.length, 2);
});

test("removal strips Luke's entries and leaves the user's hooks standing", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    hooksPath(installation),
    JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "afplay /System/done.aiff" }] }],
      },
    }),
  );
  await installCodexObservationHooks(installation);

  await removeCodexObservationHooks(installation);

  const configuration = await readHooksFile(installation);
  assert.deepEqual(entryCommands(hookEntries(configuration, "Stop")), ["afplay /System/done.aiff"]);
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const lukeCommands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(CODEX_HOOK_SCRIPT_NAME),
    );
    assert.equal(lukeCommands.length, 0, `${eventName} carries no Luke entry after removal`);
  }
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("the script writes one fixed token from a piped envelope", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);
  const envelope = JSON.stringify({
    hook_event_name: "Stop",
    session_id: TEST_SESSION_ID,
    transcript_path: `/somewhere/rollout-${TEST_SESSION_ID}.jsonl`,
    last_assistant_message: SECRET_ENVELOPE_TEXT,
  });

  await pipeToHookScript(installation, CODEX_HOOK_EVENT.STOP, envelope);

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

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("the script accepts an envelope passed as its argument too", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);
  const envelope = JSON.stringify({ session_id: TEST_SESSION_ID, prompt: SECRET_ENVELOPE_TEXT });

  await callHookScript(installation, CODEX_HOOK_EVENT.PROMPT, envelope);

  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  assert.equal(spooled, '{"event":"prompt"}');
  for (const entry of await fs.readdir(installation.spoolDirectory)) {
    const content = await fs.readFile(path.join(installation.spoolDirectory, entry), "utf8");
    assert.ok(!content.includes(SECRET_ENVELOPE_TEXT));
  }
});

test("the script refuses a token the build never registered", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);

  // Claude Code's spool speaks this token; Codex's build must not.
  await pipeToHookScript(
    installation,
    "stop-failure",
    JSON.stringify({ session_id: TEST_SESSION_ID }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("the script skips a subagent's events", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);

  await pipeToHookScript(
    installation,
    CODEX_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: TEST_SESSION_ID, agent_id: "subagent-1" }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("an empty agent_id does not read as a subagent", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);

  // A provider that serializes the field on every envelope, empty outside a
  // subagent, must not silence the hook whole.
  await pipeToHookScript(
    installation,
    CODEX_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: TEST_SESSION_ID, agent_id: null }),
  );

  const spooled = await fs.readFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    "utf8",
  );
  assert.equal(spooled, '{"event":"stop"}');
});

test("the script refuses a session id outside the shape Codex mints", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCodexObservationHooks(installation);

  await pipeToHookScript(
    installation,
    CODEX_HOOK_EVENT.STOP,
    JSON.stringify({ session_id: "../../../etc/passwd" }),
  );

  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("reads the spooled event back with the file's own clock", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const filePath = path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`);
  await fs.writeFile(filePath, '{"event":"notification"}');
  await fs.utimes(filePath, TEST_TIME / 1000, TEST_TIME / 1000);

  const event = await readCodexHookEvent(installation.spoolDirectory, TEST_SESSION_ID);

  assert.equal(event?.event, CODEX_HOOK_EVENT.NOTIFICATION);
  assert.equal(event?.atMs, TEST_TIME);
});

test("reads nothing from a token outside Codex's own vocabulary", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  await fs.writeFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    '{"event":"stop-failure"}',
  );

  assert.equal(await readCodexHookEvent(installation.spoolDirectory, TEST_SESSION_ID), undefined);
});
