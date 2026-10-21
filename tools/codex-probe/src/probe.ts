/**
 * probe.ts -- the live run: a Vercel Sandbox from today's image plus the pinned Codex, `codex app-server` as `agent` on the ChatGPT plan, the turns that exercise it, the restart on a refreshed token, and every seat the token must not be read from.
 *
 * The run opens its own sandbox from the linked Vercel project (the SDK
 * reads `.vercel/project.json` and the CLI's sign-in), prepares it with the
 * same `prepareImage` every Luke agent's snapshot is made with, installs the
 * pinned Codex root-owned and creates `agent`, and deletes the sandbox at the
 * end whatever happened. It gathers `Observations` for `checks.ts` to judge
 * and returns them with the recording; it prints only progress lines.
 */

import { randomBytes } from "node:crypto";
import { prepareImage } from "@luke/service/agents/agent-runtime/sandbox-image";
import { isRecord, isWireString, type WireValue } from "@luke/wire";
import { type NetworkPolicy, Sandbox } from "@vercel/sandbox";
import {
  AGENT_USER,
  CLIENT_INFO,
  CODEX,
  launchSpec,
  METHOD,
  type ServerMessage,
  textInput,
} from "./app-server.js";
import {
  type Observations,
  type RecordedMessage,
  readScan,
  type ScanReport,
  sha256Hex,
} from "./checks.js";
import {
  type ChatGptCredentials,
  discoverEndpoints,
  type Fetch,
  refreshCredentials,
} from "./oauth.js";
import {
  DROP_CAPS,
  dropSudoScript,
  PROBE_FILES,
  PROBE_SCRIPTS,
  setupScript,
  stagedPath,
  WRITABLE_LAUNCH_PATHS_SCRIPT,
} from "./sandbox-scripts.js";
import { AppServerSession } from "./session.js";

/** The run's bounds. */
export const PROBE_BOUNDS = {
  SANDBOX_TIMEOUT_MS: 90 * 60 * 1000,
  VCPUS: 4,
  /** The whole of one app-server process's conversation. */
  SESSION_MS: 40 * 60 * 1000,
  /** How long the stand-in CI watch runs before it passes: past Codex's 5-minute poll cap. */
  CI_SECONDS: 420,
} as const;

/** What the run is told by the command line. */
export interface ProbeOptions {
  readonly credentials: ChatGptCredentials;
  readonly fetch: Fetch;
  readonly say: (line: string) => void;
  /** A throwaway repository as `owner/name`, cloned through the firewall's GitHub token; none for a local repository. */
  readonly githubRepository: string | undefined;
  /** The GitHub token set at the firewall for that repository; never enters the sandbox. */
  readonly githubToken: string | undefined;
  readonly model: string | undefined;
  readonly ciSeconds: number;
}

/** What the run hands back: what it saw, the recording, and the secrets the sanitizer must know. */
export interface ProbeRun {
  readonly observations: Observations;
  readonly recorded: readonly RecordedMessage[];
  readonly credentials: readonly ChatGptCredentials[];
  readonly notes: readonly string[];
}

/** A GitHub `owner/name`, as GitHub allows the two: letters, digits, `-`, `_` and `.`. */
const GITHUB_REPOSITORY = /^[A-Za-z0-9-]+\/[\w.-]+$/u;

/** The `--repository` value read as a GitHub `owner/name`, or a refusal naming what it must look like. */
export function readGithubRepository(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!GITHUB_REPOSITORY.test(value) || value.includes("..")) {
    throw new Error(`--repository must be a GitHub owner/name, such as acme/throwaway`);
  }
  return value;
}

/** The firewall policy that sets a GitHub token on GitHub's hosts, as Luke's agents have it today. */
function githubPolicy(token: string): NetworkPolicy {
  const authorization = `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
  const rule = [{ transform: [{ headers: { authorization } }] }];
  return { allow: { "*": [], "github.com": rule, "api.github.com": rule } };
}

/** A command run to its end in the sandbox, its output read. */
async function run(
  sandbox: Sandbox,
  params: {
    cmd: string;
    args?: readonly string[];
    sudo?: boolean;
    env?: Readonly<Record<string, string>>;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const finished = await sandbox.runCommand({
    cmd: params.cmd,
    args: [...(params.args ?? [])],
    sudo: params.sudo ?? false,
    env: { ...params.env },
  });
  return {
    exitCode: finished.exitCode,
    stdout: await finished.stdout(),
    stderr: await finished.stderr(),
  };
}

/** A shell script run as the default user, or as root through the API. */
function bash(sandbox: Sandbox, script: string, sudo = false) {
  return run(sandbox, { cmd: "bash", args: ["-c", script], sudo });
}

/** A step that must succeed, its stderr's tail in the error. */
async function must(
  step: string,
  result: Promise<{ exitCode: number; stdout: string; stderr: string }>,
) {
  const done = await result;
  if (done.exitCode !== 0)
    throw new Error(`${step} failed (${done.exitCode}): ${done.stderr.slice(-600)}`);
  return done;
}

/** The session `prepareImage` takes: eve's, of which it and the code tooling call three methods. */
type EveSession = Parameters<typeof prepareImage>[0];

/** The adapter `prepareImage` is handed: eve's session surface over the SDK's sandbox, the three calls it makes. */
function eveSessionOver(sandbox: Sandbox): EveSession {
  const resolvePath = (path: string) => (path.startsWith("/") ? path : `/vercel/sandbox/${path}`);
  const session: Pick<EveSession, "run" | "writeTextFile" | "resolvePath"> = {
    resolvePath,
    run: async (options: { command: string }) => bash(sandbox, options.command),
    writeTextFile: async (options: { path: string; content: string }) =>
      sandbox.writeFiles([{ path: resolvePath(options.path), content: options.content }]),
  };
  // SAFETY: `prepareImage` and the code tooling it installs call only `run`, `writeTextFile` and
  // `resolvePath` (eve 0.74.0's `installCodeTooling` and `toolingPaths`), which this object implements.
  return session as EveSession;
}

/** The app-server started as `agent` with the token in its environment alone. */
async function startAppServer(
  sandbox: Sandbox,
  accessToken: string,
  phase: string,
  recorded: RecordedMessage[],
): Promise<AppServerSession> {
  const spec = launchSpec({ accessToken });
  const command = await sandbox.runCommand({
    cmd: spec.cmd,
    args: [...spec.args],
    env: { ...spec.env },
    sudo: spec.sudo,
    detached: true,
    stdin: true,
  });
  const session = new AppServerSession(
    command,
    phase,
    recorded,
    AbortSignal.timeout(PROBE_BOUNDS.SESSION_MS),
  );
  await session.request(METHOD.INITIALIZE, { clientInfo: { ...CLIENT_INFO }, capabilities: null });
  await session.notify(METHOD.INITIALIZED);
  return session;
}

/** A field of a response's result record, as text. */
function resultText(message: ServerMessage, ...path: readonly string[]): string | undefined {
  let value: WireValue | undefined = message.kind === "response" ? message.result : undefined;
  for (const key of path) value = isRecord(value) ? value[key] : undefined;
  return isWireString(value) ? value : undefined;
}

/** Whether a message is a notification of this method whose item satisfies the test. */
function itemStarted(message: ServerMessage, test: (command: string) => boolean): boolean {
  if (message.kind !== "notification" || message.method !== METHOD.ITEM_STARTED) return false;
  const item = message.params.item;
  return (
    isRecord(item) &&
    item.type === "commandExecution" &&
    isWireString(item.command) &&
    test(item.command)
  );
}

/** Whether a message is the end of a turn. */
function turnCompleted(message: ServerMessage): boolean {
  return message.kind === "notification" && message.method === METHOD.TURN_COMPLETED;
}

/** The model the thread runs on: the one asked for, or the catalog's default. */
async function chooseModel(
  session: AppServerSession,
  asked: string | undefined,
): Promise<string | undefined> {
  if (asked !== undefined) return asked;
  const listed = await session.request(METHOD.MODEL_LIST, {});
  const result = listed.result;
  const models = isRecord(result) && Array.isArray(result.data) ? result.data.filter(isRecord) : [];
  const chosen = models.find((one) => one.isDefault === true) ?? models[0];
  return chosen !== undefined && isWireString(chosen.model) ? chosen.model : undefined;
}

/** The first turn's instructions: an edit, the scanner, the MCP tool, and the long watch to wait out. */
function firstTurnPrompt(nonce: string, ciMarker: string, ciSeconds: number): string {
  return [
    "You are being exercised by Luke's sandbox probe. Do these steps in order with your tools:",
    `1. Create PROBE.md in the current directory containing exactly the line ${nonce}.`,
    `2. Run \`node ${PROBE_FILES.SCANNER}\` once and keep its output; do not run it any other way.`,
    `3. Call the \`echo\` tool of the \`luke_probe\` MCP server with the text ${nonce}.`,
    `4. Run \`${PROBE_FILES.CI_WATCH} ${ciSeconds} ${ciMarker}\`. It behaves like \`gh pr checks --watch\` and takes about ${Math.ceil(ciSeconds / 60)} minutes. Wait for it to finish however long it takes; never stop it early.`,
    "5. Reply with the last line the watch printed.",
  ].join("\n");
}

/** The run's turns on the first app-server: the work, the steer during the watch, and an interrupted turn. */
async function firstSession(
  session: AppServerSession,
  options: ProbeOptions,
  markers: { nonce: string; steerMarker: string; ciMarker: string },
): Promise<{ threadId: string; steerTurnId: string | undefined }> {
  const model = await chooseModel(session, options.model);
  options.say(`Thread on model ${model ?? "(provider default)"}.`);
  const base = { cwd: PROBE_FILES.REPOSITORY, approvalPolicy: "never", sandbox: "workspace-write" };
  const started = await session.request(
    METHOD.THREAD_START,
    model === undefined ? base : { ...base, model },
  );
  const threadId = resultText(started, "thread", "id");
  if (threadId === undefined) throw new Error("thread/start answered no thread id");
  const turn = await session.request(METHOD.TURN_START, {
    threadId,
    input: textInput(firstTurnPrompt(markers.nonce, markers.ciMarker, options.ciSeconds)),
  });
  const turnId = resultText(turn, "turn", "id") ?? "";
  options.say("Turn 1 running; steering once the CI watch starts.");
  const watching = await session.until(
    (message) =>
      itemStarted(message, (command) => command.includes(PROBE_FILES.CI_WATCH)) ||
      turnCompleted(message),
  );
  let steerTurnId: string | undefined;
  if (!turnCompleted(watching)) {
    const steer = await session
      .request(METHOD.TURN_STEER, {
        threadId,
        expectedTurnId: turnId,
        input: textInput(
          `Also, before your final reply, append the line ${markers.steerMarker} to PROBE.md.`,
        ),
      })
      .catch(() => undefined);
    steerTurnId = steer === undefined ? undefined : resultText(steer, "turnId");
    await session.until(turnCompleted);
  }
  options.say("Turn 2: a command to interrupt.");
  const second = await session.request(METHOD.TURN_START, {
    threadId,
    input: textInput("Run `sleep 600` and wait for it to finish."),
  });
  const secondId = resultText(second, "turn", "id") ?? "";
  const sleeping = await session.until(
    (message) =>
      itemStarted(message, (command) => command.includes("sleep")) || turnCompleted(message),
  );
  if (!turnCompleted(sleeping)) {
    await session.request(METHOD.TURN_INTERRUPT, { threadId, turnId: secondId });
    await session.until(turnCompleted);
  }
  return { threadId, steerTurnId };
}

/** The scanner run from one seat, its report read back. */
async function scanFrom(
  sandbox: Sandbox,
  prefix: readonly string[],
  args: readonly string[],
  sudo = false,
) {
  const [cmd, ...rest] = [...prefix, "node", PROBE_FILES.SCANNER, ...args];
  const done = await run(sandbox, { cmd: cmd ?? "node", args: rest, sudo });
  return readScan(done.stdout);
}

/** The sandbox prepared: today's image, the probe's files, Codex, `agent`, and the throwaway repository. */
async function prepare(
  sandbox: Sandbox,
  options: ProbeOptions,
): Promise<{ defaultUser: string; defaultGroup: string }> {
  options.say("Preparing today's image (prepareImage); this takes several minutes.");
  await prepareImage(eveSessionOver(sandbox));
  const who = await must("id", bash(sandbox, "id -un; id -gn"));
  const [defaultUser = "vercel-sandbox", defaultGroup = defaultUser] = who.stdout
    .trim()
    .split("\n");
  await sandbox.writeFiles(
    PROBE_SCRIPTS.map((script) => ({ path: stagedPath(script.path), content: script.source })),
  );
  options.say(`Installing ${CODEX.PACKAGE}@${CODEX.VERSION} and the agent user.`);
  await must("setup", bash(sandbox, setupScript(defaultGroup), true));
  const asAgent = [
    "setpriv",
    `--reuid=${AGENT_USER.NAME}`,
    `--regid=${AGENT_USER.NAME}`,
    "--init-groups",
    "--",
  ];
  const repository = PROBE_FILES.REPOSITORY;
  const clone =
    options.githubRepository === undefined
      ? `cd ${repository} && git init -q && echo '# Luke probe' > README.md`
      : `git clone -q "https://github.com/$1.git" "$2"`;
  await must(
    "repository",
    run(sandbox, {
      cmd: asAgent[0] ?? "setpriv",
      // The repository's name reaches the script as an argument, never spliced into its text.
      args: [
        ...asAgent.slice(1),
        "bash",
        "-c",
        clone,
        "clone",
        options.githubRepository ?? "",
        repository,
      ],
      sudo: true,
      env: { HOME: AGENT_USER.HOME },
    }),
  );
  return { defaultUser, defaultGroup };
}

/** The session files Codex keeps under `CODEX_HOME`, by path. */
async function sessionFiles(sandbox: Sandbox): Promise<readonly string[]> {
  const listed = await bash(
    sandbox,
    `find ${AGENT_USER.CODEX_HOME} -maxdepth 6 -type f \\( -path '*/sessions/*' -o -name '*.sqlite' \\) | sort`,
    true,
  );
  return listed.stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * The whole live run. Each phase that fails leaves the checks that needed it
 * skipped rather than ending the run, so one refusal still reports the rest.
 */
export async function runProbe(options: ProbeOptions): Promise<ProbeRun> {
  const recorded: RecordedMessage[] = [];
  const notes: string[] = [];
  const nonce = `luke-probe-${randomBytes(6).toString("hex")}`;
  const markers = { nonce, steerMarker: `${nonce}-steered`, ciMarker: `${nonce}-ci` };
  const credentials: ChatGptCredentials[] = [options.credentials];
  let terminal: ScanReport | undefined;
  let terminalNoCaps: ScanReport | undefined;
  let disk: ScanReport | undefined;
  let steerTurnId: string | undefined;
  let probeFile: string | undefined;
  let refreshed: boolean | undefined;
  let resumedTurnCount: number | undefined;
  let defaultUserSudoAfterDrop: boolean | undefined;
  let apiSudoAfterDrop: boolean | undefined;
  let writablePaths: readonly string[] | undefined;
  options.say("Opening a Vercel Sandbox from the linked project.");
  const sandbox = await Sandbox.create({
    runtime: "node24",
    persistent: true,
    keepLastSnapshots: { count: 1 },
    timeout: PROBE_BOUNDS.SANDBOX_TIMEOUT_MS,
    resources: { vcpus: PROBE_BOUNDS.VCPUS },
    tags: { purpose: "luke-codex-probe" },
    networkPolicy:
      options.githubToken === undefined ? "allow-all" : githubPolicy(options.githubToken),
  });
  try {
    const { defaultUser } = await prepare(sandbox, options);
    writablePaths = (await bash(sandbox, WRITABLE_LAUNCH_PATHS_SCRIPT)).stdout
      .split("\n")
      .filter((line) => line.startsWith("WRITABLE "))
      .map((line) => line.slice("WRITABLE ".length));
    let threadId: string | undefined;
    const first = await startAppServer(
      sandbox,
      options.credentials.tokens.accessToken,
      "first",
      recorded,
    );
    try {
      ({ threadId, steerTurnId } = await firstSession(first, options, markers));
    } catch (cause) {
      notes.push(`first session: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      await first.close();
    }
    probeFile = (
      await sandbox.readFileToBuffer({ path: `${PROBE_FILES.REPOSITORY}/PROBE.md` })
    )?.toString("utf8");
    options.say("Refreshing the token, stopping and resuming the sandbox.");
    try {
      const endpoints = await discoverEndpoints(options.fetch);
      const next = await refreshCredentials(
        options.fetch,
        endpoints,
        options.credentials,
        Date.now(),
      );
      credentials.push(next);
      refreshed = next.tokens.accessToken !== options.credentials.tokens.accessToken;
    } catch (cause) {
      refreshed = false;
      notes.push(`refresh: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    await sandbox.stop();
    const resumed = await Sandbox.get({ name: sandbox.name, resume: true });
    const token = (credentials.at(-1) ?? options.credentials).tokens.accessToken;
    const second = await startAppServer(resumed, token, "resumed", recorded);
    try {
      if (threadId !== undefined) {
        const back = await second.request(METHOD.THREAD_RESUME, {
          threadId,
          cwd: PROBE_FILES.REPOSITORY,
          approvalPolicy: "never",
          sandbox: "workspace-write",
        });
        const thread =
          back.result !== undefined && isRecord(back.result) ? back.result.thread : undefined;
        resumedTurnCount =
          isRecord(thread) && Array.isArray(thread.turns) ? thread.turns.length : 0;
        await second.request(METHOD.TURN_START, {
          threadId,
          input: textInput(
            "What exact line did you first write to PROBE.md? Reply with that line only.",
          ),
        });
        await second.until(turnCompleted);
      }
      options.say("Scanning for the token from every seat while Codex holds it.");
      terminal = await scanFrom(resumed, [], []);
      terminalNoCaps = await scanFrom(resumed, DROP_CAPS, []);
      disk = await scanFrom(
        resumed,
        [],
        ["--no-proc", "/home", "/tmp", "/opt", "/srv", "/var/tmp", "/root", "/etc", "/vercel"],
        true,
      );
      notes.push(`Codex's state under CODEX_HOME: ${(await sessionFiles(resumed)).join(", ")}`);
    } catch (cause) {
      notes.push(`resumed session: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      await second.close();
    }
    options.say("Dropping the default user's sudo, as P03 would.");
    await must("drop sudo", bash(resumed, dropSudoScript(defaultUser), true));
    defaultUserSudoAfterDrop = (await bash(resumed, "sudo -n true")).exitCode === 0;
    apiSudoAfterDrop = (await bash(resumed, "id -u", true)).stdout.trim() === "0";
  } finally {
    await sandbox.delete().catch(() => undefined);
  }
  const usage = recorded.length;
  notes.push(`${usage} app-server messages recorded`);
  return {
    observations: {
      signedIn: true,
      ...markers,
      ciSeconds: options.ciSeconds,
      tokenSha256: credentials.map((one) => sha256Hex(one.tokens.accessToken)),
      messages: recorded,
      steerTurnId,
      probeFile,
      refreshed,
      resumedTurnCount,
      scans: { terminal, terminalNoCaps, disk },
      defaultUserSudoAfterDrop,
      apiSudoAfterDrop,
      writablePaths,
    },
    recorded,
    credentials,
    notes,
  };
}
