/**
 * cli.ts -- the probe itself: opens a Vercel Sandbox from today's image plus Claude Code, runs the plan's turns as the agent user, stops and resumes, and prints whether each of P00's two checks held.
 *
 *   LUKE_PROBE_CLAUDE_OAUTH_TOKEN=… LUKE_PROBE_GITHUB_TOKEN=… \
 *     LUKE_PROBE_REPOSITORY=owner/throwaway pnpm probe:claude-code
 *
 * Run once, by the developer, from a `vercel link`ed checkout: the Sandbox
 * SDK reads the linked project and the Vercel CLI's own sign-in for its OIDC
 * token, so nothing is pulled into a file. The Claude token is a `claude
 * setup-token` of a Max account; the GitHub token reaches the throwaway
 * repository and stands at the sandbox's firewall alone, on that
 * repository's git path, as a coding agent's does today. Neither is printed,
 * passed in argv, or written anywhere: the Claude token reaches the sandbox
 * as the first line of the driver's stdin and lives in the CLI's environment
 * there. `LUKE_PROBE_KEEP_SANDBOX=1` keeps the sandbox for a look afterwards;
 * `LUKE_PROBE_MODEL` names another model than the default.
 *
 * What the run saw is sanitized (`sanitize.ts`) and written over the
 * committed fixtures: the SDK's message stream, and a report of the pins,
 * the options, the image's findings, and every condition of the verdict.
 * The process exits non-zero when any condition failed.
 */

import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { NodeRuntime } from "@effect/platform-node";
import { PREPARE_SCRIPT } from "@luke/service/agents/agent-runtime/sandbox-image";
import { isRecord, valueFromJsonText, type WireRecord, type WireValue } from "@luke/wire";
import { type Command, Sandbox } from "@vercel/sandbox";
import {
  Cause,
  Config,
  Data,
  Duration,
  Effect,
  Exit,
  Option,
  Queue,
  Redacted,
  Stream,
} from "effect";
import {
  BUBBLEWRAP_STARTS,
  FIND_SESSION_FILES,
  INSTALL_CLAUDE_CODE,
  ROOT_TOKEN_SCAN,
  SCRIPT_NAME,
  SHARE_CHECKOUT,
} from "./image.js";
import { lineSplitter } from "./lines.js";
import {
  AS_AGENT,
  CLAUDE_TOKEN_VARIABLE,
  DEFAULT_MODEL,
  DRIVER_COMMAND,
  DRIVER_EVENT,
  DROP_CAPABILITIES,
  isRepositoryName,
  PINS,
  PROBE_ENV,
  PROBE_FILES,
  PROBE_SANDBOX,
  QUERY_OPTIONS,
} from "./pins.js";
import { fixtureLeaks, type Sanitizer, sanitizer } from "./sanitize.js";
import { assistantText, leakReportIn, sessionInit, toolCalls, turnResults } from "./stream.js";
import { firstTurn, resumedTurn, STOPPED_COMMAND, stoppedTurn } from "./turns.js";
import {
  CHECK,
  type Condition,
  type ProbeObservations,
  passed,
  TURN_DONE,
  verdict,
} from "./verdict.js";

const FIXTURES = {
  STREAM: new URL("../fixtures/claude-code-stream.jsonl", import.meta.url),
  REPORT: new URL("../fixtures/claude-code-probe-report.json", import.meta.url),
} as const;

const SOURCES = {
  DRIVER: new URL("./sandbox/driver.mjs", import.meta.url),
  LEAK_CHECK: new URL("./sandbox/leak-check.sh", import.meta.url),
} as const;

/** Where the sources are written before root installs them, since the file API writes as the default user. */
const UPLOAD_DIRECTORY = "/tmp/luke-probe-upload";

const WAIT = {
  INIT: Duration.minutes(3),
  FIRST_TURN: Duration.minutes(20),
  RESULT: Duration.minutes(3),
  STOPPED_COMMAND: Duration.minutes(5),
  BEFORE_STOP: Duration.seconds(5),
  EXIT: Duration.minutes(3),
  RESUMED_TURN: Duration.minutes(5),
} as const;

/** How much of a step's output a finding keeps. */
const FINDING_MAX_CHARS = 4_000;

/** What the run's own consumer offers once a launch's output has ended, which no SDK message is. */
const STREAM_END: WireRecord = { type: "luke_probe_stream_end" };

const LAUNCH = { FIRST: "first", RESUMED: "resumed" } as const;
type Launch = (typeof LAUNCH)[keyof typeof LAUNCH];

class ProbeStepFailed extends Data.TaggedError("ProbeStepFailed")<{
  readonly step: string;
  readonly detail: string;
}> {
  override get message(): string {
    return `${this.step}: ${this.detail}`;
  }
}

/** A step's output, kept for the report. */
interface Finding {
  readonly step: string;
  readonly output: string;
}

/** Everything the run has seen so far; each step fills in what it observed, so a failed run still reports how far it got. */
interface Recording {
  readonly nonce: string;
  readonly streams: { readonly [Name in Launch]: WireValue[] };
  readonly findings: Finding[];
  sudoApiUser: string | undefined;
  launchUser: string | undefined;
  launchCapEff: string | undefined;
  stoppedTurnEnded: boolean;
  branchPushed: boolean;
  sessionFilesBeforeStop: readonly string[];
  sessionFilesAfterResume: readonly string[];
  terminalAsToday: ProbeObservations["terminalAsToday"];
  terminalCapsDropped: ProbeObservations["terminalCapsDropped"];
  agentUid: ProbeObservations["agentUid"];
  bubblewrapCapsKept: string | undefined;
  bubblewrapCapsDropped: string | undefined;
  rootFilesWithTokenShape: number | undefined;
  failure: string | undefined;
}

interface Settings {
  readonly claudeToken: Redacted.Redacted<string>;
  readonly githubToken: Redacted.Redacted<string>;
  readonly repository: string;
  readonly keepSandbox: boolean;
  readonly model: string;
}

/** A detached driver: its command, and the messages it printed, as they arrive. */
interface DriverRun {
  readonly command: Command;
  readonly events: Queue.Queue<WireValue>;
}

const settingsConfig = Config.all({
  claudeToken: Config.Redacted(PROBE_ENV.CLAUDE_TOKEN),
  githubToken: Config.Redacted(PROBE_ENV.GITHUB_TOKEN),
  repository: Config.String(PROBE_ENV.REPOSITORY),
  keepSandbox: Config.Boolean(PROBE_ENV.KEEP_SANDBOX).pipe(Config.withDefault(false)),
  model: Config.String(PROBE_ENV.MODEL).pipe(Config.withDefault(DEFAULT_MODEL)),
});

/** The shortest login the sanitizer replaces wherever it appears. */
const MIN_LOGIN_CHARS = 5;

/** Where a command runs that names no directory of its own. */
const DEFAULT_DIRECTORY = "/tmp";

/** A sanitizer for everything the run keeps or prints: the run's secrets by value, and the repository's owner and the developer's home and login by name, which a stack trace carries. */
function scrubberOf(settings: Settings): Sanitizer {
  const owner = settings.repository.split("/")[0] ?? "";
  return sanitizer({
    secrets: [Redacted.value(settings.claudeToken), Redacted.value(settings.githubToken)],
    replacements: [
      [settings.repository, "luke-probe-owner/throwaway"],
      [owner, "luke-probe-owner"],
      [homedir(), "~"],
      // Note that a login too short to be told from a word is left alone, since replacing it would garble the stream.
      [userInfo().username.length >= MIN_LOGIN_CHARS ? userInfo().username : "", "developer"],
    ],
  });
}

function scrubText(scrub: Sanitizer, text: string): string {
  const out = scrub(text);
  return JSON.stringify(out).slice(1, -1);
}

function attempt<A>(scrub: Sanitizer, step: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: run,
    catch: (cause) =>
      new ProbeStepFailed({
        step,
        detail: scrubText(scrub, cause instanceof Error ? cause.message : String(cause)),
      }),
  });
}

function say(line: string) {
  return Effect.sync(() => process.stdout.write(`${line}\n`));
}

/**
 * The firewall a coding agent's sandbox stands behind: open internet, and
 * the GitHub token as git's basic authorization on the one repository's git
 * path alone, which is where `git push` reaches.
 */
function networkPolicy(settings: Settings) {
  const basic = Buffer.from(`x-access-token:${Redacted.value(settings.githubToken)}`).toString(
    "base64",
  );
  return {
    allow: {
      "*": [],
      "github.com": [
        {
          match: { path: { startsWith: `/${settings.repository}.git/` } },
          transform: [{ headers: { authorization: `Basic ${basic}` } }],
        },
      ],
    },
  };
}

/**
 * Who a command runs as: the default user as a Terminal's shell is today,
 * that user with every capability dropped, root (the Sandbox API's `sudo`),
 * or the agent user through the launch's own drop from root.
 */
const RUN_AS = {
  DEFAULT: "default",
  DEFAULT_CAPS_DROPPED: "default-caps-dropped",
  ROOT: "root",
  AGENT: "agent",
} as const;
type RunAs = (typeof RUN_AS)[keyof typeof RUN_AS];

/** The command, its argv before `bash -c`, and whether it is asked for as root. */
const RUN_PREFIX = {
  [RUN_AS.DEFAULT]: { cmd: "bash", args: [], sudo: false },
  [RUN_AS.DEFAULT_CAPS_DROPPED]: {
    cmd: "setpriv",
    args: [...DROP_CAPABILITIES, "--", "bash"],
    sudo: false,
  },
  [RUN_AS.ROOT]: { cmd: "bash", args: [], sudo: true },
  [RUN_AS.AGENT]: { cmd: "setpriv", args: [...AS_AGENT.slice(1), "bash"], sudo: true },
} as const satisfies {
  readonly [As in RunAs]: {
    readonly cmd: string;
    readonly args: readonly string[];
    readonly sudo: boolean;
  };
};

/** A command run to its end as `as` says; a non-zero exit fails the step unless `allowFailure`. */
const run = Effect.fn("probe/run")(function* (
  scrub: Sanitizer,
  recording: Recording,
  sandbox: Sandbox,
  step: string,
  ask: {
    readonly script: string;
    readonly args?: readonly string[];
    readonly as?: RunAs;
    readonly cwd?: string;
    readonly allowFailure?: boolean;
  },
) {
  yield* say(`· ${step}`);
  const prefix = RUN_PREFIX[ask.as ?? RUN_AS.DEFAULT];
  const finished = yield* attempt(scrub, step, () =>
    sandbox.runCommand({
      cmd: prefix.cmd,
      args: [...prefix.args, "-c", ask.script, SCRIPT_NAME, ...(ask.args ?? [])],
      sudo: prefix.sudo,
      env: { NO_COLOR: "1" },
      cwd: ask.cwd ?? DEFAULT_DIRECTORY,
    }),
  );
  const stdout = yield* attempt(scrub, step, () => finished.stdout());
  const stderr = yield* attempt(scrub, step, () => finished.stderr());
  const output = scrubText(scrub, `${stdout}${stderr}`.trim());
  recording.findings.push({ step, output: output.slice(-FINDING_MAX_CHARS) });
  if (finished.exitCode !== 0 && ask.allowFailure !== true) {
    return yield* new ProbeStepFailed({
      step,
      detail: `exit ${finished.exitCode}: ${output.slice(-FINDING_MAX_CHARS)}`,
    });
  }
  return stdout.trim();
});

/** Starts the driver as the agent user, dropped from root, and hands it its config line. */
const launchDriver = Effect.fn("probe/launchDriver")(function* (
  scrub: Sanitizer,
  settings: Settings,
  sandbox: Sandbox,
  into: WireValue[],
  resume: string | undefined,
) {
  const command = yield* attempt(scrub, "launch the driver as the agent user", () =>
    sandbox.runCommand({
      cmd: AS_AGENT[0],
      args: [...AS_AGENT.slice(1), "node", PROBE_FILES.DRIVER],
      cwd: PROBE_SANDBOX.CHECKOUT,
      sudo: true,
      detached: true,
      stdin: true,
    }),
  );
  const events = yield* Queue.unbounded<WireValue>();
  const splitter = lineSplitter();
  const take = (line: string) =>
    Effect.gen(function* () {
      const value = valueFromJsonText(line);
      into.push(value);
      yield* Queue.offer(events, value);
    });
  yield* Stream.fromAsyncIterable(
    command.logs(),
    (cause) =>
      new ProbeStepFailed({
        step: "read the driver",
        detail: scrubText(scrub, cause instanceof Error ? cause.message : String(cause)),
      }),
  ).pipe(
    Stream.runForEach((log) =>
      log.stream === "stdout"
        ? Effect.forEach(splitter.push(log.data), take, { discard: true })
        : say(`  driver: ${scrubText(scrub, log.data.trim())}`),
    ),
    Effect.ignore,
    Effect.andThen(Effect.forEach(splitter.flush(), take, { discard: true })),
    Effect.andThen(Queue.offer(events, STREAM_END)),
    Effect.forkDetach,
  );
  const config = {
    token: Redacted.value(settings.claudeToken),
    tokenVariable: CLAUDE_TOKEN_VARIABLE,
    cwd: PROBE_SANDBOX.CHECKOUT,
    model: settings.model,
    resume,
    options: QUERY_OPTIONS,
  };
  yield* attempt(scrub, "configure the driver", () =>
    command.writeStdin(`${JSON.stringify(config)}\n`),
  );
  return { command, events } satisfies DriverRun;
});

/** Whether a message the predicate takes arrives before the wait runs out or the driver's output ends. */
function waitFor(
  driver: DriverRun,
  within: Duration.Duration,
  found: (value: WireValue) => boolean,
) {
  const loop = Effect.gen(function* () {
    for (;;) {
      const value = yield* Queue.take(driver.events);
      if (value === STREAM_END) return false;
      if (found(value)) return true;
    }
  });
  return loop.pipe(
    Effect.timeoutOption(within),
    Effect.map((seen) => Option.getOrElse(seen, () => false)),
  );
}

function send(scrub: Sanitizer, driver: DriverRun, line: WireRecord) {
  return attempt(scrub, `send ${String(line.type)}`, () =>
    driver.command.writeStdin(`${JSON.stringify(line)}\n`),
  );
}

const isInit = (value: WireValue) => sessionInit([value]) !== undefined;
const isResult = (value: WireValue) => turnResults([value]).length > 0;
const says = (words: string) => (value: WireValue) => assistantText([value]).includes(words);
const isExit = (value: WireValue) => isRecord(value) && value.type === DRIVER_EVENT.EXIT;
const startsStoppedCommand = (value: WireValue) =>
  toolCalls([value]).some((call) => call.command.includes(STOPPED_COMMAND));

/** Ends a driver's input and waits for it to exit, killing it where it does not. */
const endDriver = Effect.fn("probe/endDriver")(function* (scrub: Sanitizer, driver: DriverRun) {
  yield* send(scrub, driver, { type: DRIVER_COMMAND.END });
  const exited = yield* waitFor(driver, WAIT.EXIT, isExit);
  if (!exited) yield* attempt(scrub, "kill the driver", () => driver.command.kill());
});

/** The first launch: the session starts, a Terminal's shell looks for the token, the workflow turn runs, and a long turn is stopped. */
const firstLaunch = Effect.fn("probe/firstLaunch")(function* (
  scrub: Sanitizer,
  settings: Settings,
  recording: Recording,
  sandbox: Sandbox,
) {
  const driver = yield* launchDriver(scrub, settings, sandbox, recording.streams.first, undefined);
  if (!(yield* waitFor(driver, WAIT.INIT, isInit))) {
    return yield* new ProbeStepFailed({ step: "start the session", detail: "no init message" });
  }
  const leakCheck = (step: string, as: RunAs) =>
    run(scrub, recording, sandbox, step, {
      script: `bash ${PROBE_FILES.LEAK_CHECK}`,
      as,
      allowFailure: true,
    }).pipe(Effect.map(leakReportIn));
  recording.terminalAsToday = yield* leakCheck(
    "leak check from a Terminal's shell as today",
    RUN_AS.DEFAULT,
  );
  recording.terminalCapsDropped = yield* leakCheck(
    "leak check from a Terminal's shell, capabilities dropped",
    RUN_AS.DEFAULT_CAPS_DROPPED,
  );
  recording.agentUid = yield* leakCheck(
    "leak check as the agent user, outside the command sandbox",
    RUN_AS.AGENT,
  );

  yield* say("· the workflow turn: edit, background command, ScheduleWakeup, push");
  yield* send(scrub, driver, { type: DRIVER_COMMAND.MESSAGE, text: firstTurn(recording.nonce) });
  if (yield* waitFor(driver, WAIT.FIRST_TURN, says(TURN_DONE.FIRST))) {
    yield* waitFor(driver, WAIT.RESULT, isResult);
  }
  const branch = `luke-probe/${recording.nonce}`;
  const remote = yield* run(scrub, recording, sandbox, "the pushed branch on GitHub", {
    script: 'git ls-remote --heads origin "$1"',
    args: [branch],
    cwd: PROBE_SANDBOX.CHECKOUT,
    allowFailure: true,
  });
  recording.branchPushed = remote.includes(`refs/heads/${branch}`);

  yield* say("· the stopped turn");
  yield* send(scrub, driver, { type: DRIVER_COMMAND.MESSAGE, text: stoppedTurn() });
  if (yield* waitFor(driver, WAIT.STOPPED_COMMAND, startsStoppedCommand)) {
    yield* Effect.sleep(WAIT.BEFORE_STOP);
    yield* send(scrub, driver, { type: DRIVER_COMMAND.STOP });
    recording.stoppedTurnEnded = yield* waitFor(driver, WAIT.RESULT, isResult);
  }
  yield* endDriver(scrub, driver);
  return sessionInit(recording.streams.first)?.session_id;
});

/** The second launch, on the resumed sandbox: the session resumed and asked what only its history knows. */
const resumedLaunch = Effect.fn("probe/resumedLaunch")(function* (
  scrub: Sanitizer,
  settings: Settings,
  recording: Recording,
  sandbox: Sandbox,
  sessionId: string,
) {
  const driver = yield* launchDriver(
    scrub,
    settings,
    sandbox,
    recording.streams.resumed,
    sessionId,
  );
  if (yield* waitFor(driver, WAIT.INIT, isInit)) {
    yield* send(scrub, driver, { type: DRIVER_COMMAND.MESSAGE, text: resumedTurn() });
    if (yield* waitFor(driver, WAIT.RESUMED_TURN, says(TURN_DONE.RESUMED))) {
      yield* waitFor(driver, WAIT.RESULT, isResult);
    }
  }
  yield* endDriver(scrub, driver);
});

/** The image: today's `PREPARE_SCRIPT`, then Claude Code, the checkout, and the probe's files. */
const prepareSandbox = Effect.fn("probe/prepareSandbox")(function* (
  scrub: Sanitizer,
  settings: Settings,
  recording: Recording,
  sandbox: Sandbox,
) {
  const defaultUser = yield* run(scrub, recording, sandbox, "the default user", {
    script: "id -un",
  });
  yield* run(scrub, recording, sandbox, "today's image (PREPARE_SCRIPT)", {
    script: PREPARE_SCRIPT,
  });
  yield* run(scrub, recording, sandbox, "Claude Code, bubblewrap and the agent user", {
    script: INSTALL_CLAUDE_CODE,
    args: [defaultUser],
    as: RUN_AS.ROOT,
  });
  yield* run(scrub, recording, sandbox, "clone the throwaway repository", {
    script: `git clone "https://github.com/$1.git" ${PROBE_SANDBOX.CHECKOUT}`,
    args: [settings.repository],
  });
  yield* run(scrub, recording, sandbox, "share the checkout with the agent user", {
    script: SHARE_CHECKOUT,
    as: RUN_AS.ROOT,
  });
  const driver = yield* attempt(scrub, "read the driver", () => readFile(SOURCES.DRIVER, "utf8"));
  const leakCheck = yield* attempt(scrub, "read the leak check", () =>
    readFile(SOURCES.LEAK_CHECK, "utf8"),
  );
  yield* attempt(scrub, "upload the probe's files", () =>
    sandbox.writeFiles([
      { path: `${UPLOAD_DIRECTORY}/driver.mjs`, content: driver },
      { path: `${UPLOAD_DIRECTORY}/leak-check.sh`, content: leakCheck },
    ]),
  );
  yield* run(scrub, recording, sandbox, "install the probe's files", {
    script: [
      `install -m 644 ${UPLOAD_DIRECTORY}/driver.mjs ${PROBE_FILES.DRIVER}`,
      `install -m 755 ${UPLOAD_DIRECTORY}/leak-check.sh ${PROBE_FILES.LEAK_CHECK}`,
      `rm -rf ${UPLOAD_DIRECTORY}`,
    ].join("\n"),
    as: RUN_AS.ROOT,
  });
  recording.sudoApiUser = yield* run(scrub, recording, sandbox, "the Sandbox API's sudo", {
    script: "id -un",
    as: RUN_AS.ROOT,
    allowFailure: true,
  });
  const launched = yield* run(scrub, recording, sandbox, "the launch's drop to the agent user", {
    script: "id -un; awk '/^CapEff:/ { print $2 }' /proc/self/status",
    as: RUN_AS.AGENT,
    allowFailure: true,
  });
  [recording.launchUser, recording.launchCapEff] = launched.split("\n");
  recording.bubblewrapCapsKept = yield* run(
    scrub,
    recording,
    sandbox,
    "bubblewrap in a Terminal's shell as today",
    {
      script: BUBBLEWRAP_STARTS,
      allowFailure: true,
    },
  );
  recording.bubblewrapCapsDropped = yield* run(
    scrub,
    recording,
    sandbox,
    "bubblewrap as the agent user, capabilities dropped",
    { script: BUBBLEWRAP_STARTS, as: RUN_AS.AGENT, allowFailure: true },
  );
});

/** The session's files on the sandbox disk, by path, as root finds them. */
const sessionFiles = Effect.fn("probe/sessionFiles")(function* (
  scrub: Sanitizer,
  recording: Recording,
  sandbox: Sandbox,
  step: string,
  sessionId: string,
) {
  const found = yield* run(scrub, recording, sandbox, step, {
    script: FIND_SESSION_FILES,
    args: [sessionId],
    as: RUN_AS.ROOT,
    allowFailure: true,
  });
  return found.split("\n").filter((line) => line.trim() !== "");
});

/** Every step in order, filling in the recording; the first failure ends the run, which still reports. */
const probe = Effect.fn("probe/probe")(function* (
  scrub: Sanitizer,
  settings: Settings,
  recording: Recording,
  sandbox: Sandbox,
) {
  yield* prepareSandbox(scrub, settings, recording, sandbox);
  const sessionId = yield* firstLaunch(scrub, settings, recording, sandbox);
  if (sessionId === undefined) {
    return yield* new ProbeStepFailed({ step: "the first launch", detail: "no session id" });
  }
  const tokenFiles = yield* run(scrub, recording, sandbox, "token-shaped files, as root", {
    script: ROOT_TOKEN_SCAN,
    as: RUN_AS.ROOT,
    allowFailure: true,
  });
  recording.rootFilesWithTokenShape = tokenFiles.split("\n").filter((line) => line !== "").length;
  recording.sessionFilesBeforeStop = yield* sessionFiles(
    scrub,
    recording,
    sandbox,
    "the session's files before the stop",
    sessionId,
  );
  yield* say("· stop the sandbox, then resume it");
  yield* attempt(scrub, "stop the sandbox", () => sandbox.stop());
  const resumed = yield* attempt(scrub, "resume the sandbox", () =>
    Sandbox.get({ name: sandbox.name, resume: true }),
  );
  recording.sessionFilesAfterResume = yield* sessionFiles(
    scrub,
    recording,
    resumed,
    "the session's files after the resume",
    sessionId,
  );
  yield* resumedLaunch(scrub, settings, recording, resumed, sessionId);
});

function observationsOf(recording: Recording): ProbeObservations {
  return {
    nonce: recording.nonce,
    sudoApiUser: recording.sudoApiUser,
    launchUser: recording.launchUser,
    launchCapEff: recording.launchCapEff,
    firstLaunch: recording.streams.first,
    stoppedTurnEnded: recording.stoppedTurnEnded,
    branchPushed: recording.branchPushed,
    sessionFilesBeforeStop: recording.sessionFilesBeforeStop,
    sessionFilesAfterResume: recording.sessionFilesAfterResume,
    resumedLaunch: recording.streams.resumed,
    terminalAsToday: recording.terminalAsToday,
    terminalCapsDropped: recording.terminalCapsDropped,
    agentUid: recording.agentUid,
    bubblewrapCapsKept: recording.bubblewrapCapsKept,
    bubblewrapCapsDropped: recording.bubblewrapCapsDropped,
    rootFilesWithTokenShape: recording.rootFilesWithTokenShape,
  };
}

/** The sanitized stream and report, written over the committed fixtures. */
function writeFixtures(
  scrub: Sanitizer,
  settings: Settings,
  recording: Recording,
  conditions: readonly Condition[],
) {
  const stream = [LAUNCH.FIRST, LAUNCH.RESUMED].flatMap((launch) =>
    recording.streams[launch].map((message) => JSON.stringify(scrub({ launch, message }))),
  );
  const raw = {
    placeholder: false,
    recordedAt: new Date().toISOString(),
    pins: { agentSdk: PINS.AGENT_SDK, claudeCode: PINS.CLAUDE_CODE },
    model: settings.model,
    queryOptions: QUERY_OPTIONS,
    sandbox: { vcpus: PROBE_SANDBOX.VCPUS, runtime: "the SDK's default, as eve's" },
    nonce: recording.nonce,
    failure: recording.failure ?? null,
    passed: passed(conditions),
    conditions,
    sessionFiles: {
      beforeStop: recording.sessionFilesBeforeStop,
      afterResume: recording.sessionFilesAfterResume,
    },
    findings: recording.findings,
  };
  const report = scrub(valueFromJsonText(JSON.stringify(raw)));
  const streamText = `${stream.join("\n")}\n`;
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  const secrets = [Redacted.value(settings.claudeToken), Redacted.value(settings.githubToken)];
  const leaks = [...fixtureLeaks(streamText, secrets), ...fixtureLeaks(reportText, secrets)];
  if (leaks.length > 0) {
    return Effect.fail(
      new ProbeStepFailed({
        step: "write the fixtures",
        detail: `refused, the sanitized output still holds ${[...new Set(leaks)].join(", ")}`,
      }),
    );
  }
  return Effect.all([
    attempt(scrub, "write the stream fixture", () => writeFile(FIXTURES.STREAM, streamText)),
    attempt(scrub, "write the report fixture", () => writeFile(FIXTURES.REPORT, reportText)),
  ]);
}

function printVerdict(conditions: readonly Condition[]) {
  return Effect.forEach(
    [CHECK.PLAN, CHECK.TOKEN],
    (check) =>
      Effect.gen(function* () {
        const own = conditions.filter((each) => each.check === check);
        yield* say(`\n${passed(own) ? "PASS" : "FAIL"}  ${check}`);
        for (const each of own) {
          const mark = each.pass ? "ok  " : each.gating ? "FAIL" : "note";
          yield* say(`  ${mark}  ${each.name} (${each.detail})`);
        }
      }),
    { discard: true },
  );
}

const main = Effect.gen(function* () {
  const settings: Settings = yield* settingsConfig;
  if (!isRepositoryName(settings.repository)) {
    return yield* new ProbeStepFailed({
      step: "read the settings",
      detail: `${PROBE_ENV.REPOSITORY} must name one repository as owner/name`,
    });
  }
  const scrub = scrubberOf(settings);
  const recording: Recording = {
    nonce: randomBytes(6).toString("hex"),
    streams: { first: [], resumed: [] },
    findings: [],
    sudoApiUser: undefined,
    launchUser: undefined,
    launchCapEff: undefined,
    stoppedTurnEnded: false,
    branchPushed: false,
    sessionFilesBeforeStop: [],
    sessionFilesAfterResume: [],
    terminalAsToday: undefined,
    terminalCapsDropped: undefined,
    agentUid: undefined,
    bubblewrapCapsKept: undefined,
    bubblewrapCapsDropped: undefined,
    rootFilesWithTokenShape: undefined,
    failure: undefined,
  };
  yield* say(
    `Luke's Claude Code probe ${recording.nonce}: Agent SDK ${PINS.AGENT_SDK}, claude ${PINS.CLAUDE_CODE}`,
  );
  const sandbox = yield* attempt(scrub, "open the sandbox", () =>
    Sandbox.create({
      name: `luke-probe-${recording.nonce}`,
      timeout: PROBE_SANDBOX.TIMEOUT_MS,
      resources: { vcpus: PROBE_SANDBOX.VCPUS },
      persistent: true,
      keepLastSnapshots: {
        count: 1,
        expiration: Duration.toMillis(Duration.days(1)),
        deleteEvicted: true,
      },
      networkPolicy: networkPolicy(settings),
    }),
  );
  yield* say(`· sandbox ${sandbox.name} open`);
  const outcome = yield* Effect.exit(probe(scrub, settings, recording, sandbox));
  if (Exit.isFailure(outcome)) {
    recording.failure = scrubText(scrub, Cause.pretty(outcome.cause));
    yield* say(`\nThe run stopped early: ${recording.failure}`);
  }
  if (!settings.keepSandbox) {
    yield* attempt(scrub, "delete the sandbox", () =>
      Sandbox.get({ name: sandbox.name }).then((found) => found.delete()),
    ).pipe(Effect.ignore);
  } else {
    yield* say(`· sandbox ${sandbox.name} kept`);
  }
  const conditions = verdict(observationsOf(recording));
  yield* writeFixtures(scrub, settings, recording, conditions);
  yield* printVerdict(conditions);
  yield* say(
    `\nSanitized fixtures written to ${FIXTURES.STREAM.pathname} and ${FIXTURES.REPORT.pathname}.`,
  );
  if (!passed(conditions)) {
    return yield* new ProbeStepFailed({ step: "the verdict", detail: "a condition failed" });
  }
});

NodeRuntime.runMain(main);
