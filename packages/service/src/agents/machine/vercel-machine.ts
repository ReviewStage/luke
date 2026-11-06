/**
 * vercel-machine.ts -- the agent machine over Vercel Sandbox: a sandbox booted from the agents' image, the runner started in it as the SDK's own user for the agent, and our doors read through it.
 *
 * `open` opens the session's sandbox from the agents' image
 * (`../coder-host/agent-image.ts`), which carries the runner and every tool
 * the harnesses run, with its session's drive mounted at the workspace
 * (`../agent-drive.ts`), through `Sandbox.getOrCreate` under a name of the
 * session's own (`../agent-sandbox-open.ts`), as Vercel's persistent sandboxes are
 * opened: the one standing under it is resumed, one is created where none
 * stands, and one whose snapshot is gone is deleted and created again under
 * the same name, on the same drive. A sandbox the call created is set up in
 * its `onCreate`, as Vercel's examples set one up: the `agent` user made in
 * it as the SDK does, and the checkout made. The checkout stands on the drive:
 * kept as the agent left it where an earlier sandbox of the session made it;
 * as the source left it on a fork of the drive of the agent it was continued
 * or forked from (`../agent-drive.ts`); on a fork of its workspace's repository's base drive, fetched up to the
 * default branch and installed again, which fills in only what landed since;
 * or cloned whole onto an empty drive (`../coder-host/checkout.ts`, the
 * token at the firewall for the clone alone), the base drive filled past the
 * answer where none was. Every write the checkout makes is the group's
 * (`../repository-shell.ts`'s `GROUP_WRITES`), so the `agent` user writes
 * it too. A create Vercel answers `image_not_ready` is asked again once the
 * registry has had time to prepare the image, as Vercel's docs say. The
 * write token and the commit identity are left to the launch
 * (`finishCheckout`), which sets them beside its own steps. Nothing is deleted where the setup or the
 * caller's use fails: the sandbox stands under the session's name, where the
 * next message finds it.
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
 * A place is found again by the session's tag, and its runner by the record
 * a launch writes in our store under the agent's runner lease
 * (`@repo/database/models/agent-runner-record`): the command, the sandbox
 * session it runs in, and the launch's first event number and fingerprint.
 * Note that none of it rides in a tag, because Vercel's tags are labels,
 * each write replacing a sandbox's whole set, so the tags name only the
 * session and its agent, as the sandbox is created. The
 * firewall is the sandbox session's network policy, composed whole at each
 * write from its sources and the swaps its launch keeps
 * (`../sandbox-firewall.ts`), and a stop is the session's. A resume of a
 * sandbox under its session's name is the same `getOrCreate`, which makes
 * it anew on the session's drive where its snapshot expired, set up as a new
 * one is, and says so, since the harness's own session went with the old
 * disk. A sandbox opened before `getOrCreate`, under a UUID, resumes from its
 * last snapshot and is a place gone once that expired; the one opened in
 * its place is the session's own.
 */

import {
  AGENT_USER,
  CODEX_PIN,
  RUNNER_DIRECTORY,
  SANDBOX_TOOLS_DIRECTORY,
  SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME,
  SHARED_FILES_DIRECTORY,
} from "@repo/agent-runner/pins";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type AgentRunnerRecord,
  forgetAgentRunnerRecord,
  readAgentRunnerRecord,
  writeAgentRunnerRecord,
} from "@repo/database/models/agent-runner-record";
import { type Agent, hasRepository, type WithRepository } from "@repo/database/models/agent-store";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Brand, type Context, Duration, Effect, Layer, Option, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AGENT_DRIVE_FROM,
  type AgentDrive,
  type AgentDriveFrom,
  agentDrive,
  agentDriveName,
} from "../agent-drive.js";
import {
  AGENT_TAG,
  agentSandboxName,
  agentSandboxTags,
  openAgentSandbox,
  SANDBOX_ENV,
} from "../agent-sandbox-open.js";
import { type BaseDriveOf, fillBaseDrive, installDependencies } from "../base-drive.js";
import { AgentImage } from "../coder-host/agent-image.js";
import { CODER, sandboxVcpus } from "../coder-host/bounds.js";
import {
  type AgentExtraRead,
  type AgentRepositoryRead,
  agentCheckoutPlan,
  agentExtraReads,
  agentFirewallSources,
  agentRepositoryRead,
  CheckoutRefused,
  cloneAgentExtras,
  cloneAgentRepository,
  finishCheckoutWith,
  openWorkingFolder,
  refreshAgentCheckout,
} from "../coder-host/checkout.js";
import { NATIVE_SKILLS_PATH } from "../coder-host/native-skills.js";
import type { RepositoryFirewall, RepositorySandbox } from "../repository-shell.js";
import {
  type FirewallEntry,
  type FirewallSession,
  type FirewallSources,
  type LaunchSwapKind,
  newPlaceholder,
  placeholderSwap,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  type ListedSandbox,
  type OidcTokenRead,
  type OpenedSandbox,
  SANDBOX_STATUS,
  type SandboxSessionApi,
  SandboxUnavailable,
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
  type DeliveredCredentials,
  type FoundPlace,
  type MachineKept,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  type MachineRunning,
  PLACE_RESUME,
  type RecordedRunner,
  RUNNER_RECORD,
  type RunnerCredential,
  type RunnerHandle,
  type RunnerMark,
  type RunnerRecord,
} from "./agent-machine.js";

/**
 * The agent tag's name before the product's rename, read after `AGENT_TAG`'s
 * and never written. Note that a sandbox's tags are written only as it is
 * created, so one made before carries the old name for as long as it lives;
 * it can go once Vercel lists no sandbox named `SANDBOX_NAME_BEFORE_RENAME`,
 * since only such a sandbox can carry it.
 */
const AGENT_TAG_BEFORE_RENAME = "lukeAgent";

/** The agent a sandbox's tags name, under the tag's name or the one it had before the rename. */
export function agentTag(tags: Readonly<Record<string, string>> | undefined): string | undefined {
  return tags?.[AGENT_TAG] ?? tags?.[AGENT_TAG_BEFORE_RENAME];
}

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
  codexExecutable: CODEX_PIN.LINK,
  codexHome: CODEX_PIN.HOME,
  linesRead: true,
  transcriptsKept: true,
};

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

/**
 * The link a sandbox made before the product's rename is given on each
 * launch, root's, from our tools' directory to the one its image put them
 * in, so the runner and the Claude Code binary are found where the
 * pins name them. Note that it can go only once Vercel lists no sandbox made
 * before the rename (named `luke-agent-` and a UUID), because a sandbox in
 * steady use resumes from its own snapshot for as long as it lives.
 */
const LINK_TOOLS_DIRECTORY = `if [ -d ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ] && [ ! -e ${SANDBOX_TOOLS_DIRECTORY} ] && [ ! -L ${SANDBOX_TOOLS_DIRECTORY} ]; then ln -s ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ${SANDBOX_TOOLS_DIRECTORY}; fi`;

/**
 * A checkout marked safe for git in the sandbox and its repository shared
 * with `agent`'s group, as the launch marks each: the agent's own and every
 * repository it works in beside it. Note that nothing of the checkout's
 * files is changed, because every write the checkout makes is already the
 * group's (`../repository-shell.ts`'s `GROUP_WRITES`); the repository's
 * sharing is set here for a checkout cloned before its clone set it.
 */
function sharedCheckout(path: string): readonly string[] {
  return [
    `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${path} || git config --system --add safe.directory ${path}`,
    `if [ -d ${path}/.git ] && ! git -C ${path} config --get core.sharedRepository | grep -Fxq group; then git -C ${path} config core.sharedRepository group; fi`,
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

/** How long the marking of checkouts cloned under a running runner is waited on. */
const SHARE_WAIT = Duration.minutes(2);

/** Why checkouts cloned under a running runner were not shared with its user. */
const NOT_SHARED = "the checkouts cloned beside the agent's could not be shared with its runner";

/** What a place holds where it holds the agent's own checkout: its repository's git folder. */
const CHECKOUT_GIT_PATH = `${CODER.CHECKOUT_PATH}/.git`;

/** Where a finished checkout's commit identity stands (`finishCheckoutWith`): its repository's own config, read as a file so no ownership check stands in the way. */
const CHECKOUT_CONFIG_PATH = `${CHECKOUT_GIT_PATH}/config`;

/** Why a checkout cloned before a relaunch was not finished: the store did not answer for its commit identity. */
const RESTORE_PLAN_UNREAD = "the restored checkout's commit identity could not be read";

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

/** What an agent with a repository is checked out from as its sandbox is created: the agent, and the reads the open made of its repositories. */
interface AgentCheckoutReads {
  readonly agent: WithRepository<Agent>;
  readonly read: AgentRepositoryRead;
  readonly extras: readonly AgentExtraRead[];
}

/** The sandbox session a place runs in, as the API names it. */
function sessionOfPlace(place: OpenedPlace): SessionRef {
  return { name: place.name, sessionId: place.running };
}

/** The same session as its firewall names it, with the account whose agent it is. */
function firewallSessionOf(place: OpenedPlace, userId: string): FirewallSession {
  return { userId, name: place.name, sandboxSessionId: place.running };
}

/**
 * A launch's credentials as a sandbox's runner takes them: each a
 * placeholder minted for the launch in its variable, and a swap its
 * firewall keeps for the launch, which sets the value in the placeholder's
 * place on requests to its target that present it, so no value enters the
 * sandbox. Note that the swap matches the placeholder and not the target
 * alone, because every process in the sandbox reaches out through that
 * firewall, a Terminal's shell and a page in the agent's browser among them,
 * and only one that reads the placeholder, the runner's own user, may act
 * as the agent. A renewed credential is held the same way, and the sweep
 * renews its swap.
 */
function heldAtFirewall(credentials: readonly RunnerCredential[]): DeliveredCredentials {
  const env: Record<string, string> = {};
  const swaps = new Map<LaunchSwapKind, FirewallEntry>();
  for (const credential of credentials) {
    const placeholder = Redacted.value(newPlaceholder());
    env[credential.variable] = placeholder;
    swaps.set(
      credential.slot,
      placeholderSwap({
        ...credential.target,
        header: credential.header,
        placeholder: Redacted.make(`${credential.scheme}${placeholder}`),
        value: Redacted.make(`${credential.scheme}${Redacted.value(credential.value)}`),
      }),
    );
  }
  return { env, swaps };
}

/** The launch a record tells of: its first event number and fingerprint, of a launch that reads its lines, as every sandbox's does. */
function markOf(record: AgentRunnerRecord): RunnerMark {
  return {
    firstSequence: record.firstSequence,
    ...(record.fingerprint === null ? {} : { fingerprint: record.fingerprint }),
    linesRead: true,
  };
}

/** The record a place keeps for the runner record given, under the sandbox named; none for one that tells of no launch. */
function storedRecord(
  name: string,
  agentId: string,
  record: RunnerRecord,
): AgentRunnerRecord | undefined {
  if (record.kind === RUNNER_RECORD.NONE) return undefined;
  const mark = record.kind === RUNNER_RECORD.LAUNCHED ? record.mark : record.runner.mark;
  const runner = record.kind === RUNNER_RECORD.RUNNING ? record.runner.handle : undefined;
  return {
    agentId,
    sandboxName: name,
    firstSequence: mark.firstSequence,
    fingerprint: mark.fingerprint ?? null,
    sandboxSessionId: runner?.running ?? null,
    commandId: runner?.command ?? null,
  };
}

/** The place's record of its runner written in our store under the account given, or deleted where it tells of no launch. */
function recordedIn(
  place: {
    readonly session: string;
    readonly name: string;
    readonly userId: string;
    readonly agentId: string;
  },
  record: RunnerRecord,
) {
  const stored = storedRecord(place.name, place.agentId, record);
  return stored === undefined
    ? forgetAgentRunnerRecord(place.userId, place.session, place.name)
    : writeAgentRunnerRecord(place.userId, place.session, stored);
}

/** The runner a record names, where the sandbox is up in the session that runner was started in, whether or not it has exited since. */
function runnerInSession(
  session: string,
  sandbox: ListedSandbox,
  record: AgentRunnerRecord,
): RecordedRunner | undefined {
  const { sandboxSessionId, commandId } = record;
  if (
    sandboxSessionId === null ||
    commandId === null ||
    sandbox.status !== SANDBOX_STATUS.RUNNING ||
    sandbox.currentSessionId !== sandboxSessionId
  ) {
    return undefined;
  }
  return {
    handle: { ...vercelPlace(session, sandbox.name, sandboxSessionId), command: commandId },
    mark: markOf(record),
  };
}

/** What a place this machine found keeps for its own later calls: the account its record is kept under. */
interface KeptPlace {
  readonly userId: string;
}

/** A listed sandbox as the place a later call finds, under the account's session given, with the session's record where it was written for this sandbox. */
function foundOf(
  userId: string,
  session: string,
  sandbox: ListedSandbox,
  record: Option.Option<AgentRunnerRecord>,
): FoundPlace {
  const own = Option.getOrUndefined(
    Option.filter(record, (each) => each.sandboxName === sandbox.name),
  );
  const running =
    sandbox.status === SANDBOX_STATUS.RUNNING && sandbox.currentSessionId !== undefined
      ? vercelPlace(session, sandbox.name, sandbox.currentSessionId)
      : undefined;
  const kept: KeptPlace = { userId };
  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    agentId: agentTag(sandbox.tags),
    name: nameOfSandbox(sandbox.name),
    running,
    runner: own === undefined ? undefined : runnerInSession(session, sandbox, own),
    launch: own === undefined ? undefined : markOf(own),
    // SAFETY: what is kept is this machine's own to read back in `discard`; no caller reads it.
    kept: kept as unknown as MachineKept,
  };
}

/** What a found place keeps, which `foundOf` kept. */
function keptOf(found: FoundPlace): KeptPlace {
  // SAFETY: a place this machine found keeps what `foundOf` kept.
  return found.kept as unknown as KeptPlace;
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
    findPlaces: (userId, session) =>
      Effect.map(
        Effect.all([api.listTagged(session), readAgentRunnerRecord(userId, session)], {
          concurrency: "unbounded",
        }),
        ([sandboxes, record]) =>
          sandboxes.map((sandbox) => foundOf(userId, session, sandbox, record)),
      ),

    recordRunner: recordedIn,

    firewall: {
      write: (place, userId, sources) => firewall.write(firewallSessionOf(place, userId), sources),
      keepLaunch: (place, userId, launch) =>
        firewall.keepLaunch(firewallSessionOf(place, userId), launch),
    },

    stop: (place) =>
      Effect.flatMap(api.session(sessionOfPlace(place)), (session) => session.stop()),

    discard: (found) =>
      Effect.andThen(
        api.deleteSandbox(found.name),
        forgetAgentRunnerRecord(keptOf(found).userId, found.session, found.name),
      ),

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

  /** The sandbox as it runs: its name, and the session it runs in. */
  const runningOf = (opened: OpenedSandbox) => ({
    name: opened.name,
    running: opened.currentSessionId,
  });

  /**
   * The base drive the agent's own may be forked from: its workspace's, of
   * the repository's default branch; none for an agent started on another
   * branch, or on its starter's own token, whose access is not the
   * workspace's.
   */
  const baseDriveOf = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
  ): Option.Option<BaseDriveOf> =>
    agent.startBranch === null && read.access.kind === GITHUB_ACCESS.APP
      ? Option.some({
          workspaceId: read.workspaceId,
          fullName: read.fullName,
          defaultBranch: read.defaultBranch,
        })
      : Option.none();

  /**
   * The workspace's repository's base drive filled past the request's
   * answer where it has none (`base-drive.ts`), apart from the launch and
   * its runner lease, so neither waits on it; nothing where no request's
   * answer is being kept, as for a relaunch a message makes, which leaves
   * the fill to the next Start.
   */
  const fillBaseDriveInBackground = (
    agent: Agent,
    of: BaseDriveOf,
    image: string,
    read: AgentRepositoryRead,
  ) =>
    Effect.gen(function* () {
      if (Option.isNone(yield* Effect.serviceOption(AfterResponse))) return;
      yield* afterResponse(
        "A base drive's fill",
        Effect.flatMap(Effect.context<DatabaseServices>(), (context) =>
          fillBaseDrive(api, of, image, read, (sandbox) =>
            checkoutOver(context, sandbox, agent.userId),
          ),
        ),
      );
    });

  /**
   * The agent's checkout on its drive, as the drive came: one kept from an
   * earlier sandbox of the session stands as the agent left it, as does one
   * forked from the drive of the agent it was started from, as that agent
   * left it; a fork of
   * the base drive is brought up to the default branch and installed again,
   * which fills in only what changed since the fill; an empty drive has the
   * repository cloned onto it whole. An install that failed is said in the
   * log and let be, since the agent installs for itself, as one did before
   * drives.
   */
  const checkedOutOnDrive = (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
    from: AgentDriveFrom,
  ) =>
    Effect.gen(function* () {
      if (from === AGENT_DRIVE_FROM.KEPT || from === AGENT_DRIVE_FROM.SOURCE) return;
      if (from === AGENT_DRIVE_FROM.EMPTY) {
        return yield* cloneAgentRepository(agent, sandbox, read);
      }
      yield* refreshAgentCheckout(agent, sandbox, read);
      yield* installDependencies(sandbox).pipe(
        Effect.catch(() => Effect.logWarning("An agent's install on its forked drive failed")),
      );
    });

  /**
   * A sandbox `getOrCreate` created set up for a launch, in its `onCreate`
   * beside the `agent` user it makes (`../agent-sandbox-open.ts`): the
   * agent's repository checked out on the drive (`checkedOutOnDrive`), on
   * the read the caller made of it, which confirmed its workspace still
   * reaches it before any sandbox opens on its code, and each repository it
   * works in beside its own cloned whole into its folder
   * (`cloneAgentExtras`), one already standing on a kept drive left as it is.
   */
  const checkedOutIn = (
    context: Context.Context<DatabaseServices>,
    checkout: AgentCheckoutReads,
    drive: AgentDrive,
    opened: OpenedPlace,
  ) =>
    Effect.suspend(() => {
      const sandbox = checkoutOver(context, opened, checkout.agent.userId);
      return Effect.andThen(
        checkedOutOnDrive(checkout.agent, sandbox, checkout.read, drive.from),
        cloneAgentExtras(sandbox, checkout.extras),
      );
    });

  /**
   * The session's sandbox opened through `getOrCreate`
   * (`../agent-sandbox-open.ts`) at the size the agent's repository asks
   * for, with whether it was created, its checkout made in its `onCreate`
   * where the agent has a repository and the sandbox was created
   * (`checkedOutIn`). A setup that fails fails the open, and what it made is
   * left as it stands. Note that the setup's own failure is the open's,
   * because the SDK hands `onCreate`'s rejection on as the call's, which
   * would read as Vercel's rather than in the checkout's words.
   */
  const gotOn = (
    agent: Agent,
    sessionId: string,
    drive: AgentDrive,
    checkout: AgentCheckoutReads | undefined,
  ) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<DatabaseServices>();
      let refused: CheckoutRefused | undefined;
      const { sandbox, created } = yield* openAgentSandbox(
        api,
        {
          sessionId,
          tags: agentSandboxTags(sessionId, agent.id),
          vcpus: sandboxVcpus(agent.repository),
        },
        checkout === undefined
          ? undefined
          : (opened) =>
              run(
                checkedOutIn(context, checkout, drive, runningOf(opened)).pipe(
                  Effect.tapError((failure) =>
                    Effect.sync(() => {
                      refused = failure;
                    }),
                  ),
                ),
              ),
      ).pipe(Effect.mapError((failure) => refused ?? failure));
      return { ...runningOf(sandbox), created };
    });

  /**
   * The agent's sandbox opened from the image on its session's drive
   * (`agent-drive.ts`) through `getOrCreate` (`gotOn`), its repository
   * checked out on it where it has one and the sandbox was created. The
   * image's reference and the repository are read at once, since neither
   * waits on the other and both are read before any drive or sandbox is
   * made. A Start on the repository's default branch fills its base drive
   * past the answer where it has none, for the agents after it.
   */
  const openedCheckout = (target: ConversationTarget, agent: Agent, sessionId: string) =>
    Effect.gen(function* () {
      const [image, read, extras] = yield* Effect.all(
        [
          Effect.flatMap(AgentImage, (agentImage) => agentImage.reference),
          hasRepository(agent) ? agentRepositoryRead(target, agent) : Effect.succeed(undefined),
          hasRepository(agent) ? agentExtraReads(target, agent) : Effect.succeed([]),
        ],
        { concurrency: "unbounded" },
      );
      const checkout =
        hasRepository(agent) && read !== undefined ? { agent, read, extras } : undefined;
      const base =
        checkout === undefined
          ? Option.none<BaseDriveOf>()
          : baseDriveOf(checkout.agent, checkout.read);
      if (Option.isSome(base) && checkout !== undefined) {
        yield* fillBaseDriveInBackground(agent, base.value, image, checkout.read);
      }
      const drive = yield* agentDrive(
        api,
        sessionId,
        Option.getOrUndefined(base),
        agent.startedFrom?.drive,
      );
      return yield* gotOn(agent, sessionId, drive, checkout);
    });

  /**
   * The agent's own checkout made whole in a place about to be relaunched:
   * cloned where the place holds none, and finished as an opening finishes
   * it (`finishCheckoutWith`) where it holds no commit identity, as after a
   * restore whose finish failed; nothing where it holds a finished one. Note
   * that a place can stand without one, because a launch whose checkout
   * failed leaves its sandbox and its drive for the next message, which
   * resumes them as kept and checks nothing out, so its runner would start
   * in a folder that is not there.
   */
  const ownCheckoutRestored = (
    place: OpenedPlace,
    target: ConversationTarget,
    agent: WithRepository<Agent>,
  ) =>
    Effect.gen(function* () {
      const session = yield* api.session(sessionOfPlace(place));
      const finished = yield* session.run({
        command: "git",
        args: ["config", "--file", CHECKOUT_CONFIG_PATH, "--get", "user.email"],
      });
      if (finished.exitCode === 0) return;
      const holds = yield* session.run({ command: "test", args: ["-d", CHECKOUT_GIT_PATH] });
      const [read, plan] = yield* Effect.all(
        [
          agentRepositoryRead(target, agent),
          agentCheckoutPlan(target, agent).pipe(
            Effect.mapError((failure) =>
              failure instanceof CheckoutRefused
                ? failure
                : new CheckoutRefused({ reason: RESTORE_PLAN_UNREAD }),
            ),
          ),
        ],
        { concurrency: "unbounded" },
      );
      const sandbox = yield* checkoutIn(place, agent.userId);
      if (holds.exitCode !== 0) yield* cloneAgentRepository(agent, sandbox, read);
      yield* finishCheckoutWith(sandbox, plan);
      yield* Effect.logWarning(
        holds.exitCode === 0
          ? "A relaunch found its agent's checkout unfinished and finished it"
          : "A relaunch found no checkout of its agent's repository and cloned it",
      );
    });

  return {
    ...vercelLifecycle(api),

    layout: () => Effect.succeed(SANDBOX_LAYOUT),

    deliverCredentials: (_agent, credentials) => heldAtFirewall(credentials),

    // What the checkout's finish reads of GitHub (`agentCheckoutPlan`) is read beside the sandbox's
    // opening and the caller's own reads, and kept as it ended, so a read that failed fails the
    // launch only once the sandbox stands, and never cuts its opening short. Note that a use that
    // fails leaves the sandbox standing under the session's name, where the next message finds it.
    open: (ask, use) =>
      Effect.gen(function* () {
        const [{ name, running }, [plan, beside]] = yield* Effect.all(
          [
            openedCheckout(ask.target, ask.agent, ask.session),
            Effect.all(
              [
                Effect.exit(
                  hasRepository(ask.agent)
                    ? agentCheckoutPlan(ask.target, ask.agent)
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
        const finishCheckout = Effect.flatMap(plan, (read) =>
          read === undefined
            ? openWorkingFolder(repositorySandbox)
            : finishCheckoutWith(repositorySandbox, read),
        );
        return yield* use(
          {
            place: vercelPlace(ask.session, name, running),
            name: nameOfSandbox(name),
            checkoutPath: SANDBOX_LAYOUT.checkoutPath,
            finishCheckout,
          },
          beside,
        );
      }),

    // A sandbox under its session's name is run again as it was opened, through `getOrCreate`
    // (`gotOn`): resumed where it stands, or made again on the session's drive where its snapshot is
    // gone, set up with nothing to check out, since the drive holds the checkout. One opened before,
    // under a UUID, resumes from its snapshot alone, and is gone once that lapsed.
    resume: (found, agent) =>
      Effect.gen(function* () {
        if (found.name === agentSandboxName(found.session)) {
          const drive = { name: agentDriveName(found.session), from: AGENT_DRIVE_FROM.KEPT };
          const { name, running, created } = yield* gotOn(agent, found.session, drive, undefined);
          return { place: vercelPlace(found.session, name, running), created };
        }
        const resumed = yield* Effect.result(api.resume(found.name));
        if (Result.isFailure(resumed)) {
          if (snapshotGone(resumed.failure)) return PLACE_RESUME.GONE;
          return yield* resumed.failure;
        }
        return {
          place: vercelPlace(found.session, found.name, resumed.success.currentSessionId),
          created: false,
        };
      }),

    // The sandbox is readied as root once the caller's steps are done, since the readying shares
    // the checkout they finish, and the runner is started as `agent` after it. The runner is recorded
    // in our store before it reads anything, so a later call finds it. A runner started but
    // never configured is ended, and the caller undoes what it recorded of it, so the next message
    // relaunches whole rather than writing to a runner that waits for its config.
    // Note that a clone run again finds the folder of a checkout already standing and clones nothing,
    // so only a repository added since the place opened is cloned here. A runner already running
    // keeps its repository credential through the clone, minted afresh, since each write is whole.
    // Before a relaunch (not `shared`), the agent's own checkout is cloned first where the place
    // holds none (`ownCheckoutRestored`).
    checkOutMissing: (place, target, agent, shared) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        if (!shared) yield* ownCheckoutRestored(place, target, agent);
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
          yield* recordedIn(
            {
              session: place.session,
              name: launch.name,
              userId: launch.userId,
              agentId: launch.agentId,
            },
            { kind: RUNNER_RECORD.RUNNING, runner: { handle, mark } },
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
