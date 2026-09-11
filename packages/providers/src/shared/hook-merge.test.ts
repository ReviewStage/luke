import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type ParsedJsonObject, temporaryDirectory } from "@sidecar/wire/testing";
import { type TestContext, test } from "vitest";
import { CLAUDE_HOOK_SPEC } from "../claude-code/hooks.js";
import { CODEX_HOOK_SPEC } from "../codex/hooks.js";
import {
  type ObservationHookInstallation,
  type ObservationHookSpec,
  observationHooksFor,
  pruneObservationHookSpool,
} from "./hook-merge.js";

const execFileAsync = promisify(execFile);

const TEST_TIME = Date.parse("2026-09-01T09:00:00.000Z");
const TEST_SESSION_ID = "3f9a1b2c-4d5e-6789-abcd-ef0123456789";
const SECRET_ENVELOPE_TEXT = "SECRET_ENVELOPE_TEXT";
const USER_COMMAND = "afplay /System/done.aiff";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The guarantees are the shared module's, so they are stated once over every
 * spec the build registers. What each provider calls things is its own file's
 * to assert; nothing here names a provider.
 */
const REGISTERED_SPECS: readonly ObservationHookSpec<string>[] = [
  CLAUDE_HOOK_SPEC,
  CODEX_HOOK_SPEC,
];

async function temporaryInstallation(
  t: TestContext,
  spec: ObservationHookSpec<string>,
): Promise<ObservationHookInstallation> {
  const directory = await temporaryDirectory(t, "luke-hook-merge");
  const providerHome = path.join(directory, "provider-home");
  await fs.mkdir(providerHome, { recursive: true });
  return {
    providerHome,
    hookScriptPath: path.join(directory, "luke-data", spec.scriptName),
    spoolDirectory: path.join(directory, "luke-data", "events"),
  };
}

function configurationPath(
  installation: ObservationHookInstallation,
  spec: ObservationHookSpec<string>,
): string {
  return path.join(installation.providerHome, spec.configurationFileName);
}

async function readConfiguration(
  installation: ObservationHookInstallation,
  spec: ObservationHookSpec<string>,
): Promise<ParsedJsonObject> {
  return JSON.parse(await fs.readFile(configurationPath(installation, spec), "utf8"));
}

function hookEntries(configuration: ParsedJsonObject, eventName: string): unknown[] {
  // SAFETY: the merge writes `hooks` as an object of event names, which is the
  // only shape any assertion below reads it in.
  const events = configuration.hooks as ParsedJsonObject;
  const entries = events?.[eventName];
  return Array.isArray(entries) ? entries : [];
}

function entryCommands(entries: readonly unknown[]): string[] {
  return entries.flatMap((entry) => {
    // SAFETY: a registered entry is `{ hooks: [{ type, command }] }`; a foreign
    // entry is filtered out by the Array check rather than read.
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

function lukeCommands(
  configuration: ParsedJsonObject,
  spec: ObservationHookSpec<string>,
  eventName: string,
): string[] {
  return entryCommands(hookEntries(configuration, eventName)).filter((command) =>
    command.includes(spec.scriptName),
  );
}

/**
 * Runs the installed script the way a provider does. Both delivery shapes the
 * script serves are exercised for every spec: the envelope piped in, and the
 * envelope passed as the argument after the token.
 */
async function runHookScript(
  installation: ObservationHookInstallation,
  eventArgument: string,
  envelope: string,
  delivery: "piped" | "argument",
): Promise<void> {
  if (delivery === "argument") {
    await execFileAsync(installation.hookScriptPath, [eventArgument, envelope]);
    return;
  }
  const envelopeFile = path.join(path.dirname(installation.hookScriptPath), "envelope.json");
  await fs.writeFile(envelopeFile, envelope, "utf8");
  await execFileAsync("sh", [
    "-c",
    `"${installation.hookScriptPath}" "${eventArgument}" < "${envelopeFile}"`,
  ]);
  await fs.rm(envelopeFile, { force: true });
}

for (const spec of REGISTERED_SPECS) {
  const hooks = observationHooksFor(spec);
  const eventNames = Object.keys(spec.registration);
  const anEvent = spec.registration[eventNames[0] ?? ""]?.event ?? "";
  const named = (title: string) => `${spec.configurationFileName}: ${title}`;

  test(named("registers every lifecycle event beside the user's own entries"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.writeFile(
      configurationPath(installation, spec),
      JSON.stringify({
        model: "opus",
        hooks: { [eventNames[0] ?? ""]: [{ hooks: [{ type: "command", command: USER_COMMAND }] }] },
      }),
    );

    await hooks.install(installation);

    const configuration = await readConfiguration(installation, spec);
    // The user's own setting and their own hook both survive as parsed.
    assert.equal(configuration.model, "opus");
    assert.ok(
      entryCommands(hookEntries(configuration, eventNames[0] ?? "")).includes(USER_COMMAND),
    );
    for (const eventName of eventNames) {
      const commands = lukeCommands(configuration, spec, eventName);
      assert.equal(commands.length, 1, `${eventName} carries exactly one entry of Luke's`);
    }
    assert.equal((await fs.stat(installation.hookScriptPath)).mode & 0o777, 0o755);
  });

  test(named("appends its entries after the user's, so their anchors hold still"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    const eventName = eventNames[0] ?? "";
    await fs.writeFile(
      configurationPath(installation, spec),
      JSON.stringify({
        hooks: { [eventName]: [{ hooks: [{ type: "command", command: USER_COMMAND }] }] },
      }),
    );

    await hooks.install(installation);

    const commands = entryCommands(
      hookEntries(await readConfiguration(installation, spec), eventName),
    );
    assert.equal(commands[0], USER_COMMAND);
  });

  test(named("creates the configuration for a provider home that has none yet"), async (t) => {
    const installation = await temporaryInstallation(t, spec);

    await hooks.install(installation);

    const configuration = await readConfiguration(installation, spec);
    assert.equal(lukeCommands(configuration, spec, eventNames[0] ?? "").length, 1);
  });

  test(named("touches nothing on a machine with no provider home at all"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.rm(installation.providerHome, { recursive: true, force: true });

    await hooks.install(installation);

    // No provider directory is created on the provider's behalf, and no script
    // or spool is staged for sessions that cannot exist.
    await assert.rejects(fs.stat(installation.providerHome));
    await assert.rejects(fs.stat(installation.hookScriptPath));
    await assert.rejects(fs.stat(installation.spoolDirectory));
  });

  test(named("leaves a configuration it cannot parse exactly as it was"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    const corrupt = "{ this is not json";
    await fs.writeFile(configurationPath(installation, spec), corrupt);

    await hooks.install(installation);

    assert.equal(await fs.readFile(configurationPath(installation, spec), "utf8"), corrupt);
  });

  test(named("converges rather than accumulates: reinstalling changes nothing"), async (t) => {
    const installation = await temporaryInstallation(t, spec);

    await hooks.install(installation);
    const first = await fs.readFile(configurationPath(installation, spec), "utf8");
    await hooks.install(installation);

    assert.equal(await fs.readFile(configurationPath(installation, spec), "utf8"), first);
  });

  test(named("reconciles entries an older build registered under another path"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    const staleCommand = `/old/data/${spec.scriptName} ${anEvent}`;
    await fs.writeFile(
      configurationPath(installation, spec),
      JSON.stringify({
        hooks: {
          [eventNames[0] ?? ""]: [{ hooks: [{ type: "command", command: staleCommand }] }],
          // An event this build no longer registers is cleaned up too.
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: staleCommand }] }],
        },
      }),
    );

    await hooks.install(installation);

    const configuration = await readConfiguration(installation, spec);
    const commands = lukeCommands(configuration, spec, eventNames[0] ?? "");
    assert.equal(commands.length, 1);
    assert.equal(hookEntries(configuration, "PostToolUse").length, 0);
  });

  test(named("removal strips Luke's entries and leaves the user's standing"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.writeFile(
      configurationPath(installation, spec),
      JSON.stringify({
        model: "opus",
        hooks: { [eventNames[0] ?? ""]: [{ hooks: [{ type: "command", command: USER_COMMAND }] }] },
      }),
    );
    await hooks.install(installation);

    await hooks.remove(installation);

    const configuration = await readConfiguration(installation, spec);
    assert.equal(configuration.model, "opus");
    assert.deepEqual(entryCommands(hookEntries(configuration, eventNames[0] ?? "")), [
      USER_COMMAND,
    ]);
    for (const eventName of eventNames) {
      assert.equal(lukeCommands(configuration, spec, eventName).length, 0);
    }
    await assert.rejects(fs.stat(installation.hookScriptPath));
    await assert.rejects(fs.stat(installation.spoolDirectory));
  });

  test(named("removal drops the hooks container once nothing of the user's remains"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await hooks.install(installation);

    await hooks.remove(installation);

    assert.equal("hooks" in (await readConfiguration(installation, spec)), false);
  });

  test(
    named("removal never creates a configuration, and never rewrites a foreign one"),
    async (t) => {
      const installation = await temporaryInstallation(t, spec);

      await hooks.remove(installation);
      await assert.rejects(fs.stat(configurationPath(installation, spec)));

      // Formatted unlike anything this module writes: compact, no trailing line.
      const foreign =
        '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"afplay /a.aiff"}]}]}}';
      await fs.writeFile(configurationPath(installation, spec), foreign);
      await hooks.remove(installation);
      assert.equal(await fs.readFile(configurationPath(installation, spec), "utf8"), foreign);
    },
  );

  test(named("the write keeps the file's own mode and leaves no debris"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.writeFile(configurationPath(installation, spec), "{}\n", { mode: 0o600 });
    await fs.chmod(configurationPath(installation, spec), 0o600);

    await hooks.install(installation);

    // The rename replaced the file, and the user's own protection rode along.
    assert.equal((await fs.stat(configurationPath(installation, spec))).mode & 0o777, 0o600);
    const leftovers = (await fs.readdir(installation.providerHome)).filter((name) =>
      name.includes(".luke-tmp"),
    );
    assert.deepEqual(leftovers, []);
  });

  test(named("the write lands through a symlink rather than replacing it"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    // A dotfiles-managed home: the configuration is a link into a synced store.
    const syncedPath = path.join(installation.providerHome, "synced-configuration.json");
    await fs.writeFile(syncedPath, "{}\n");
    await fs.symlink(syncedPath, configurationPath(installation, spec));

    await hooks.install(installation);

    assert.ok((await fs.lstat(configurationPath(installation, spec))).isSymbolicLink());
    const synced = JSON.parse(await fs.readFile(syncedPath, "utf8"));
    assert.equal(lukeCommands(synced, spec, eventNames[0] ?? "").length, 1);
  });

  for (const delivery of ["piped", "argument"] as const) {
    test(named(`the script writes one fixed token from a ${delivery} envelope`), async (t) => {
      const installation = await temporaryInstallation(t, spec);
      await hooks.install(installation);
      const envelope = JSON.stringify({
        [spec.sessionIdField]: TEST_SESSION_ID,
        prompt: SECRET_ENVELOPE_TEXT,
      });

      await runHookScript(installation, anEvent, envelope, delivery);

      const spooled = await fs.readFile(
        path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
        "utf8",
      );
      // The whole file is the fixed token: the envelope's text never reaches disk.
      assert.equal(spooled, `{"event":"${anEvent}"}`);
    });
  }

  test(named("a later event replaces the earlier one"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await hooks.install(installation);
    const envelope = JSON.stringify({ [spec.sessionIdField]: TEST_SESSION_ID });
    const laterEvent = spec.registration[eventNames[1] ?? ""]?.event ?? anEvent;

    await runHookScript(installation, anEvent, envelope, "piped");
    await runHookScript(installation, laterEvent, envelope, "piped");

    const spooled = await fs.readFile(
      path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`),
      "utf8",
    );
    assert.equal(spooled, `{"event":"${laterEvent}"}`);
  });

  test(named("the script writes nothing it was not registered to write"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await hooks.install(installation);
    const envelope = (fields: Record<string, string>) => JSON.stringify(fields);

    // A token the build never registered.
    await runHookScript(installation, "made-up-event", envelope({}), "piped");
    // A session id outside the shape the provider mints.
    await runHookScript(
      installation,
      anEvent,
      envelope({ [spec.sessionIdField]: "../../../etc/passwd" }),
      "piped",
    );
    if (spec.subagentField) {
      await runHookScript(
        installation,
        anEvent,
        envelope({ [spec.sessionIdField]: TEST_SESSION_ID, [spec.subagentField]: "subagent-1" }),
        "piped",
      );
    }

    assert.deepEqual(await fs.readdir(installation.spoolDirectory), []);
  });

  if (spec.subagentField) {
    test(named("an empty subagent field does not read as a subagent"), async (t) => {
      const installation = await temporaryInstallation(t, spec);
      await hooks.install(installation);

      await runHookScript(
        installation,
        anEvent,
        JSON.stringify({
          [spec.sessionIdField ?? ""]: TEST_SESSION_ID,
          [spec.subagentField ?? ""]: "",
        }),
        "piped",
      );

      assert.deepEqual(await fs.readdir(installation.spoolDirectory), [`${TEST_SESSION_ID}.json`]);
    });
  }

  test(named("the script is silent once the spool is gone"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await hooks.install(installation);
    await fs.rm(installation.spoolDirectory, { recursive: true, force: true });

    await runHookScript(
      installation,
      anEvent,
      JSON.stringify({ [spec.sessionIdField]: TEST_SESSION_ID }),
      "piped",
    );

    await assert.rejects(fs.stat(installation.spoolDirectory));
  });

  test(named("reads the spooled event back with the file's own clock"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.mkdir(installation.spoolDirectory, { recursive: true });
    const filePath = path.join(installation.spoolDirectory, `${TEST_SESSION_ID}.json`);
    await fs.writeFile(filePath, `{"event":"${anEvent}"}`);
    await fs.utimes(filePath, TEST_TIME / 1000, TEST_TIME / 1000);

    const event = await hooks.read(installation.spoolDirectory, TEST_SESSION_ID);

    assert.equal(event?.event, anEvent);
    assert.equal(event?.atMs, TEST_TIME);
  });

  test(named("reads nothing from a missing, foreign, or oversized spool file"), async (t) => {
    const installation = await temporaryInstallation(t, spec);
    await fs.mkdir(installation.spoolDirectory, { recursive: true });
    const write = (name: string, content: string) =>
      fs.writeFile(path.join(installation.spoolDirectory, `${name}.json`), content);
    await write("unknown-token", '{"event":"reboot"}');
    await write("not-json", "not json at all");
    await write("oversized", `{"event":"${anEvent}","padding":"${"x".repeat(512)}"}`);

    for (const name of ["absent", "unknown-token", "not-json", "oversized"]) {
      assert.equal(await hooks.read(installation.spoolDirectory, name), undefined, name);
    }
  });
}

test("pruning drops only the events past the observation window", async (t) => {
  const directory = await temporaryDirectory(t, "luke-hook-spool");
  const freshPath = path.join(directory, "fresh.json");
  const stalePath = path.join(directory, "stale.json");
  await fs.writeFile(freshPath, '{"event":"stop"}');
  await fs.writeFile(stalePath, '{"event":"stop"}');
  await fs.utimes(freshPath, (TEST_TIME - 60_000) / 1000, (TEST_TIME - 60_000) / 1000);
  await fs.utimes(stalePath, (TEST_TIME - 2 * DAY_MS) / 1000, (TEST_TIME - 2 * DAY_MS) / 1000);

  await pruneObservationHookSpool(directory, DAY_MS, TEST_TIME);

  await fs.stat(freshPath);
  await assert.rejects(fs.stat(stalePath));
  // A spool that does not exist is nothing to prune rather than a failure.
  await pruneObservationHookSpool(path.join(directory, "absent"), DAY_MS, TEST_TIME);
});
