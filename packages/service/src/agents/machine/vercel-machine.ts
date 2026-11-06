/**
 * vercel-machine.ts -- the agent machine over Vercel Sandbox: a sandbox booted from the agents' image, the runner started in it as the SDK's own user for the agent, and our doors read through it.
 *
 * `open` opens the session's sandbox through `Sandbox.getOrCreate` under a
 * name of the session's own (`../agent-sandbox-open.ts`), as Vercel's
 * persistent sandboxes are opened: the one standing under it is resumed, and
 * one is created where none stands, or where the one standing can never
 * resume, its snapshot gone. A sandbox the call creates is created from the
 * first of these that stands, and set up in its `onCreate`, as Vercel's
 * examples set one up: from the latest snapshot of the sandbox of the agent
 * it was continued or forked from, its checkout as that agent left it at its
 * last stop; from its workspace's repository's base snapshot
 * (`../base-snapshot.ts`), its checkout fetched up to the default branch and
 * installed again, which fills in only what landed since; or from the agents'
 * image (`../coder-host/agent-image.ts`), which carries the runner and every
 * tool the harnesses run, the repository cloned whole
 * (`../coder-host/checkout.ts`, the token at the firewall for the clone
 * alone). A snapshot found gone at the create is passed by for the next, and
 * the base snapshot is filled past the answer where it was missing, gone, out
 * of date, or behind a lockfile the fast-forward moved. The `agent` user is
 * made in a sandbox created from the image or the base snapshot, as the SDK
 * makes one. Every write the checkout makes is the group's
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
 * (`../sandbox-firewall.ts`), and a stop is the session's, which a snapshot
 * of another agent's sandbox carries none of. A resume of a
 * sandbox under its session's name is the same `getOrCreate`, which makes
 * it anew from the image where its snapshot expired, its checkout cloned
 * again before the relaunch, and says so, since the harness's own session
 * and whatever the agent never pushed went with the old disk. A sandbox
 * opened before `getOrCreate`, under a UUID, resumes from its
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
import {
  type Agent,
  hasRepository,
  readAgent,
  type WithRepository,
} from "@repo/database/models/agent-store";
import type { FirewallOwner } from "@repo/database/models/provider-key-seal";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import type { ConversationTarget } from "@repo/database/models/writer";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { GITHUB_ACCESS } from "@repo/features/github-repositories-wire";
import { Brand, type Context, Duration, Effect, Layer, Option, Redacted, Result } from "effect";
import type { HttpClient } from "effect/http";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AGENT_TAG,
  type AgentSnapshotSource,
  agentSandboxName,
  agentSandboxTags,
  openAgentSandbox,
  SANDBOX_ENV,
} from "../agent-sandbox-open.js";
import {
  BASE_STATE,
  type BaseSnapshotOf,
  checkoutCommit,
  fillBaseSnapshot,
  installDependencies,
  lockfileMoved,
  readBaseSnapshot,
} from "../base-snapshot.js";
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
  type CheckoutServices,
  cloneAgentExtras,
  cloneAgentRepository,
  finishCheckoutWith,
  firewallSourcesOfAgent,
  openWorkingFolder,
  refreshAgentCheckout,
} from "../coder-host/checkout.js";
import { NATIVE_SKILLS_PATH } from "../coder-host/native-skills.js";
import {
  REPOSITORY_REFUSAL,
  type RepositoryFirewall,
  type RepositorySandbox,
  runInSandbox,
} from "../repository-shell.js";
import {
  type FirewallEntry,
  type FirewallSession,
  type FirewallSources,
  type LaunchSwapKind,
  newPlaceholder,
  placeholderSwap,
  renewedSwap,
  type SandboxFirewall,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  type ListedSandbox,
  NOT_FOUND_STATUS,
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
  SWAP_RENEWAL,
  type SwapRenewal,
  type SwapRenewalAsk,
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

/**
 * What a created sandbox was created from, which says how its checkout is
 * made: a snapshot of the sandbox of the agent it was started from, its
 * repository's base snapshot, or the image.
 */
const CREATED_FROM = { SOURCE: "source", BASE: "base", IMAGE: "image" } as const;

type CreatedFrom = (typeof CREATED_FROM)[keyof typeof CREATED_FROM];

/** One way the agent's sandbox may be created: what from, and the snapshot where it is one. */
interface CreateAttempt {
  readonly from: CreatedFrom;
  readonly snapshot: AgentSnapshotSource | undefined;
}

/** The image, which every open falls back to. */
const FROM_IMAGE: CreateAttempt = { from: CREATED_FROM.IMAGE, snapshot: undefined };

/** Whether a create failed because the snapshot it named is gone, expired or deleted, so the next way is tried. */
function snapshotUnusable(failure: { readonly _tag: string }): boolean {
  return (
    snapshotGone(failure) ||
    (failure instanceof SandboxUnavailable && failure.status === NOT_FOUND_STATUS)
  );
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
 * The firewall session a kept launch runs in, its sandbox found by name the
 * way an agent's sandbox is found: the agent the launch named, the session
 * its conversation records, the sandboxes tagged with it, and among them the
 * one still running the owner's session. None where any of them no longer
 * stands, as for a row its session outlived, or one kept before launches
 * named their agent.
 */
const launchSession = (api: VercelSandboxApi, owner: FirewallOwner, agentId: string | undefined) =>
  Effect.gen(function* () {
    if (agentId === undefined) return undefined;
    const agent = yield* readAgent(owner.userId, agentId);
    if (Option.isNone(agent)) return undefined;
    const runtime = yield* recordedRuntimeSession({
      userId: owner.userId,
      conversationId: agent.value.conversationId,
    });
    if (runtime === undefined) return undefined;
    const sandboxes = yield* api.listTagged(runtime);
    const sandbox = sandboxes.find((each) => each.currentSessionId === owner.sandboxSessionId);
    if (sandbox === undefined) return undefined;
    return { ...owner, name: sandbox.name } satisfies FirewallSession;
  });

/** What a renewal writes once it gathered it: the session found running, the swap renewed, and the sources sent beside it. */
interface SwapWrite {
  readonly session: FirewallSession;
  readonly entry: FirewallEntry;
  readonly sources: FirewallSources;
}

/**
 * A standing launch's swap renewed at its sandbox session's firewall
 * (`MachineFirewall`'s `renew`): the fresh value asked only where the launch
 * kept for the session holds the slot, set behind the same placeholder where
 * the swap stands on the target's host alone and sets another value, and the
 * session's whole policy sent with the agent's repository credential minted
 * afresh beside it (`firewallSourcesOfAgent`). A launch whose sandbox no
 * longer runs its session is left (`launchSession`), for the sweep's drop.
 */
const swapRenewed = <E extends { readonly _tag: string }, R>(
  api: VercelSandboxApi,
  firewall: SandboxFirewall,
  owner: FirewallOwner,
  { credential, fresh }: SwapRenewalAsk<E, R>,
): Effect.Effect<SwapRenewal, SandboxUnavailable, R | CheckoutServices> =>
  Effect.gen(function* () {
    const launch = yield* firewall.launchOf(owner);
    const standing = launch?.swaps.get(credential.slot);
    if (launch === undefined || standing === undefined) return { outcome: SWAP_RENEWAL.LEFT };
    const next: SwapRenewal | SwapWrite = yield* Effect.gen(function* () {
      const value = yield* fresh;
      if (value === undefined) return { outcome: SWAP_RENEWAL.UNANSWERED } as const;
      const hosts = Redacted.value(standing.rules).map(([host]) => host);
      if (!hosts.every((host) => host === credential.target.domain)) {
        return { outcome: SWAP_RENEWAL.ELSEWHERE } as const;
      }
      const entry = renewedSwap(
        standing,
        Redacted.make(`${credential.scheme}${Redacted.value(value)}`),
      );
      if (entry === undefined) return { outcome: SWAP_RENEWAL.LEFT } as const;
      const session = yield* launchSession(api, owner, launch.agentId);
      if (session === undefined) return { outcome: SWAP_RENEWAL.LEFT } as const;
      const sources = yield* firewallSourcesOfAgent(owner.userId, launch.agentId);
      return { session, entry, sources };
    }).pipe(
      Effect.catch((failure) =>
        Effect.succeed({ outcome: SWAP_RENEWAL.FAILED, failure: failure._tag } as const),
      ),
    );
    if ("outcome" in next) return next;
    yield* firewall.renew(next.session, launch, credential.slot, next.entry, next.sources);
    return { outcome: SWAP_RENEWAL.RENEWED };
  });

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
      clear: (place) => firewall.clear(sessionOfPlace(place)),
      renew: (owner, ask) => swapRenewed(api, firewall, owner, ask),
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
   * The base snapshot the agent's sandbox may be created from: its
   * workspace's, of the repository's default branch; none for an agent
   * started on another branch, or on its starter's own token, whose access
   * is not the workspace's.
   */
  const baseSnapshotOf = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
  ): Option.Option<BaseSnapshotOf> =>
    agent.startBranch === null && read.access.kind === GITHUB_ACCESS.APP
      ? Option.some({
          workspaceId: read.workspaceId,
          fullName: read.fullName,
          defaultBranch: read.defaultBranch,
        })
      : Option.none();

  /**
   * The workspace's repository's base snapshot filled past the request's
   * answer where it wants one (`base-snapshot.ts`), or filled again in place
   * of the snapshot `replacing` names, apart from the launch and its runner
   * lease, so neither waits on it; nothing where no request's answer is
   * being kept, as for a relaunch a message makes, which leaves the fill to
   * the next Start.
   */
  const fillBaseInBackground = (
    agent: Agent,
    of: BaseSnapshotOf,
    image: string,
    read: AgentRepositoryRead,
    replacing: string | undefined,
  ) =>
    Effect.gen(function* () {
      if (Option.isNone(yield* Effect.serviceOption(AfterResponse))) return;
      yield* afterResponse(
        "A base snapshot's fill",
        Effect.flatMap(Effect.context<DatabaseServices>(), (context) =>
          fillBaseSnapshot(
            api,
            of,
            image,
            read,
            (sandbox) => checkoutOver(context, sandbox, agent.userId),
            replacing,
          ),
        ),
      );
    });

  /**
   * The agent's checkout in the sandbox just created, as it was created:
   * from the source agent's snapshot it stands as that agent left it, and is
   * cloned only where that snapshot holds none; from the base snapshot it is
   * brought up to the default branch and installed again, which fills in only
   * what changed since the fill, answering whether that moved a lockfile;
   * from the image the repository is cloned whole. An install that failed is
   * said in the log and let be, since the agent installs for itself.
   */
  const checkedOutAs = (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
    from: CreatedFrom,
  ) =>
    Effect.gen(function* () {
      if (from === CREATED_FROM.IMAGE) {
        yield* cloneAgentRepository(agent, sandbox, read);
        return false;
      }
      if (from === CREATED_FROM.SOURCE) {
        const holds = yield* runInSandbox(
          sandbox,
          { command: `test -d ${CHECKOUT_GIT_PATH}` },
          REPOSITORY_REFUSAL.CHECKOUT_FAILED,
        ).pipe(
          Effect.mapError(
            (failure) => new CheckoutRefused({ reason: failure.reason, detail: failure.detail }),
          ),
        );
        if (holds.exitCode !== 0) yield* cloneAgentRepository(agent, sandbox, read);
        return false;
      }
      // Note that a lockfile read that failed reads as unmoved, since it only decides a refill.
      const base = yield* Effect.orElseSucceed(checkoutCommit(sandbox), () => undefined);
      yield* refreshAgentCheckout(agent, sandbox, read);
      const moved =
        base === undefined
          ? false
          : yield* Effect.orElseSucceed(lockfileMoved(sandbox, base), () => false);
      yield* installDependencies(sandbox).pipe(
        Effect.catch(() =>
          Effect.logWarning("An agent's install on its repository's base snapshot failed"),
        ),
      );
      return moved;
    });

  /**
   * A sandbox `getOrCreate` created set up for a launch, in its `onCreate`
   * beside the `agent` user it makes (`../agent-sandbox-open.ts`): the
   * agent's repository checked out as it was created (`checkedOutAs`), on
   * the read the caller made of it, which confirmed its workspace still
   * reaches it before any sandbox opens on its code, and each repository it
   * works in beside its own cloned into its folder (`cloneAgentExtras`), one
   * already standing in a source's snapshot left as it is. Answers whether
   * the checkout moved a lockfile past the base snapshot's.
   */
  const checkedOutIn = (
    context: Context.Context<DatabaseServices>,
    checkout: AgentCheckoutReads,
    from: CreatedFrom,
    opened: OpenedPlace,
  ) =>
    Effect.suspend(() => {
      const sandbox = checkoutOver(context, opened, checkout.agent.userId);
      return Effect.tap(checkedOutAs(checkout.agent, sandbox, checkout.read, from), () =>
        cloneAgentExtras(sandbox, checkout.extras),
      );
    });

  /**
   * The session's sandbox opened through `getOrCreate`
   * (`../agent-sandbox-open.ts`) at the size the agent's repository asks
   * for, created as the attempt says where none stands, with whether it was
   * created, its checkout made in its `onCreate` where the agent has a
   * repository and the sandbox was created (`checkedOutIn`), and whether that
   * moved a lockfile. A setup that fails fails the open, and what it made is
   * left as it stands. Note that the setup's own failure is the open's,
   * because the SDK hands `onCreate`'s rejection on as the call's, which
   * would read as Vercel's rather than in the checkout's words.
   */
  const gotOn = (
    agent: Agent,
    sessionId: string,
    attempt: CreateAttempt,
    checkout: AgentCheckoutReads | undefined,
  ) =>
    Effect.gen(function* () {
      const context = yield* Effect.context<DatabaseServices>();
      let refused: CheckoutRefused | undefined;
      let moved = false;
      const { sandbox, created } = yield* openAgentSandbox(
        api,
        {
          sessionId,
          tags: agentSandboxTags(sessionId, agent.id),
          vcpus: sandboxVcpus(agent.repository),
          ...(attempt.snapshot === undefined ? undefined : { snapshot: attempt.snapshot }),
        },
        checkout === undefined
          ? undefined
          : (opened) =>
              run(
                checkedOutIn(context, checkout, attempt.from, runningOf(opened)).pipe(
                  Effect.tap((lockfile) =>
                    Effect.sync(() => {
                      moved = lockfile;
                    }),
                  ),
                  Effect.tapError((failure) =>
                    Effect.sync(() => {
                      refused = failure;
                    }),
                  ),
                  Effect.asVoid,
                ),
              ),
      ).pipe(Effect.mapError((failure) => refused ?? failure));
      return { ...runningOf(sandbox), created, lockfileMoved: moved };
    });

  /**
   * The latest snapshot of the sandbox of the agent this one was started
   * from, where the Start named one and it still holds one; none where it
   * could not be read, which the open then passes by.
   */
  const sourceSnapshotOf = (agent: Agent) =>
    Effect.gen(function* () {
      const source = agent.startedFrom?.sandbox;
      if (source === undefined) return undefined;
      const found = yield* api.getNamed(source);
      return found?.currentSnapshotId;
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`A source agent's sandbox was not read: ${failure.message}`),
          undefined,
        ),
      ),
    );

  /**
   * The agent's sandbox opened from the first attempt whose snapshot stands
   * (`gotOn`), each one found gone at the create logged and passed by, as
   * the open ended, and the base snapshot to fill again in place of: the one this
   * open named where it was gone, or where its fast-forward moved a lockfile.
   */
  const openedFromFirst = (
    agent: Agent,
    sessionId: string,
    attempts: readonly CreateAttempt[],
    checkout: AgentCheckoutReads | undefined,
  ) =>
    Effect.gen(function* () {
      let replacing: string | undefined;
      for (const attempt of attempts) {
        const opened = yield* Effect.result(gotOn(agent, sessionId, attempt, checkout));
        // Note that a sandbox standing under the name failed after its create, in its setup, so the
        // next attempt would resume it with nothing checked out; only a create refused is passed by.
        const gone =
          Result.isFailure(opened) &&
          attempt.snapshot !== undefined &&
          snapshotUnusable(opened.failure) &&
          (yield* api.getNamed(agentSandboxName(sessionId)).pipe(
            Effect.map((standing) => standing === undefined),
            Effect.orElseSucceed(() => false),
          ));
        const moved = Result.isSuccess(opened) && opened.success.lockfileMoved;
        if ((gone || moved) && attempt.from === CREATED_FROM.BASE) {
          replacing = attempt.snapshot?.snapshotId;
        }
        if (!gone) return { opened, replacing };
        yield* Effect.logWarning(
          `An agent's sandbox was not created from its ${attempt.from} snapshot, which was gone`,
        );
      }
      // The image is always the last attempt, and is never passed by.
      return yield* Effect.die(new Error("an agent's sandbox was opened from nothing"));
    });

  /**
   * The agent's sandbox opened through `getOrCreate` (`gotOn`), its
   * repository checked out where it has one and the sandbox was created:
   * from its source's snapshot, else its repository's base snapshot where
   * that is ready, else the image, each snapshot found gone at the create
   * passed by for the next. The image's reference, the repository, and the
   * source's snapshot are read at once, since none waits on another. A
   * Start on the repository's default branch fills its base snapshot past
   * the answer where it wants one, or where the one this open named was
   * gone or its fast-forward moved a lockfile, for the agents after it.
   */
  const openedCheckout = (target: ConversationTarget, agent: Agent, sessionId: string) =>
    Effect.gen(function* () {
      const [image, read, extras, source] = yield* Effect.all(
        [
          Effect.flatMap(AgentImage, (agentImage) => agentImage.reference),
          hasRepository(agent) ? agentRepositoryRead(target, agent) : Effect.succeed(undefined),
          hasRepository(agent) ? agentExtraReads(target, agent) : Effect.succeed([]),
          hasRepository(agent) ? sourceSnapshotOf(agent) : Effect.succeed(undefined),
        ],
        { concurrency: "unbounded" },
      );
      const checkout =
        hasRepository(agent) && read !== undefined ? { agent, read, extras } : undefined;
      const base =
        checkout === undefined
          ? Option.none<BaseSnapshotOf>()
          : baseSnapshotOf(checkout.agent, checkout.read);
      // A base Vercel could not be asked about is passed by, and no fill is started on it.
      const baseRead = Option.isSome(base)
        ? yield* Effect.option(readBaseSnapshot(api, base.value, image))
        : Option.none();
      const baseReady = Option.flatMap(baseRead, (each) =>
        each.state === BASE_STATE.READY ? Option.some(each.snapshotId) : Option.none(),
      );
      const attempts: readonly CreateAttempt[] = [
        ...(source === undefined
          ? []
          : [{ from: CREATED_FROM.SOURCE, snapshot: { snapshotId: source, holdsUser: true } }]),
        ...Option.match(baseReady, {
          onNone: () => [],
          onSome: (snapshotId) => [
            { from: CREATED_FROM.BASE, snapshot: { snapshotId, holdsUser: false } },
          ],
        }),
        FROM_IMAGE,
      ];
      const { opened, replacing } = yield* openedFromFirst(agent, sessionId, attempts, checkout);
      if (Option.isSome(base) && Option.isSome(baseRead) && checkout !== undefined) {
        yield* fillBaseInBackground(agent, base.value, image, checkout.read, replacing);
      }
      if (Result.isFailure(opened)) return yield* Effect.fail(opened.failure);
      return opened.success;
    });

  /**
   * The agent's own checkout made whole in a place about to be relaunched:
   * cloned where the place holds none, and finished as an opening finishes
   * it (`finishCheckoutWith`) where it holds no commit identity, as after a
   * restore whose finish failed; nothing where it holds a finished one. Note
   * that a place can stand without one, because a launch whose checkout
   * failed leaves its sandbox for the next message, which resumes it and
   * checks nothing out, and a sandbox made anew in place of one whose
   * snapshot lapsed holds none, so its runner would start in a folder that is
   * not there.
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
    // (`gotOn`): resumed where it stands, or made again from the image where its snapshot is gone,
    // set up with nothing to check out, since the relaunch clones the checkout it finds missing
    // (`ownCheckoutRestored`). One opened before, under a UUID, resumes from its snapshot alone, and
    // is gone once that lapsed.
    resume: (found, agent) =>
      Effect.gen(function* () {
        if (found.name === agentSandboxName(found.session)) {
          const { name, running, created } = yield* gotOn(
            agent,
            found.session,
            FROM_IMAGE,
            undefined,
          );
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
