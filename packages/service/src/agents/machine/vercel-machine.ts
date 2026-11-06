/**
 * vercel-machine.ts -- the agent machine over Vercel Sandbox: a sandbox booted from the agents' image, the runner started in it as the SDK's own user for the agent, and our doors read through it.
 *
 * `open` opens a sandbox from the agents' image (`../coder-host/agent-image.ts`),
 * which carries the runner and every tool the harnesses run, makes the
 * `agent` user in it as the SDK does, and checks the agent's repository out
 * into it on eve's terms (`../coder-host/checkout.ts`, the same token at the
 * firewall, but cloned whole, since the history is deepened before the
 * runner starts anyway); or opens it from its workspace's repository
 * snapshot of the same image, whose build made the user already, and
 * fetches only what landed since (`../repository-snapshot.ts`), building
 * that snapshot past the answer where none was ready. A create Vercel
 * answers `image_not_ready` is asked again once the registry has had time to
 * prepare the image, as Vercel's docs say. The deepen is left to the launch
 * (`finishCheckout`), which runs it beside its own steps. A sandbox whose use
 * failed is deleted again.
 *
 * `launchRunner` readies the sandbox as root, sharing each checkout with the
 * `agent` user, and then starts the image's runner as that user through the
 * SDK (`asUser(...).runCommand`), as a detached command whose stdin stays
 * open. The harness's credential and the placeholder the firewall swaps for
 * the runner's bearer (`../coder-host/runner-sessions.ts`) are in that
 * command's environment, which the SDK writes on `sudo`'s command line, so
 * any process in the sandbox may read them there while the runner runs; in
 * a sandbox each is a placeholder the firewall swaps, worth nothing outside
 * it. Neither is ever in its config line, a file, or a tag. Its config line
 * is written to its stdin, which carries nothing more: the runner reads every
 * later line from the service (`../coder-host/runner-sessions.ts`), so this machine
 * writes no line to it.
 *
 * The doors read the sandbox carrying the agent's session id as its tag, as
 * every agent's sandbox does, and only its running session: nothing is
 * resumed, since the agent calling the tool runs in that sandbox, so a
 * sandbox not up has nothing to read from. A file is read by a command the
 * sandbox's default user runs. A repository's command is
 * run in the running session and waited on, its environment named by `env`
 * on the command line rather than by the API, as our other commands are
 * run (`../vercel-sandbox-api.ts`).
 *
 * A place is found again by the session's tag, and its runner by the tags a
 * launch writes beside it: the command, the sandbox session it runs in, and
 * the launch's first event number and fingerprint (`RUNNER_TAG`). The
 * firewall is the sandbox session's network policy, composed whole at each
 * write from its sources and the swaps its launch keeps
 * (`../sandbox-firewall.ts`), a stop is the session's, and a
 * resume opens the sandbox's last snapshot, its timeout lowered first, so
 * the session it opens lives a launch's timeout and not an old sandbox's
 * day; a snapshot expired is a place gone for good.
 */

import { randomUUID } from "node:crypto";
import {
  AGENT_USER,
  CODEX_PIN,
  RUNNER_DIRECTORY,
  SANDBOX_TOOLS_DIRECTORY,
  SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME,
  SHARED_FILES_DIRECTORY,
} from "@repo/agent-runner/pins";
import type { DatabaseServices } from "@repo/database/core/query";
import { type Agent, hasRepository, type WithRepository } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Brand, type Context, Duration, Effect, Layer, Option, Result, Schedule } from "effect";
import type { HttpClient } from "effect/http";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import { fillBaseDrive } from "../base-drive.js";
import { AgentImage } from "../coder-host/agent-image.js";
import { CODER, sandboxVcpus } from "../coder-host/bounds.js";
import {
  type AgentExtraRead,
  type AgentRepositoryRead,
  agentDeepenPlan,
  agentExtraReads,
  agentFirewallSources,
  agentRepositoryRead,
  CHECKOUT_DEPTH,
  CheckoutRefused,
  cloneAgentExtras,
  cloneAgentRepository,
  deepenCheckoutWith,
  openWorkingFolder,
  refreshAgentCheckout,
} from "../coder-host/checkout.js";
import { NATIVE_SKILLS_PATH } from "../coder-host/native-skills.js";
import type { RepositoryFirewall, RepositorySandbox } from "../repository-shell.js";
import {
  buildRepositorySnapshot,
  forgetRepositorySnapshot,
  REPOSITORY_SNAPSHOT_STATE,
  type RepositorySnapshotOf,
  readRepositorySnapshot,
} from "../repository-snapshot.js";
import {
  type FirewallSession,
  type FirewallSources,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  IMAGE_NOT_READY,
  type ListedSandbox,
  NAME_TAKEN,
  NOT_FOUND_STATUS,
  type OidcTokenRead,
  type OpenedSandbox,
  SANDBOX_STATUS,
  type SandboxSessionApi,
  SandboxUnavailable,
  SESSION_TAG,
  type SessionRef,
  sessionOnFirstUse,
  snapshotGone,
  UP_STATUSES,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
import {
  AgentMachine,
  type AgentMachineService,
  describeFailure,
  type FoundPlace,
  type MachineKept,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  type MachineRunning,
  PLACE_RESUME,
  RUNNER_RECORD,
  type RunnerHandle,
  type RunnerMark,
  type RunnerRecord,
} from "./agent-machine.js";

/**
 * The tags a sandbox we open carries beside its session's: its agent, and
 * the runner it runs, so a later call finds both. Note that Vercel refuses a
 * sandbox more than five tags, the session's among them, so a launch's
 * fingerprint rides in its launch tag rather than a tag of its own.
 */
export const RUNNER_TAG = {
  AGENT: "agentId",
  SANDBOX_SESSION: "agentRunnerSession",
  COMMAND: "agentRunnerCommand",
  /**
   * The launch's first event number, then `LAUNCH_FINGERPRINT_MARK` and what
   * the launch was started with that a warm runner cannot take up later
   * (`launchFingerprint`). A tag written before ends in the mark and
   * `lines`, which the read leaves aside.
   */
  LAUNCH: "agentRunnerLaunch",
} as const;

/**
 * The tags' names before the product's rename, read after `RUNNER_TAG`'s and
 * never written. Note that each write replaces a sandbox's whole set of
 * tags, so a sandbox carries one name of a tag or the other, and one made
 * before carries the old names until its next launch or halt writes the
 * new; they can go once Vercel lists no sandbox named
 * `SANDBOX_NAME_BEFORE_RENAME`, since only such a sandbox can carry them.
 */
const RUNNER_TAG_BEFORE_RENAME = {
  AGENT: "lukeAgent",
  SANDBOX_SESSION: "lukeRunnerSession",
  COMMAND: "lukeRunnerCommand",
  LAUNCH: "lukeRunnerLaunch",
} as const satisfies Record<keyof typeof RUNNER_TAG, string>;

/** A runner tag of a sandbox, under its name or the one it had before the rename. */
export function runnerTag(
  tags: Readonly<Record<string, string>> | undefined,
  tag: keyof typeof RUNNER_TAG,
): string | undefined {
  return tags?.[RUNNER_TAG[tag]] ?? tags?.[RUNNER_TAG_BEFORE_RENAME[tag]];
}

/** What parts a launch tag's first event number from its fingerprint. */
const LAUNCH_FINGERPRINT_MARK = "-";

/**
 * Where a message's files that the harness takes no block of are written
 * in its sandbox, one folder per message line: outside the checkout, so no
 * commit picks them up, and readable by `agent`, since the API writes them
 * as its default user with the mode the caller names.
 */
const ATTACHMENT_DIRECTORY = "/tmp/agent-attachments";

/** Where a sandbox keeps an agent's things: the same for every agent, since each has a sandbox of its own. */
const SANDBOX_LAYOUT: MachineLayout = {
  checkoutPath: CODER.CHECKOUT_PATH,
  installedSkills: NATIVE_SKILLS_PATH.INSTALLED,
  skillsUpload: NATIVE_SKILLS_PATH.UPLOAD,
  attachments: ATTACHMENT_DIRECTORY,
  sharedFiles: SHARED_FILES_DIRECTORY,
  claudeExecutable: undefined,
  codexExecutable: undefined,
  linesRead: true,
};

/** What a sandbox we open is named as, beside a fresh UUID; the sweep tells a native sandbox from eve's by it. */
export const SANDBOX_NAME = "agent-sandbox-";

/**
 * What a sandbox opened before the product's rename is named as, which the
 * sweeps still find and nothing opens. Note that it can go only once Vercel
 * lists no sandbox under it, because a sandbox in steady use resumes from
 * its own snapshot, under its own name, for as long as it lives; one goes on
 * a reset, on the first message after its snapshot lapsed, or at its purge.
 */
export const SANDBOX_NAME_BEFORE_RENAME = "luke-agent-";

/** The runner as the image carries it (`apps/web/agent-image/Dockerfile`). */
const RUNNER_SCRIPT = `${RUNNER_DIRECTORY}/agent-runner.mjs`;

/** The folders the `agent` user's home holds from its making: Codex's `CODEX_HOME`, which Codex refuses to start without. */
const AGENT_HOME_FOLDERS = [CODEX_PIN.HOME];

/** The variables the sandbox opens with, as eve's coding-agent environment sets them. */
const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

/**
 * The link a sandbox made before the product's rename is given on each
 * launch, root's, from our tools' directory to the one its image put them
 * in, so the runner and the Claude Code binary are found where the
 * pins name them. Note that it can go only once Vercel lists no sandbox made
 * before the rename (named `luke-agent-` and a UUID), because a sandbox in
 * steady use resumes from its own snapshot for as long as it lives.
 */
const LINK_TOOLS_DIRECTORY = `if [ -d ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ] && [ ! -e ${SANDBOX_TOOLS_DIRECTORY} ] && [ ! -L ${SANDBOX_TOOLS_DIRECTORY} ]; then ln -s ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ${SANDBOX_TOOLS_DIRECTORY}; fi`;

/** A checkout marked safe for git and shared with `agent`'s group, as the launch marks each: the agent's own and every repository it works in beside it. */
function sharedCheckout(path: string): readonly string[] {
  return [
    `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${path} || git config --system --add safe.directory ${path}`,
    `if [ -d ${path}/.git ] && ! git -C ${path} config --get core.sharedRepository | grep -Fxq group; then git -C ${path} config core.sharedRepository group; fi`,
    `chmod -R g+rwX ${path}`,
    `find ${path} -type d -exec chmod g+s {} +`,
  ];
}

/**
 * The checkouts given marked safe for git and shared with `agent`'s group,
 * as the launch marks each, run by bash as root: for a checkout cloned into
 * a sandbox whose runner already runs, whose launch marked only those that
 * stood before it.
 */
function sharedCheckoutsScript(paths: readonly string[]): string {
  return ["set -euo pipefail", ...paths.flatMap(sharedCheckout)].join("\n");
}

/** How long the marking of checkouts cloned under a running runner is waited on: `chmod -R` over a whole repository. */
const SHARE_WAIT = Duration.minutes(2);

/** Why checkouts cloned under a running runner were not shared with its user. */
const NOT_SHARED = "the checkouts cloned beside the agent's could not be shared with its runner";

/**
 * The launch's readying, run by bash as root through `sudo`, waited on before the runner starts: the
 * member's installed skills, where the sandbox's opening uploaded them,
 * moved where only root writes and every user reads (`native-skills.ts`),
 * each checkout marked safe for git and shared with `agent`'s group, the
 * agent's own and those of the repositories it works in beside it at the
 * paths given (`extraCheckoutPaths`), none for an agent in one repository,
 * and the folder an agent saves what the service reads back in made
 * `agent`'s and readable by the default user the service reads as
 * (`SHARED_FILES_DIRECTORY`). Note that the checkout's git config is written
 * only where it does not already say so, because a `config.lock` an agent's
 * git left behind when its runner was killed would otherwise fail every
 * relaunch after it.
 */
function readyScript(extraCheckouts: readonly string[]): string {
  return [
    "set -euo pipefail",
    LINK_TOOLS_DIRECTORY,
    `if [ -d ${NATIVE_SKILLS_PATH.UPLOAD} ]; then rm -rf ${NATIVE_SKILLS_PATH.INSTALLED} && mkdir -p $(dirname ${NATIVE_SKILLS_PATH.INSTALLED}) && mv ${NATIVE_SKILLS_PATH.UPLOAD} ${NATIVE_SKILLS_PATH.INSTALLED} && chown -R root:root ${NATIVE_SKILLS_PATH.INSTALLED} && chmod -R u=rwX,go=rX ${NATIVE_SKILLS_PATH.INSTALLED}; fi`,
    ...[CODER.CHECKOUT_PATH, ...extraCheckouts].flatMap(sharedCheckout),
    `install -d -o ${AGENT_USER} -g ${AGENT_USER} -m 0755 ${SHARED_FILES_DIRECTORY}`,
  ].join("\n");
}

/** Why the sandbox could not be readied for the agent's runner. */
const NOT_READIED = "the sandbox could not be readied for the agent's runner";

/** How the read exits where the path is no regular file the sandbox's user may read. */
const READ_EXIT = { NO_FILE: 3 } as const;

/**
 * The read, run by bash: the file named as `$1`, at most `$2` bytes of it,
 * printed in base64 on one line, since a command's output reaches the service as
 * text. A path that is no regular file the sandbox's user may read exits
 * apart, before anything is printed.
 */
const READ_SCRIPT = [
  "set -o pipefail",
  `[ -f "$1" ] && [ -r "$1" ] || exit ${READ_EXIT.NO_FILE}`,
  `head -c "$2" -- "$1" | base64 | tr -d '\\n'`,
].join("\n");

/**
 * How a create on an image the registry is still preparing is asked again:
 * every `SPACED`, at most `TIMES` times, as Vercel's docs say to retry once
 * the preparation finishes. Note that CI pushes each image and waits for
 * Vercel to prepare it before the deploy that names it lands, so only a
 * Preview opened as its image is pushed waits here.
 */
const IMAGE_RETRY = {
  SPACED: Duration.seconds(10),
  TIMES: 18,
} as const;

/** Runs one effect on the edge's runtime; the checkout reaches the sandbox through promises (`repository-shell.ts`). */
export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

/** What the machine is made with: the token Vercel is asked under, and the edge's runner the checkout runs through. */
export interface VercelMachineOptions {
  readonly readToken: OidcTokenRead;
  readonly run: SandboxRunner;
}

const runningOfSession = Brand.nominal<MachineRunning>();
const nameOfSandbox = Brand.nominal<MachineName>();

/** The place a sandbox's running session stands for, under our session given. */
function vercelPlace(session: string, name: string, sandboxSessionId: string): MachinePlace {
  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    name: nameOfSandbox(name),
    running: runningOfSession(sandboxSessionId),
  };
}

/** A sandbox the machine opened or found up: its name, and the session it runs. */
interface OpenedPlace {
  readonly name: string;
  readonly running: string;
}

/** The sandbox session a place runs in, as the API names it. */
function sessionOfPlace(place: OpenedPlace): SessionRef {
  return { name: place.name, sessionId: place.running };
}

/** The same session as its firewall names it, with the account whose agent it is. */
function firewallSessionOf(place: OpenedPlace, userId: string): FirewallSession {
  return { userId, name: place.name, sandboxSessionId: place.running };
}

/** The runner a sandbox's tags name, where the sandbox runs the session it was started in. */
export interface TaggedRunner {
  readonly sandboxSessionId: string;
  readonly commandId: string;
  readonly firstSequence: number;
  /** None for a launch from before fingerprints were tagged. */
  readonly fingerprint?: string;
}

/** The launch tag read: its first event number, and its fingerprint where it has one, of a launch that reads its lines, as every sandbox's does; none where the tag is missing or unreadable. */
function taggedLaunch(tags: Readonly<Record<string, string>>): RunnerMark | undefined {
  const [sequence = "", fingerprint] = (runnerTag(tags, "LAUNCH") ?? "").split(
    LAUNCH_FINGERPRINT_MARK,
  );
  const firstSequence = Number(sequence);
  if (sequence === "" || !Number.isSafeInteger(firstSequence)) return undefined;
  return { firstSequence, ...(fingerprint === undefined ? {} : { fingerprint }), linesRead: true };
}

/** The runner a sandbox's tags name, whatever the sandbox runs now; none where a tag is missing. */
export function taggedRunner(sandbox: ListedSandbox): TaggedRunner | undefined {
  const tags = sandbox.tags ?? {};
  const sandboxSessionId = runnerTag(tags, "SANDBOX_SESSION");
  const commandId = runnerTag(tags, "COMMAND");
  const launch = taggedLaunch(tags);
  if (sandboxSessionId === undefined || commandId === undefined || launch === undefined) {
    return undefined;
  }
  return { sandboxSessionId, commandId, ...launch };
}

/** The launch tag's value for the mark given. */
function launchTagOf(mark: RunnerMark): string {
  if (mark.fingerprint === undefined) return String(mark.firstSequence);
  return [mark.firstSequence, mark.fingerprint].join(LAUNCH_FINGERPRINT_MARK);
}

/** The tags a sandbox carries for the record given, beside its session's and its agent's. */
function recordTags(session: string, agentId: string, record: RunnerRecord) {
  const place = { [SESSION_TAG]: session, [RUNNER_TAG.AGENT]: agentId };
  if (record.kind === RUNNER_RECORD.NONE) return place;
  if (record.kind === RUNNER_RECORD.LAUNCHED) {
    return { ...place, [RUNNER_TAG.LAUNCH]: launchTagOf(record.mark) };
  }
  return {
    ...place,
    [RUNNER_TAG.SANDBOX_SESSION]: record.runner.handle.running,
    [RUNNER_TAG.COMMAND]: record.runner.handle.command,
    [RUNNER_TAG.LAUNCH]: launchTagOf(record.runner.mark),
  };
}

/** The runner the sandbox's tags name, where the sandbox is up in the session it was started in, whether or not it has exited since. */
function runnerInSession(session: string, sandbox: ListedSandbox) {
  const runner = taggedRunner(sandbox);
  if (
    runner === undefined ||
    sandbox.status !== SANDBOX_STATUS.RUNNING ||
    sandbox.currentSessionId !== runner.sandboxSessionId
  ) {
    return undefined;
  }
  const { sandboxSessionId, commandId, ...mark } = runner;
  return {
    handle: { ...vercelPlace(session, sandbox.name, sandboxSessionId), command: commandId },
    mark,
  };
}

/** A listed sandbox as the place a later call finds, under our session given. */
function foundOf(session: string, sandbox: ListedSandbox): FoundPlace {
  const tags = sandbox.tags ?? {};
  const running =
    sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.currentSessionId !== undefined
      ? vercelPlace(session, sandbox.name, sandbox.currentSessionId)
      : undefined;
  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    agentId: runnerTag(tags, "AGENT"),
    name: nameOfSandbox(sandbox.name),
    running,
    runner: runnerInSession(session, sandbox),
    launch: taggedLaunch(tags),
    // SAFETY: the listing is this machine's own; no caller reads it.
    kept: sandbox as unknown as MachineKept,
  };
}

/**
 * A launch whose stdin was refused, said in the log by how its command
 * ended: its exit code where Vercel has one, and the tail of its stderr,
 * every token-shaped run redacted (`commandStderrTail`), since a runner that
 * dies before it reads its config says why there alone. Every value the
 * launch handed it in its environment is redacted too, whatever its shape,
 * so neither its credential nor its bearer can reach the log.
 */
const diedAtStart = (session: SandboxSessionApi, commandId: string, secrets: readonly string[]) =>
  Effect.gen(function* () {
    const exit = yield* session.commandExit(commandId).pipe(Effect.orElseSucceed(() => undefined));
    const stderr = yield* session
      .commandStderrTail(commandId, secrets)
      .pipe(Effect.orElseSucceed(() => undefined));
    yield* Effect.logWarning(
      `A runner's launch took no stdin: exit ${exit === null || exit === undefined ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`,
    );
  });

/** The sandbox session's firewall as the checkout reaches it, bound to the session and its account and to what stands beside the checkout's own, over the store the machine was made on. */
function repositoryFirewallOver(
  api: VercelSandboxApi,
  context: Context.Context<DatabaseServices>,
  session: FirewallSession,
  beside: FirewallSources,
): RepositoryFirewall {
  const firewall = sandboxFirewall(api);
  return {
    write: (sources) =>
      Effect.provideContext(firewall.write(session, { ...beside, ...sources }), context),
  };
}

/** The sandbox session as the checkout reaches it, looked up at its first command and held for the rest, through the edge's runner, its firewall the account's given. */
function repositorySandboxOver(
  session: Effect.Effect<SandboxSessionApi, SandboxUnavailable>,
  run: SandboxRunner,
  firewall: RepositoryFirewall,
): RepositorySandbox {
  return {
    run: (ask) =>
      run(
        Effect.map(
          Effect.flatMap(session, (held) =>
            held.run({
              command: "bash",
              args: ["-c", ask.command],
              ...(ask.workingDirectory === undefined ? undefined : { cwd: ask.workingDirectory }),
              ...(ask.env === undefined ? undefined : { env: ask.env }),
            }),
          ),
          (ran) => ({ exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }),
        ),
      ),
    firewall,
  };
}

/** The read as one command: bash, the path and bound as its positional arguments. */
function readFileCommand(path: string, maxBytes: number) {
  return {
    command: "bash",
    args: ["-c", READ_SCRIPT, "read-file", path, String(maxBytes)],
  };
}

/**
 * What the machine does to a place it already opened, over the API given:
 * everything but opening one and launching a runner in it, so a caller with
 * no edge's runner to hand the checkout, as a launch's end, still reaches it.
 */
export function vercelLifecycle(api: VercelSandboxApi): MachineLifecycle {
  const firewall = sandboxFirewall(api);
  /** The running session of the sandbox tagged with the session; unavailable where none is up. */
  const runningSession = (sessionId: string) =>
    Effect.gen(function* () {
      const sandboxes = yield* api.listTagged(sessionId);
      const up = sandboxes.find(
        (sandbox) => sandbox.status !== undefined && UP_STATUSES.has(sandbox.status),
      );
      if (up?.currentSessionId === undefined) return yield* new SandboxUnavailable({});
      return yield* api.session({ name: up.name, sessionId: up.currentSessionId });
    });

  return {
    findPlaces: (session) =>
      Effect.map(api.listTagged(session), (sandboxes) =>
        sandboxes.map((sandbox) => foundOf(session, sandbox)),
      ),

    recordRunner: (place, record) =>
      api.updateTags(place.name, recordTags(place.session, place.agentId, record)),

    firewall: {
      write: (place, userId, sources) => firewall.write(firewallSessionOf(place, userId), sources),
      keepLaunch: (place, userId, launch) =>
        firewall.keepLaunch(firewallSessionOf(place, userId), launch),
      endLaunch: (place, userId, sources) =>
        firewall.endLaunch(firewallSessionOf(place, userId), sources),
      clear: (place) => firewall.clear(sessionOfPlace(place)),
    },

    resume: (found) =>
      Effect.gen(function* () {
        const resumed = yield* Effect.result(api.resume(found.name));
        if (Result.isFailure(resumed)) {
          if (snapshotGone(resumed.failure)) return PLACE_RESUME.GONE;
          return yield* resumed.failure;
        }
        return vercelPlace(found.session, found.name, resumed.success.currentSessionId);
      }),

    stop: (place) =>
      Effect.flatMap(api.session(sessionOfPlace(place)), (session) => session.stop()),

    discard: (found) => api.deleteSandbox(found.name),

    writeFiles: (place, files) =>
      Effect.flatMap(api.session(sessionOfPlace(place)), (session) => session.writeFiles(files)),

    // Note that a sandbox's runner reads every line past its config from us, so a line written
    // here is a caller's mistake, refused loudly rather than written where nothing reads it.
    writeLine: () => Effect.die(new Error("a sandbox's runner reads its lines from the service")),

    wrote: () => Effect.succeed(false),

    runnerExit: (handle, within) =>
      Effect.flatMap(api.session(sessionOfPlace(handle)), (session) =>
        session.commandExit(handle.command, within),
      ),

    kill: (handle) =>
      Effect.flatMap(api.session(sessionOfPlace(handle)), (session) =>
        session.kill(handle.command),
      ),

    readFile: (session, path, bound) =>
      Effect.flatMap(runningSession(session), (running) =>
        Effect.map(running.run(readFileCommand(path, bound + 1)), (ran) =>
          ran.exitCode === 0 ? new Uint8Array(Buffer.from(ran.stdout, "base64")) : undefined,
        ),
      ),
  };
}

/** The machine over the API given, its checkout run through the edge's runner. */
export function vercelMachine(api: VercelSandboxApi, run: SandboxRunner): AgentMachineService {
  /** The sandbox session as the checkout reaches it, its firewall the account's given, with what stands beside the checkout's own, its launch read from the store given. */
  const checkoutOver = (
    context: Context.Context<DatabaseServices>,
    sandbox: OpenedPlace,
    userId: string,
    beside: FirewallSources = {},
  ) =>
    repositorySandboxOver(
      sessionOnFirstUse(api, sessionOfPlace(sandbox)),
      run,
      repositoryFirewallOver(api, context, firewallSessionOf(sandbox, userId), beside),
    );

  /** The same, its launch read from the caller's store. */
  const checkoutIn = (sandbox: OpenedPlace, userId: string, beside: FirewallSources = {}) =>
    Effect.map(Effect.context<DatabaseServices>(), (context) =>
      checkoutOver(context, sandbox, userId, beside),
    );

  /** A new sandbox of the agent's, under the session given, opened from the image or snapshot named at the size its repository asks for. */
  const createdFrom = (
    agent: Agent,
    sessionId: string,
    from: { readonly image: string } | { readonly snapshotId: string },
  ) =>
    api.create({
      name: `${SANDBOX_NAME}${randomUUID()}`,
      from,
      tags: { [SESSION_TAG]: sessionId, [RUNNER_TAG.AGENT]: agent.id },
      timeoutMs: CODER.SANDBOX_TIMEOUT_MS,
      vcpus: sandboxVcpus(agent.repository),
      keepLastSnapshots: {
        count: CODER.SANDBOX_SNAPSHOTS.count,
        expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
        deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
      },
      env: SANDBOX_ENV,
      // Note that the name is new, so one already taken is this create's own, which the SDK sent again after its first answer was lost.
      whenNameTaken: NAME_TAKEN.JOIN,
    });

  /** The sandbox as it runs: its name, and the session it runs in. */
  const runningOf = (opened: OpenedSandbox) => ({
    name: opened.name,
    running: opened.currentSessionId,
  });

  /**
   * The repository snapshot the agent's sandbox may open from: one of its
   * workspace's, made on the image this launch opens, of the repository's
   * default branch; none for an agent started on another branch, or on its
   * starter's own token, whose access is not the workspace's.
   */
  const repositorySnapshotOf = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
    image: string,
  ): Option.Option<RepositorySnapshotOf> =>
    agent.startBranch === null && read.access.kind === GITHUB_ACCESS.APP
      ? Option.some({
          image,
          workspaceId: read.workspaceId,
          fullName: read.fullName,
          defaultBranch: read.defaultBranch,
        })
      : Option.none();

  /**
   * The repository snapshot built past the request's answer, apart from
   * the launch and its runner lease, so neither waits on it; nothing where
   * no request's answer is being kept, as for a relaunch a message makes,
   * which leaves the build to the next Start.
   */
  const buildInBackground = (agent: Agent, of: RepositorySnapshotOf, read: AgentRepositoryRead) =>
    Effect.gen(function* () {
      if (Option.isNone(yield* Effect.serviceOption(AfterResponse))) return;
      yield* afterResponse(
        "A repository snapshot's build",
        Effect.flatMap(Effect.context<DatabaseServices>(), (context) =>
          buildRepositorySnapshot(api, of, read, (sandbox) =>
            checkoutOver(context, sandbox, agent.userId),
          ),
        ),
      );
    });

  /**
   * The workspace's repository's base drive filled past the request's
   * answer where it has none (`base-drive.ts`), on the same terms as the
   * repository snapshot's build.
   */
  const fillBaseDriveInBackground = (
    agent: Agent,
    of: RepositorySnapshotOf,
    read: AgentRepositoryRead,
  ) =>
    Effect.gen(function* () {
      if (Option.isNone(yield* Effect.serviceOption(AfterResponse))) return;
      yield* afterResponse(
        "A base drive's fill",
        Effect.flatMap(Effect.context<DatabaseServices>(), (context) =>
          fillBaseDrive(api, of, of.image, read, (sandbox) =>
            checkoutOver(context, sandbox, agent.userId),
          ),
        ),
      );
    });

  /**
   * The agent's sandbox opened from its repository snapshot and its
   * checkout brought up to the default branch; none where the snapshot was
   * gone or its checkout would not refresh, the snapshot then forgotten so
   * the next launch builds it again, and the sandbox this opened deleted.
   * A Vercel that did not answer the create opens nothing here either, and
   * forgets nothing, so the launch goes on as without a snapshot.
   */
  const openedFromRepositorySnapshot = (
    agent: WithRepository<Agent>,
    sessionId: string,
    harness: string,
    of: RepositorySnapshotOf,
    snapshotId: string,
    read: AgentRepositoryRead,
  ) =>
    Effect.gen(function* () {
      const opened = runningOf(yield* createdFrom(agent, sessionId, { snapshotId }));
      yield* refreshAgentCheckout(agent, yield* checkoutIn(opened, agent.userId), read).pipe(
        Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))),
      );
      return Option.some(opened);
    }).pipe(
      Effect.catch((failure) =>
        Effect.gen(function* () {
          yield* Effect.logWarning(
            `A ${harness} sandbox did not open from its repository snapshot: ${describeFailure(failure)}`,
          );
          const unusable =
            failure instanceof CheckoutRefused ||
            snapshotGone(failure) ||
            failure.status === NOT_FOUND_STATUS;
          if (unusable) yield* Effect.ignore(forgetRepositorySnapshot(api, of, snapshotId));
          return Option.none<OpenedPlace>();
        }),
      ),
    );

  /**
   * The agent's sandbox opened from the image, asked again while the
   * registry still prepares it (`IMAGE_RETRY`), and the `agent` user made in
   * it as the SDK makes one; a sandbox the user could not be made in is
   * deleted again.
   */
  const openedFromImage = (agent: Agent, sessionId: string, image: string) =>
    Effect.gen(function* () {
      const opened = runningOf(
        yield* createdFrom(agent, sessionId, { image }).pipe(
          Effect.retry({
            schedule: Schedule.spaced(IMAGE_RETRY.SPACED),
            times: IMAGE_RETRY.TIMES,
            while: (failure) => failure.code === IMAGE_NOT_READY,
          }),
        ),
      );
      yield* api
        .createUser(opened.name, AGENT_USER, AGENT_HOME_FOLDERS)
        .pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
      return opened;
    });

  /**
   * The agent's sandbox with its repository checked out, on the read the
   * caller made of it, which confirmed its workspace still reaches it
   * before any sandbox opens on its code. Where its workspace's repository
   * snapshot is ready, the sandbox opens from it and fetches only what
   * landed since; otherwise it opens from the image and clones the
   * repository whole, and the snapshot is built past the answer for the
   * next launch (`repository-snapshot.ts`). A snapshot Vercel could not be
   * asked about is passed by, and no build is started on it.
   */
  const primaryCheckedOut = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
    sessionId: string,
    harness: string,
    image: string,
  ) =>
    Effect.gen(function* () {
      const of = repositorySnapshotOf(agent, read, image);
      if (Option.isSome(of)) {
        yield* fillBaseDriveInBackground(agent, of.value, read);
        const found = yield* readRepositorySnapshot(api, of.value).pipe(Effect.option);
        if (Option.isSome(found) && found.value.state === REPOSITORY_SNAPSHOT_STATE.READY) {
          const fromSnapshot = yield* openedFromRepositorySnapshot(
            agent,
            sessionId,
            harness,
            of.value,
            found.value.snapshotId,
            read,
          );
          if (Option.isSome(fromSnapshot)) return fromSnapshot.value;
        }
        // The build reads the snapshot again and leaves one ready or being built be.
        if (Option.isSome(found)) yield* buildInBackground(agent, of.value, read);
      }
      const opened = yield* openedFromImage(agent, sessionId, image);
      yield* cloneAgentRepository(
        agent,
        yield* checkoutIn(opened, agent.userId),
        read,
        CHECKOUT_DEPTH.WHOLE,
      ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))));
      return opened;
    });

  /**
   * The agent's sandbox with its repository checked out (`primaryCheckedOut`),
   * and then each repository it works in beside its own cloned whole into
   * its folder, on the reads the caller made of them (`cloneAgentExtras`),
   * the sandbox deleted again where one would not clone; an agent in one
   * repository clones nothing more.
   */
  const checkedOutSandbox = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
    extras: readonly AgentExtraRead[],
    sessionId: string,
    harness: string,
    image: string,
  ) =>
    Effect.gen(function* () {
      const opened = yield* primaryCheckedOut(agent, read, sessionId, harness, image);
      if (extras.length === 0) return opened;
      yield* cloneAgentExtras(yield* checkoutIn(opened, agent.userId), extras).pipe(
        Effect.tapError(() => Effect.ignore(api.deleteSandbox(opened.name))),
      );
      return opened;
    });

  /**
   * The agent's sandbox opened from the image, its repository checked out
   * in it where it has one (`checkedOutSandbox`). The image's reference and
   * the repository are read at once, since neither waits on the other and
   * both are read before any sandbox opens.
   */
  const openedCheckout = (
    target: ConversationTarget,
    agent: Agent,
    sessionId: string,
    harness: string,
  ) =>
    Effect.gen(function* () {
      const [image, read, extras] = yield* Effect.all(
        [
          Effect.flatMap(AgentImage, (agentImage) => agentImage.reference),
          hasRepository(agent) ? agentRepositoryRead(target, agent) : Effect.succeed(undefined),
          hasRepository(agent) ? agentExtraReads(target, agent) : Effect.succeed([]),
        ],
        { concurrency: "unbounded" },
      );
      return hasRepository(agent) && read !== undefined
        ? yield* checkedOutSandbox(agent, read, extras, sessionId, harness, image)
        : yield* openedFromImage(agent, sessionId, image);
    });

  return {
    ...vercelLifecycle(api),

    layout: () => Effect.succeed(SANDBOX_LAYOUT),

    // What the deepen reads of GitHub (`agentDeepenPlan`) is read beside the sandbox's opening and
    // the caller's own reads, and kept as it ended, so a read that failed fails the launch only
    // once the sandbox it would delete stands, and never cuts its opening short. Note that a
    // sandbox just opened holds no deepen's record, so none is looked for.
    open: (ask, use) =>
      Effect.gen(function* () {
        const [{ name, running }, [deepen, beside]] = yield* Effect.all(
          [
            openedCheckout(ask.target, ask.agent, ask.session, ask.harness),
            Effect.all(
              [
                Effect.exit(
                  hasRepository(ask.agent)
                    ? agentDeepenPlan(ask.target, ask.agent)
                    : Effect.succeed(undefined),
                ),
                ask.beside,
              ],
              { concurrency: "unbounded" },
            ),
          ],
          { concurrency: "unbounded" },
        );
        const repositorySandbox = yield* checkoutIn({ name, running }, ask.agent.userId);
        const finishCheckout = Effect.flatMap(deepen, (plan) =>
          plan === undefined
            ? openWorkingFolder(repositorySandbox)
            : deepenCheckoutWith(repositorySandbox, plan),
        );
        return yield* use(
          {
            place: vercelPlace(ask.session, name, running),
            name: nameOfSandbox(name),
            checkoutPath: SANDBOX_LAYOUT.checkoutPath,
            finishCheckout,
          },
          beside,
        ).pipe(Effect.tapError(() => Effect.ignore(api.deleteSandbox(name))));
      }),

    // The sandbox is readied as root once the caller's steps are done, since the readying shares
    // the checkout they finish, and the runner is started as `agent` after it. The runner is kept in
    // the sandbox's tags before it reads anything, so a later call finds it. A runner started but
    // never configured is ended, and the caller undoes what it recorded of it, so the next message
    // relaunches whole rather than writing to a runner that waits for its config.
    // Note that a clone run again finds the folder of a checkout already standing and clones nothing,
    // so only a repository added since the place opened is cloned here. A runner already running
    // keeps its repository credential through the clone, minted afresh, since each write is whole.
    checkOutExtras: (place, target, agent, shared) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const reads = yield* agentExtraReads(target, agent);
        if (reads.length === 0) return;
        const beside = shared ? yield* agentFirewallSources(target, agent) : {};
        yield* cloneAgentExtras(yield* checkoutIn(place, agent.userId, beside), reads);
        if (!shared) return;
        const session = yield* api.session(sessionOfPlace(place));
        const commandId = yield* session.start({
          command: "bash",
          args: ["-c", sharedCheckoutsScript(reads.map((read) => read.path))],
          sudo: true,
        });
        const exit = yield* session.commandExit(commandId, SHARE_WAIT);
        if (exit !== 0) return yield* new CheckoutRefused({ reason: NOT_SHARED });
      }),

    launchRunner: (place, launch) =>
      Effect.gen(function* () {
        const session = yield* api.session(sessionOfPlace(place));
        const ready = yield* launch.ready;
        const readied = yield* session.run({
          command: "sudo",
          args: ["-n", "bash", "-c", readyScript(launch.extraCheckouts ?? [])],
        });
        if (readied.exitCode !== 0) return yield* new SandboxUnavailable({ detail: NOT_READIED });
        const commandId = yield* api.startAsUser(launch.name, AGENT_USER, {
          command: "node",
          args: [RUNNER_SCRIPT],
          cwd: CODER.CHECKOUT_PATH,
          env: {
            ...SANDBOX_ENV,
            HOME: `/home/${AGENT_USER}`,
            USER: AGENT_USER,
            LOGNAME: AGENT_USER,
            ...launch.env,
          },
        });
        const handle: RunnerHandle = { ...place, command: commandId };
        yield* Effect.gen(function* () {
          const { lines, mark } = yield* launch.firstLines(ready, handle);
          yield* api.updateTags(
            launch.name,
            recordTags(place.session, launch.agentId, {
              kind: RUNNER_RECORD.RUNNING,
              runner: { handle, mark },
            }),
          );
          yield* session
            .writeStdin(commandId, lines)
            .pipe(
              Effect.tapError(() => diedAtStart(session, commandId, Object.values(launch.env))),
            );
        }).pipe(
          Effect.tapError(() =>
            Effect.ignore(Effect.andThen(session.kill(commandId), launch.abandon(ready))),
          ),
        );
        return { handle, ready };
      }),
  };
}

/** The machine over Vercel Sandbox, asked under the token given, its checkout run through the edge's runner. */
export function vercelMachineLayer(
  options: VercelMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient> {
  return Layer.effect(
    AgentMachine,
    Effect.map(vercelSandboxApi(options.readToken), (api) => vercelMachine(api, options.run)),
  );
}
