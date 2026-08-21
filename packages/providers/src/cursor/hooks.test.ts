import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  CURSOR_HOOK_EVENT,
  CURSOR_HOOK_SCRIPT_NAME,
  type CursorHookInstallation,
  installCursorObservationHooks,
  readCursorHookEvent,
  removeCursorObservationHooks,
} from "./hooks.js";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-08-20T20:15:00.000Z");
const TEST_SESSION_ID = "1a08731e-7e25-4ff8-acf3-000000000000";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const CURSOR_HOOKS_FILE_NAME = "hooks.json";

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
/** Every lifecycle event the build registers, as Cursor's hooks.json names them. */
const REGISTERED_EVENT_NAMES = [
  "sessionStart",
  "beforeSubmitPrompt",
  "stop",
  "sessionEnd",
] as const;

async function temporaryInstallation(t: TestContext): Promise<CursorHookInstallation> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "luke-cursor-hooks-"));
  t.after(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });
  const cursorHome = path.join(directory, "cursor-home");
  await fs.mkdir(cursorHome, { recursive: true });
  return {
    cursorHome,
    hookScriptPath: path.join(directory, "luke-data", CURSOR_HOOK_SCRIPT_NAME),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

function hooksPath(installation: CursorHookInstallation): string {
  return path.join(installation.cursorHome, CURSOR_HOOKS_FILE_NAME);
}

async function readHooksFile(installation: CursorHookInstallation): Promise<ParsedJsonObject> {
  return JSON.parse(await fs.readFile(hooksPath(installation), "utf8"));
}

function hookEntries(configuration: ParsedJsonObject, eventName: string): unknown[] {
  // SAFETY: Parsed JSON matches the event object shape this harness exercises.
  const events = configuration.hooks as ParsedJsonObject;
  const entries = events[eventName];
  return Array.isArray(entries) ? entries : [];
}

/** Cursor's entries are the command records themselves, with no nesting. */
function entryCommands(entries: unknown[]): string[] {
  // SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
  return entries
    .map((entry) => (entry as { command?: unknown }).command)
    .filter(
      (command): command is string => Object.prototype.toString.call(command) === "[object String]",
    );
}

/**
 * Runs the installed script the way Cursor would: the event as its one
 * argument, the envelope as JSON on stdin, and stdout read back as the hook's
 * JSON answer.
 */
async function pipeToHookScript(
  installation: CursorHookInstallation,
  eventArgument: string,
  envelope: string,
): Promise<string> {
  const envelopeFile = path.join(path.dirname(installation.hookScriptPath), "envelope.json");
  await fs.writeFile(envelopeFile, envelope, "utf8");
  const { stdout } = await execFileAsync("sh", [
    "-c",
    `"${installation.hookScriptPath}" "${eventArgument}" < "${envelopeFile}"`,
  ]);
  await fs.rm(envelopeFile, { force: true });
  return stdout;
}

test("registers every lifecycle event beside the user's own flat entries", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    hooksPath(installation),
    JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: "afplay /System/done.aiff" }],
      },
    }),
  );

  await installCursorObservationHooks(installation);

  const configuration = await readHooksFile(installation);
  // The user's own hook survives the merge untouched, ahead of Luke's.
  const stopCommands = entryCommands(hookEntries(configuration, "stop"));
  assert.equal(stopCommands[0], "afplay /System/done.aiff");
  assert.equal(configuration.version, 1);
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const commands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(CURSOR_HOOK_SCRIPT_NAME),
    );
    assert.equal(commands.length, 1, `${eventName} carries exactly one Luke entry`);
    // Guarded on the script's own presence, and the fallback drains the piped
    // envelope and answers the empty decision, because Cursor reads stdout as
    // the hook's JSON answer.
    assert.ok(commands[0]?.startsWith(`[ -x "${installation.hookScriptPath}" ]`));
    assert.ok(commands[0]?.endsWith(`|| { cat >/dev/null 2>&1; printf '{}'; }`));
  }

  const script = await fs.readFile(installation.hookScriptPath, "utf8");
  assert.ok(script.includes(installation.spoolDirectory));
  const mode = (await fs.stat(installation.hookScriptPath)).mode & 0o777;
  assert.equal(mode, 0o755);
});

test("a file being created gets the documented version beside the hooks", async (t) => {
  const installation = await temporaryInstallation(t);

  await installCursorObservationHooks(installation);

  const configuration = await readHooksFile(installation);
  assert.equal(configuration.version, 1);
});

test("the user's own schema version is never rewritten", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(hooksPath(installation), JSON.stringify({ version: 2, hooks: {} }));

  await installCursorObservationHooks(installation);

  assert.equal((await readHooksFile(installation)).version, 2);
});

test("touches nothing on a machine with no Cursor home at all", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.rm(installation.cursorHome, { recursive: true, force: true });

  await installCursorObservationHooks(installation);

  await assert.rejects(fs.stat(installation.cursorHome));
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("leaves a hooks file it cannot parse exactly as it was", async (t) => {
  const installation = await temporaryInstallation(t);
  const corrupt = "{ this is not json";
  await fs.writeFile(hooksPath(installation), corrupt);

  await installCursorObservationHooks(installation);

  assert.equal(await fs.readFile(hooksPath(installation), "utf8"), corrupt);
});

test("converges rather than accumulates: reinstalling changes nothing", async (t) => {
  const installation = await temporaryInstallation(t);

  await installCursorObservationHooks(installation);
  const first = await fs.readFile(hooksPath(installation), "utf8");
  await installCursorObservationHooks(installation);

  assert.equal(await fs.readFile(hooksPath(installation), "utf8"), first);
});

test("removal strips Luke's flat entries and leaves the user's standing", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.writeFile(
    hooksPath(installation),
    JSON.stringify({
      version: 1,
      hooks: {
        stop: [{ command: "afplay /System/done.aiff" }],
      },
    }),
  );
  await installCursorObservationHooks(installation);

  await removeCursorObservationHooks(installation);

  const configuration = await readHooksFile(installation);
  assert.deepEqual(entryCommands(hookEntries(configuration, "stop")), ["afplay /System/done.aiff"]);
  for (const eventName of REGISTERED_EVENT_NAMES) {
    const lukeCommands = entryCommands(hookEntries(configuration, eventName)).filter((command) =>
      command.includes(CURSOR_HOOK_SCRIPT_NAME),
    );
    assert.equal(lukeCommands.length, 0, `${eventName} carries no Luke entry after removal`);
  }
  await assert.rejects(fs.stat(installation.hookScriptPath));
  await assert.rejects(fs.stat(installation.spoolDirectory));
});

test("the script writes one fixed token and answers the empty decision", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCursorObservationHooks(installation);
  const envelope = JSON.stringify({
    hook_event_name: "stop",
    conversation_id: TEST_SESSION_ID,
    status: "completed",
    prompt: SECRET_ENVELOPE_TEXT,
  });

  const answer = await pipeToHookScript(installation, CURSOR_HOOK_EVENT.STOP, envelope);

  // Cursor reads stdout as the hook's JSON answer; observing decides nothing.
  assert.equal(answer, "{}");
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

test("the script answers the empty decision even when it records nothing", async (t) => {
  const installation = await temporaryInstallation(t);
  await installCursorObservationHooks(installation);

  // A token the build never registered — Claude Code's failure token — and a
  // session id outside the shape Cursor mints each leave the spool empty, and
  // each still answers, so Cursor never reads silence where it expects JSON.
  const refusedToken = await pipeToHookScript(
    installation,
    "stop-failure",
    JSON.stringify({ conversation_id: TEST_SESSION_ID }),
  );
  const refusedId = await pipeToHookScript(
    installation,
    CURSOR_HOOK_EVENT.STOP,
    JSON.stringify({ conversation_id: "../../../etc/passwd" }),
  );

  assert.equal(refusedToken, "{}");
  assert.equal(refusedId, "{}");
  assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
});

test("reads the spooled event back with the file's own clock", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  const filePath = path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`);
  await fs.writeFile(filePath, '{"event":"session-end"}');
  await fs.utimes(filePath, TEST_TIME / 1000, TEST_TIME / 1000);

  const event = await readCursorHookEvent(installation.spoolDirectory, TEST_SESSION_ID);

  assert.equal(event?.event, CURSOR_HOOK_EVENT.SESSION_END);
  assert.equal(event?.atMs, TEST_TIME);
});

test("reads nothing from a token outside Cursor's own vocabulary", async (t) => {
  const installation = await temporaryInstallation(t);
  await fs.mkdir(installation.spoolDirectory, { recursive: true });
  await fs.writeFile(
    path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
    '{"event":"notification"}',
  );

  assert.equal(await readCursorHookEvent(installation.spoolDirectory, TEST_SESSION_ID), undefined);
});
