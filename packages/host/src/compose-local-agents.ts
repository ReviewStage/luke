import type {
  DeviceAgentBeat,
  DeviceAgentClaimedLine,
  DeviceAgentDevice,
  DeviceAgentUpdate,
  HostedDeviceAgentClient,
} from "@luke/features";
import { DEVICE_BEAT } from "@luke/features/agent-wire";
import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@luke/features/checkout-identity";
import {
  DEVICE_AGENT_FOLDER,
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ISOLATION,
  DEVICE_LAUNCH_REFUSAL,
  DEVICE_SETUP,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLayout,
  type DeviceAgentLine,
  type DeviceAgentRelease,
  type DeviceAgentRequest,
  type DeviceIsolation,
  type DeviceLaunchRefusal,
  type DeviceSignedIn,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLayout,
  deviceAgentStdinPayloadSchema,
} from "@luke/features/device-agent-wire";
import { GITHUB_TOKEN_REFRESH } from "@luke/features/host-wire";
import {
  Clock,
  Config,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  FiberSet,
  Option,
  Path,
  Queue,
  Random,
  Ref,
  Result,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as HttpClient from "effect/http/HttpClient";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import { releaseFollowerLock, renewFollowerLock, takeFollowerLock } from "./follower-lock.js";
import type { HostKernel } from "./host-kernel.js";
import {
  AGENT_GIT_HELPER_SCRIPT,
  agentFoldersMade,
  agentGitHelperEnv,
  agentGithubEnv,
  agentGithubForgotten,
  agentGithubWritten,
  agentOnBox,
} from "./local-agent-box.js";
import { LAUNCH_NOTE, notedFirstLines, sessionResumed } from "./local-agent-first-lines.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import {
  forgetOwnedAgent,
  keepOwnedAgent,
  type LocalAgentState,
  localAgentDeviceOf,
  ownedAgents,
  readLocalAgentState,
  writeLocalAgentState,
} from "./local-agent-state.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-local-agents.ts -- runs on this device the coding agents the account starts on it, each straight on the box in a folder of its own: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as its gate stands (`LocalAgentsDependencies.switchedOn`: open but while Luke refuses the device, `daemon/host-standing.ts`).
 *
 * The service writes a local agent's work as rows under this device's id
 * (`@luke/features/device-agent-wire`, `contract/device-agents.ts`): lines
 * for its runner and requests from its tools. A Mac's id is minted once per
 * account and kept in the host's state; a host is handed the one it enrolled
 * under (`LocalAgentsDependencies.deviceId`). Every time the gate opens, an
 * app start among them, the device first has its agents' CLIs
 * (`LocalAgentClis.ready`: Claude Code, Codex, and GitHub's CLI, each
 * fetched and checked). A first fetch takes minutes, so while
 * it runs the device registers as preparing (`DEVICE_SETUP`) and beats, and
 * the menus list it as getting ready, which takes no agent; one that failed
 * registers why and beats, so it is listed as not set up rather than not at
 * all, and is tried again after `SETUP_RETRY`'s wait, doubling from try to
 * try, for as long as the gate stands. Once it has them it registers with
 * its home folder, the Claude Code and Codex its agents run on
 * (`LocalAgentPlatformSeam.tools`), and no harness signed in by itself,
 * since no login of the device's is what its agents run on, so every launch
 * carries the sign-in saved in Luke; then it beats every `BEAT_EVERY` while
 * it follows. It holds one read for its lines and one for its requests,
 * each answered by the service as soon as one waits, and claims each by its
 * id.
 *
 * Lines are claimed in the order the service lists them, its id order, and
 * handed to the agent they name, whose worker takes them one at a time, so
 * an agent's lines are delivered strictly in order while agents go on side
 * by side. Each claim carries a token minted for its line and kept until
 * the claim is answered, so a claim whose answer was lost is asked again as
 * the same claim, before the next read, and the line is delivered once; a
 * launch whose claim was asked again had its secrets taken by the answer
 * lost, so it is settled as a runner gone. A launch makes the agent's own
 * repository under its folder (`deviceAgentLayout`) where it has none,
 * through the platform's script, sets in it who the agent's commits are by
 * where the line says, as a cloud checkout sets it
 * (`@luke/features/checkout-identity`), and gh's credential helper, and
 * starts the runner (`LocalAgentPlatformSeam.launch`), with the claim's
 * secrets in its environment and nowhere else, never a file, an argument,
 * or a log, and its first lines on its stdin; its line is settled with the
 * runner's exit code once it exits. A message or retune line is written to
 * the running runner's stdin; a files line writes its files under the
 * agent's folder; a stop line ends the runner; a discard line ends it and
 * removes the agent's folder with everything in it, unless the platform's
 * check of the worktree finds work there that is nowhere else; a line of a
 * kind it does not know is settled untouched. A launch whose repository
 * could not be made is settled as not started, and the runner never
 * starts. A launch or files line keeps the agent as one whose folder this
 * machine made (`keepOwnedAgent`), and a discard that removes the folder
 * forgets it, so an uninstall removes this machine's agents and no other
 * Luke install's beside it. Every time the gate opens, every agent the
 * host's own state names, in how each ran or a launch it kept, is kept so
 * too, and, on a device whose agents' folders are its own alone
 * (`LocalAgentPlatformSeam.storesOwned`, a Linux host's), every agent with
 * a folder there (`adopted`), so one it last ran before it kept that record
 * is cleaned up as the rest are; never one from a Mac's folders, which are
 * shared.
 *
 * Every host runs its agents straight on the box
 * (`DEVICE_ISOLATION.DIRECT`): the runner is a child of the host's own
 * process, the leader of a process group of its own, on the host's own
 * Node and the CLIs it keeps, as its user, in the agent's folder, with the
 * agent's home and caches there (`local-agent-box.ts`). Stopping it signals
 * its group alone, and kills the group once `KILL_GRACE` has passed, so
 * nothing of the host's or of any other agent's is stopped with it. Its
 * folder stays between its turns: a turn's end lets go of its GitHub
 * token and empties its `tmp`, and the next turn's runner goes on from the
 * rest, its repository and its harness's session, until the agent is let
 * go of, or a pass finds it unused for `FOLDER_UNUSED_FOR`, by when it last
 * launched, ended a turn, or had files written, with all its work on
 * GitHub, and clears its folder. A launch that finds none
 * of the agent's work in its folder, which was cleared since, and would
 * continue a harness's session, starts the agent afresh with none, from a
 * repository made anew, and tells it so (`LAUNCH_NOTE.CLEARED`). For an
 * agent working in a repository, the device asks the service for an
 * installation token before the repository is made, and again once the
 * last is `GITHUB_TOKEN_REFRESH` old by the wall clock, read every minute,
 * while its runner runs, since such a token lasts an hour and a turn can
 * last a day, and a sleeping machine stretches a long wait but not the
 * hour; it writes it into gh's config in the agent's home, which its `gh`
 * and its repository's `git` read on every call, so a renewal reaches a
 * turn already running. The check of its folder for unsaved work runs on
 * the box.
 *
 * Agents on This Mac ran on the developer's own logins on it before Luke
 * gave each agent a folder of its own
 * (`LocalAgentPlatformSeam.formerlyDirect`), so there the host keeps how
 * each agent ran, beside its launches, and takes an agent from before that
 * record with a checkout as one that ran so (`DEVICE_ISOLATION.BARE`): its
 * Git folder is in the shared clone and its harness's sessions in the
 * developer's own home, so its launch is settled unstarted with the refusal
 * that says so (`DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY`).
 *
 * Every launch this device claimed is kept in the host's state by its
 * line's id and its agent's, no secret beside it, until the service takes
 * its settle. A launch still kept as the gate opens had its runner end with
 * the app, or with the gate, so its turn is let go of as any turn's end is,
 * and it is settled with no exit code, which the service reads as a runner
 * gone: the agent's turn in flight is settled lost, and its next message
 * relaunches the runner on the harness's session. No runner runs as the
 * gate opens, so every agent this machine made (`ownedAgents`) has its turn
 * let go of too, whatever a run that died left in its folder. An agent this
 * machine did not make is never touched, since This Mac and a Mac's own
 * `luke-host` share the user's `~/.luke/agents`.
 *
 * The service's list of the device's open launches is what the device
 * runs: every beat answers it (`DeviceAgentBeat`), and the device converges
 * to it. A kept launch whose runner ended is settled again on every beat
 * until the service takes it, or no longer lists it; a runner whose launch
 * the answer does not name, after a Stop, a settle, or a lapse of the
 * device's lease, is stopped as a stop line stops it; and a launch it names
 * that the device runs nothing for, and is not starting, is settled as a
 * runner gone. Only what stood before the beat was sent is judged against
 * its answer, and a launch claimed or starting is never settled, since the
 * answer may have been read before its claim. A service from before the
 * list names none, and the device only settles what it kept.
 *
 * The device passes over the agents this machine made (`ownedAgents`),
 * never another Luke install's beside it, after the first beat the service
 * answers and every `PASS_EVERY` after. A pass leaves an agent be while a
 * line of its is delivered or waits to be, its runner runs, or a launch of
 * its is kept. And the service's list of the device's live agents, those
 * pinned to it and not archived, is read: an
 * agent `ORPHAN_AFTER` answered reads in a row left out is let go of as a
 * discard lets go of it, at most `ORPHANS_PER_PASS` a pass; one whose
 * folder the platform's check finds work in, or cannot say of, or on a
 * platform that names no check, is kept, and recorded so with when, so no
 * work is deleted before `KEPT_FOR` has passed, and then let go of whole.
 * A read that was not answered lets go of no agent whole. This is what
 * catches every agent a discard line
 * never reached: archived while the device was away, whose line expired,
 * discarded by a run that crashed, or deleted with its task. One that ran
 * on the developer's own logins is checked on the device as the rest are.
 * A pass then clears the folders of idle agents unused for
 * `FOLDER_UNUSED_FOR`, longest unused first, where the platform's check
 * finds all their work on GitHub, a local branch and a stash among it,
 * checking at most `FOLDER_CHECKS_PER_PASS` a pass and never again one it
 * found work in until its agent is used since; the agent stays this
 * machine's, and its next launch starts afresh.
 *
 * A host that updates itself (`LocalAgentsDependencies.update`,
 * `daemon/host-update.ts`) says on every beat where its update stands, and
 * is handed each answered beat's newer release. Once it holds one checked,
 * the device switches to it as soon as it is idle: no runner runs, no
 * line it claimed waits to be delivered or is being delivered, no request
 * is being answered, and no claim's answer was lost. Its claims of lines
 * and requests stop first, under the lock every line's claim holds, and
 * idle is read again there, so a line claimed meanwhile keeps the device
 * on the release it runs and the switch waits for a later beat; once it
 * switches, the lines and requests it did not claim wait in the service
 * for the daemon started on the new release.
 *
 * Requests are each answered on a fiber of their own, inside the agent's
 * folder alone (`local-agent-requests.ts`). Turning the experiment off,
 * signing out, or a run that sends nothing shuts the gate:
 * the reads end, and every runner is stopped, as the quit stops them.
 */

/** How long the follow rests while the gate is shut, and how often an open gate is read again. */
const IDLE = Duration.seconds(5);
/**
 * How long a device whose setup failed waits before it tries again: the
 * first wait, doubled after each failed try up to the last, and each
 * stretched or shrunk by up to `JITTER`, so devices that failed together
 * do not all try again together.
 */
const SETUP_RETRY = {
  FIRST: Duration.seconds(30),
  LAST: Duration.minutes(15),
  JITTER: 0.2,
} as const;
/** How often a device following its agents beats, which the service's and the window's presence reads are derived from (`DEVICE_BEAT`). */
const BEAT_EVERY = Duration.millis(DEVICE_BEAT.EVERY_MS);
/** How long a discard waits on the platform's check of the worktree before it keeps the folder. */
const UNSAVED_CHECK = Duration.seconds(30);
/** Why a folder is kept where its check could not say what it holds. */
const UNSAVED_UNKNOWN = "its worktree could not be checked for work not saved elsewhere";
/** How a held read the service did not answer is asked again. */
const REREAD = Duration.seconds(2);
/** How many beats in a row a kept launch the service no longer lists must have its settle refused before it is let go of as a line long gone; one only hidden by a stop queued after it is taken well before. */
const GONE_AFTER_REFUSALS = 4;
/** How a claim the service did not answer is asked again, well inside its own claim window. */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;
/** How long a runner's process group has to end after SIGTERM before the group is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);
/** The exit code a launch is settled with where its worktree could not be made or its runner started. */
const NOT_STARTED = 1;
/** How often an agent's GitHub token's age is read off the wall clock, and so how soon one the service did not hand is asked for again, well inside the hour the last one lasts. */
const GITHUB_TOKEN_CHECK = Duration.minutes(1);
/** How often a following device passes over the agents this machine made, letting go of what it keeps of those the service no longer lists. */
const PASS_EVERY = Duration.minutes(5);
/** How long a folder kept for work in it stands after it was first kept, while its agent stays unlisted, before a pass lets go of it whole regardless. */
const KEPT_FOR = Duration.days(7);
/** How many successful reads in a row must leave an agent out before what the device holds of it is let go of. */
const ORPHAN_AFTER = 2;
/** How many agents one pass lets go of at most, so a backlog clears over a few passes rather than in one long one. */
const ORPHANS_PER_PASS = 5;
/** How long an agent goes unused before a pass clears its folder, where it stands idle with all its work on GitHub, so a box that runs agents for weeks does not fill its disk with folders nobody messages again. */
const FOLDER_UNUSED_FOR = Duration.days(7);
/** How many unused folders one pass checks at most before it clears them, so a backlog clears over a few passes rather than in one long one. */
const FOLDER_CHECKS_PER_PASS = 5;
/** What an agent's id is, and so the one name a folder must have to be taken for an agent's. */
const AGENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** How a discard ended: everything removed, the folder kept for work in it, or a step that failed, which a later pass tries again. */
const DISCARD_END = { REMOVED: "removed", KEPT: "kept", FAILED: "failed" } as const;

/** How a pass's clearing of an unused folder ended: removed, kept for work in it, passed over for a use since the pass read it, or a removal that failed. */
const CLEAR_END = {
  REMOVED: "removed",
  KEPT: "kept",
  PASSED_OVER: "passed-over",
  FAILED: "failed",
} as const;

/** What lets an agent go: its discard line, a sweep of it once the service no longer lists it, or a sweep of its folder kept `KEPT_FOR` since, which goes whatever it holds. */
const LET_GO = { LINE: "line", SWEEP: "sweep", KEPT_PAST: "kept-past" } as const;
type LetGo = (typeof LET_GO)[keyof typeof LET_GO];

const VARIABLE = {
  HOME: "HOME",
  SHELL: "SHELL",
  USER: "USER",
  LOGNAME: "LOGNAME",
  LANG: "LANG",
  PATH: "PATH",
} as const;

/** The variables of the developer's own a runner and a command are started with, read from the app's environment; nothing else of Luke's is handed on. */
const HANDED_ON = [VARIABLE.HOME, VARIABLE.SHELL, VARIABLE.USER, VARIABLE.LOGNAME, VARIABLE.LANG];

/** Where a device's setup stands as it registers: nothing once it is ready, else preparing, or failed and why. */
type DeviceSetupRegister = Pick<DeviceAgentDevice, "setup" | "setupFailure">;

/** What a device says of the harnesses signed in on it by itself: none, since its agents run on the sign-ins saved in Luke, never the device's own. */
const NOT_SIGNED_IN: DeviceSignedIn = { claudeCode: false, codex: false };

const decodeLaunch = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);
const decodeStdin = Schema.decodeUnknownOption(deviceAgentStdinPayloadSchema);
const decodeFiles = Schema.decodeUnknownOption(deviceAgentFilesPayloadSchema);

/** The service's side of local agents, as this concern asks it. */
type LocalAgentClient = Pick<
  HostedDeviceAgentClient,
  | "register"
  | "beat"
  | "lines"
  | "claimLine"
  | "settleLine"
  | "requests"
  | "claimRequest"
  | "answerRequest"
  | "githubToken"
  | "liveAgents"
>;

/**
 * A host's update of itself as the follower carries it (`daemon/host-update.ts`):
 * where it stands, which every beat says, each answered beat's release, and
 * the switch the follower runs once the device is idle.
 */
export interface LocalAgentsUpdate {
  /** Where the update stands, as the next beat says it; none while none is under way. */
  readonly beating: Effect.Effect<DeviceAgentUpdate | undefined>;
  /** An answered beat's release, none where it named none. */
  readonly heard: (release: DeviceAgentRelease | undefined) => Effect.Effect<void>;
  /** Whether a release is checked and waits for the device to be idle. */
  readonly waiting: Effect.Effect<boolean>;
  /** The switch to the release that waits, run while the device is idle and claims nothing, the beat given sent once it says it updates; whether it switched, after which the daemon ends. */
  readonly switched: (beat: Effect.Effect<unknown>) => Effect.Effect<boolean>;
}

export interface LocalAgentsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "createId"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** The device id this device enrolled under, where it enrolled one, as a host does; minted once per account and kept otherwise. */
  deviceId?: string | undefined;
  /** Whether the device may ask Luke now, shut while Luke refuses it, read every `IDLE` while the gate is open. */
  switchedOn: Effect.Effect<boolean>;
  client: LocalAgentClient;
  /** The host's update of itself, where it updates itself; none on This Mac and wherever else the device does not. */
  update?: LocalAgentsUpdate | undefined;
}

/** How a launch ended, which its settle carries until the service takes it: its runner's exit code where it exited with one, and why it never started where the device says. */
interface LaunchEnding {
  readonly exitCode?: number | undefined;
  readonly refusal?: DeviceLaunchRefusal | undefined;
}

/** A runner this Mac started: the launch line it settles, its stdin, and the process it is. */
interface Runner {
  readonly lineId: string;
  readonly stdin: Queue.Queue<string>;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  /** The fiber that settles the launch line once the runner exits. */
  readonly exited: Fiber.Fiber<void>;
}

type LocalAgentServices =
  | Environment
  | Reporter
  | LocalAgentPlatform
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient;

export function composeLocalAgents(
  dependencies: LocalAgentsDependencies,
): Effect.Effect<Composer, never, LocalAgentServices> {
  return Effect.gen(function* () {
    const { report } = yield* Reporter;
    const platform = yield* LocalAgentPlatform;
    const services = yield* Effect.context<
      | ChildProcessSpawner.ChildProcessSpawner
      | FileSystem.FileSystem
      | Path.Path
      | HttpClient.HttpClient
    >();
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const environment = yield* Environment;
    const home = yield* Effect.orDie(
      Config.option(Config.String(VARIABLE.HOME)).parse(environment),
    );
    const shell = yield* Effect.orDie(
      Config.withDefault(Config.String(VARIABLE.SHELL), "/bin/zsh").parse(environment),
    );
    const handedOn: Record<string, string> = {};
    for (const name of [...HANDED_ON, VARIABLE.PATH]) {
      const value = yield* Effect.orDie(Config.option(Config.String(name)).parse(environment));
      if (Option.isSome(value)) handedOn[name] = value.value;
    }
    const { kernel, account, switchedOn, client } = dependencies;

    // -- the host's state ----------------------------------------------------

    const readState = readLocalAgentState(kernel.stateRoot);
    const state = yield* Ref.make(yield* readState);
    const writing = yield* Semaphore.make(1);
    /** The state read again from its file, as the other follower left it. */
    const reread = writing.withPermit(Effect.flatMap(readState, (read) => Ref.set(state, read)));

    /**
     * The state changed and written whole, one change at a time, so a write
     * never lands over a newer one; written beside the file and moved over
     * it, so a write cut off leaves the last whole one. A write that cannot
     * land is reported, and the next one tries again. Note that This Mac's
     * turn-on writes the file too (`local-agent-state.ts`), never while this
     * follower follows, so the state is read again whenever this one takes
     * the machine's lease (`reread`).
     */
    const updateState = (change: (current: LocalAgentState) => LocalAgentState) =>
      writing.withPermit(
        Effect.gen(function* () {
          const next = yield* Ref.updateAndGet(state, change);
          yield* writeLocalAgentState(kernel.stateRoot, next);
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => report("the local agents' state could not be saved")),
          ),
        ),
      );

    /** The device id this account registers under on this device: the one it enrolled under, or the one kept for it, minted the first time. */
    const deviceOf = (userId: string) =>
      dependencies.deviceId !== undefined
        ? Effect.succeed(dependencies.deviceId)
        : writing.withPermit(
            Effect.tap(localAgentDeviceOf(kernel.stateRoot, userId, kernel.createId), () =>
              Effect.flatMap(readState, (read) => Ref.set(state, read)),
            ),
          );

    const keepLaunch = (userId: string, id: string, agentId: string) =>
      updateState((current) => ({
        ...current,
        launches: [...current.launches, { userId, id, agentId }],
      }));

    /**
     * How the agent has run on this device: as kept, or, for one launched
     * before the record on a device whose agents may have run directly on it
     * (`formerlyDirect`), directly, where its checkout stands, since every
     * such agent did. None for an agent never launched here, and on a device
     * whose agents never ran so.
     */
    const ranAs = (agentId: string, checkoutPath: string) =>
      Effect.gen(function* () {
        if (!platform.formerlyDirect) return Option.none<DeviceIsolation>();
        const kept = (yield* Ref.get(state)).modes?.[agentId];
        if (kept !== undefined) return Option.some(kept);
        const stands = yield* Effect.orElseSucceed(fileSystem.exists(checkoutPath), () => false);
        return stands ? Option.some<DeviceIsolation>(DEVICE_ISOLATION.BARE) : Option.none();
      });

    const keepMode = (agentId: string, mode: DeviceIsolation) =>
      updateState((current) => ({ ...current, modes: { ...current.modes, [agentId]: mode } }));

    const forgetMode = (agentId: string) =>
      updateState((current) => ({
        ...current,
        modes: Object.fromEntries(
          Object.entries(current.modes ?? {}).filter(([kept]) => kept !== agentId),
        ),
      }));

    const forgetLaunch = (id: string) =>
      Effect.gen(function* () {
        if (!(yield* Ref.get(state)).launches.some((launch) => launch.id === id)) return;
        yield* updateState((current) => ({
          ...current,
          launches: current.launches.filter((launch) => launch.id !== id),
        }));
      });

    /**
     * The agent stamped as used now, by a launch, a turn's end, or files
     * written, which a pass reads to clear its folder once it goes unused
     * for `FOLDER_UNUSED_FOR`. Note that the stamp is whole milliseconds,
     * because the state holds no fraction of one and a clock may read one.
     */
    const usedNow = (agentId: string) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        updateState((current) => ({
          ...current,
          lastUsed: { ...current.lastUsed, [agentId]: Math.floor(at) },
        })),
      );

    /** The agent's stamp of its last use let go of, as its folder goes. */
    const usedForgotten = (agentId: string) =>
      Effect.gen(function* () {
        if ((yield* Ref.get(state)).lastUsed?.[agentId] === undefined) return;
        yield* updateState(({ lastUsed, ...current }) => ({
          ...current,
          lastUsed: Object.fromEntries(
            Object.entries(lastUsed ?? {}).filter(([id]) => id !== agentId),
          ),
        }));
      });

    /** Whether the agent's folder under the home folder given stands. */
    const folderStands = (folder: string, agentId: string) =>
      Effect.orElseSucceed(
        fileSystem.exists(deviceAgentLayout(folder, agentId).folder),
        () => false,
      );

    /** When the agent was last used here, by its stamp, where its folder under the home folder given stands; none where its folder stands no more, or it has no stamp. */
    const usedAt = (folder: string, agentId: string) =>
      Effect.gen(function* () {
        const stamped = (yield* Ref.get(state)).lastUsed?.[agentId];
        if (stamped === undefined || !(yield* folderStands(folder, agentId))) {
          return Option.none<number>();
        }
        return Option.some(stamped);
      });

    /**
     * Every agent this machine made whose folder under the home folder given
     * stands with no stamp of its use, from before the stamp, stamped as
     * used as the gate opens, so a pass clears none of theirs until
     * `FOLDER_UNUSED_FOR` after the first start that stamps.
     */
    const unstampedStamped = (folder: string) =>
      Effect.gen(function* () {
        const now = Math.floor(yield* Clock.currentTimeMillis);
        const found: Record<string, number> = {};
        for (const agentId of yield* ownedAgents(kernel.stateRoot)) {
          if (!AGENT_UUID.test(agentId)) continue;
          if ((yield* Ref.get(state)).lastUsed?.[agentId] !== undefined) continue;
          if (yield* folderStands(folder, agentId)) found[agentId] = now;
        }
        if (Object.keys(found).length === 0) return;
        yield* updateState((current) => ({
          ...current,
          lastUsed: { ...found, ...current.lastUsed },
        }));
      });

    /**
     * Every agent this install's own state names kept as one whose folder
     * it made (`keepOwnedAgent`), under the home folder given, so an agent
     * it last ran before it kept that record is let go of as the rest are:
     * each its `modes` names, which This Mac and a Mac's own `luke-host`
     * each keep in their own state, and each of a launch it kept; and, on a
     * device whose agents' folders are its own alone (`storesOwned`), each
     * with a folder there.
     * Note that a Mac's are shared with another Luke install, so nothing
     * there is taken as this one's. Keeping one kept already changes
     * nothing.
     */
    const adopted = (folder: string) =>
      Effect.gen(function* () {
        const { modes, launches } = yield* Ref.get(state);
        const named = [
          ...Object.keys(modes ?? {}),
          ...launches.flatMap((launch) => launch.agentId ?? []),
        ];
        const stored = platform.storesOwned ? yield* storedAgents(folder) : [];
        for (const agentId of new Set([...named, ...stored])) {
          if (AGENT_UUID.test(agentId)) yield* keepOwnedAgent(kernel.stateRoot, agentId);
        }
      });

    /** The agents with a folder under the home folder given, by id; none where they could not be listed. */
    const storedAgents = (folder: string) =>
      Effect.orElseSucceed(
        fileSystem.readDirectory(path.join(folder, DEVICE_AGENT_FOLDER.ROOT)),
        (): readonly string[] => [],
      );

    // -- a turn's end ------------------------------------------------------------

    /**
     * The agent's `tmp` emptied, where its folder stands: taken away whole
     * and made again rather than emptied entry by entry, since a link the
     * agent left there would lead a walk out of its folder, and a removal
     * takes a link away without following it.
     */
    const tempEmptied = (layout: DeviceAgentLayout) =>
      Effect.gen(function* () {
        if (!(yield* fileSystem.exists(layout.folder))) return;
        yield* fileSystem.remove(layout.temp, { recursive: true, force: true });
        yield* fileSystem.makeDirectory(layout.temp, { recursive: true, mode: 0o700 });
      }).pipe(Effect.ignore);

    /**
     * The end of one of the agent's turns, whatever ended it, a run that
     * died with the app or the gate among it: its GitHub token let go of,
     * since no turn reads it any more, and its `tmp` emptied; the rest of
     * its folder, its repository, home and caches, stays for its next turn.
     */
    const turnLetGo = (layout: DeviceAgentLayout) =>
      Effect.gen(function* () {
        yield* agentGithubForgotten(layout.folder);
        yield* tempEmptied(layout);
      });

    // -- the gate --------------------------------------------------------------

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    /** Whether this device runs local agents now: an account signed in, a run that sends, a home folder, and its switch on. */
    const gateOpen = Effect.map(
      switchedOn,
      (on) =>
        on && Option.isSome(home) && kernel.runMode.sendsNetwork && account.capabilitiesActive(),
    );

    /** A beat, saying where the host's update stands while one is under way. */
    const beatOf = (deviceId: string) =>
      Effect.flatMap(dependencies.update?.beating ?? Effect.succeed(undefined), (updating) =>
        asked(client.beat(deviceId, NOT_SIGNED_IN, updating)),
      );

    /**
     * The beats, each `beaten` (a beat alone, or a follow's beat and what it
     * converges to its answer), for as long as the gate stands and the
     * account signed in is the one `userId` names; it returns once either
     * changes.
     */
    const presence = (
      userId: string,
      deviceId: string,
      beaten: Effect.Effect<unknown> = beatOf(deviceId),
    ) =>
      Effect.gen(function* () {
        let sinceBeat = Duration.toMillis(BEAT_EVERY);
        while ((yield* gateOpen) && dependencies.accountId() === userId) {
          if (sinceBeat >= Duration.toMillis(BEAT_EVERY)) {
            yield* beaten;
            sinceBeat = 0;
          }
          yield* Effect.sleep(IDLE);
          sinceBeat += Duration.toMillis(IDLE);
        }
      });

    // -- what the agents run on --------------------------------------------------

    /** How long a device waits after its `failed`th failed setup in a row before it tries again (`SETUP_RETRY`). */
    const setupRetryAfter = (failed: number) =>
      Effect.map(Random.nextBetween(1 - SETUP_RETRY.JITTER, 1 + SETUP_RETRY.JITTER), (stretch) =>
        Duration.millis(
          Math.min(
            Duration.toMillis(SETUP_RETRY.FIRST) * 2 ** (failed - 1),
            Duration.toMillis(SETUP_RETRY.LAST),
          ) * stretch,
        ),
      );

    /**
     * Whether the device has its agents' CLIs (`LocalAgentClis.ready`),
     * asked each time the gate opens, and after a try that failed asked
     * again once `setupRetryAfter` has passed, one try at a time, for as
     * long as the gate stands and the account is the one `userId` names; it
     * answers false only once either changes. As the first fetch begins
     * (`preparing`) the device registers as preparing and beats, so
     * the menus list it as getting ready rather than not at all; a try that
     * failed registers why and beats while it waits for the next, so it is
     * listed as not set up rather than away. `registered` registers the
     * device with where its setup stands, a register the service may refuse
     * from a build before the field; then the device beats nothing until it
     * registers ready, since a beat would keep fresh the ready row it
     * registered before, and that service would take an agent on it.
     */
    const readyForOpening = (
      userId: string,
      deviceId: string,
      registered: (
        setup: DeviceSetupRegister,
      ) => Effect.Effect<boolean, never, HttpClient.HttpClient>,
    ) =>
      Effect.gen(function* () {
        for (let failed = 1; ; failed += 1) {
          const ready = yield* Effect.scoped(
            Effect.gen(function* () {
              const scope = yield* Effect.scope;
              // Note that it beats only once the service took the setup, since a beat after a refused register keeps an earlier ready row fresh.
              const preparing = Effect.gen(function* () {
                if (yield* asked(registered({ setup: DEVICE_SETUP.PREPARING }))) {
                  yield* Effect.forkIn(presence(userId, deviceId), scope);
                }
              });
              return yield* Effect.result(platform.clis.ready(preparing));
            }),
          );
          if (Result.isSuccess(ready)) return true;
          report(`the local agents' setup failed: ${ready.failure.detail}`);
          const listed = yield* asked(
            registered({ setup: DEVICE_SETUP.FAILED, setupFailure: ready.failure.detail }),
          );
          // Note that the device stays listed with why while it waits, beating only where the service took that, and the wait ends early as the gate shuts.
          const waited = yield* Effect.race(
            Effect.as(presence(userId, deviceId, listed ? undefined : Effect.void), false),
            Effect.as(Effect.sleep(yield* setupRetryAfter(failed)), true),
          );
          if (!waited) return false;
        }
      });

    // -- the developer's own environment ---------------------------------------------

    /** The login shell's PATH, which a runner started from the Dock would otherwise go without. */
    const loginPath = Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* ChildProcess.make(shell, ["-l", "-c", 'printf %s "$PATH"'], {
          stdin: "ignore",
        });
        const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
        yield* handle.exitCode;
        return printed;
      }),
    ).pipe(
      Effect.timeoutOption(Duration.seconds(10)),
      Effect.map(Option.filter((printed) => printed.length > 0)),
      Effect.orElseSucceed(() => Option.none<string>()),
    );

    /**
     * What a runner and a command are started with of the device's own: the
     * developer's identity and shell, and their login shell's PATH, which
     * the agent's commands and the repository's script find git on, read once
     * each time the gate opens; never the rest of the app's environment,
     * which is Luke's and none of the agent's.
     */
    const shellEnvironment = Effect.map(
      loginPath,
      (loginShellPath): Readonly<Record<string, string>> => ({
        ...handedOn,
        ...Option.match(loginShellPath, {
          onNone: () => ({}),
          onSome: (value) => ({ [VARIABLE.PATH]: value }),
        }),
      }),
    );

    // -- one account's follow --------------------------------------------------

    /** Everything one open gate runs for the account `userId` names, on the device it registered, from its home folder. */
    const follow = (
      userId: string,
      deviceId: string,
      folder: string,
      shellVariables: Readonly<Record<string, string>>,
    ) =>
      Effect.gen(function* () {
        const workers = yield* FiberMap.make<string>();
        const mailboxes = new Map<string, Queue.Queue<DeviceAgentClaimedLine>>();
        const runners = new Map<string, Runner>();
        /** The launch lines claimed and handed to their agents whose runners are not yet running or settled unstarted, which no beat settles. */
        const starting = new Set<string>();
        /** How each launch whose settle the service has not taken yet ended, by its line's id. */
        const endings = new Map<string, LaunchEnding>();
        /** Held by each claim and by a beat's settle of a launch the device never kept, so neither runs while the other is unanswered. */
        const claiming = yield* Semaphore.make(1);
        /** The runners a beat stops, since the service no longer holds the device to their launches. */
        const stopping = yield* FiberSet.make();
        /** Held by an agent's worker while it delivers a line of the agent's, and by a pass letting go of the agent, so neither runs under the other. */
        const deliveryLocks = new Map<string, Semaphore.Semaphore>();
        /** Done once a beat of this follow is answered, after which the device passes over its agents (`swept`). */
        const beaten = yield* Deferred.make<void>();
        /** Whether no line or request is claimed, set under `claiming` once the device switches to a newer release, so they wait in the service for the daemon started on it. */
        let paused = false;
        /** How many lines were handed to their agents' workers and are not yet delivered, each counted from its hand-over until its worker is done with it. */
        let undelivered = 0;

        const answering = yield* FiberSet.make();

        const settle = (id: string, exitCode?: number, refusal?: DeviceLaunchRefusal) =>
          asked(client.settleLine(deviceId, id, exitCode, refusal));

        /**
         * A kept launch settled with how it ended, asked once; let go of
         * where the service took it, and otherwise left kept, which every
         * beat settles again (`reconciledBeat`).
         */
        const settledLaunch = (id: string, ending: LaunchEnding) =>
          Effect.gen(function* () {
            endings.set(id, ending);
            if (!(yield* settle(id, ending.exitCode, ending.refusal))) return;
            endings.delete(id);
            yield* forgetLaunch(id);
          });

        /** A launch whose runner never started, kept and settled as not started, naming why where the device says. */
        const notStarted = (agentId: string, id: string, refusal?: DeviceLaunchRefusal) =>
          Effect.gen(function* () {
            yield* keepLaunch(userId, id, agentId);
            yield* settledLaunch(id, { exitCode: NOT_STARTED, refusal });
          });

        /**
         * The agent's own repository made where it has none, reading the
         * agent's GitHub token where it has one through gh's helper, never
         * the token itself: a folder for an agent with no repository.
         */
        const madeWorktree = (
          layout: DeviceAgentLayout,
          repository: string | null,
          branch: string | null,
          github: Readonly<Record<string, string>> | undefined,
        ) =>
          Effect.gen(function* () {
            if (yield* fileSystem.exists(path.join(layout.checkoutPath, ".git"))) return true;
            if (repository === null) {
              yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });
              return true;
            }
            const script = platform.worktreeScript({
              home: folder,
              repository,
              worktree: layout.checkoutPath,
              branch,
            });
            const code = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make("/bin/bash", ["-c", script], {
                  cwd: folder,
                  ...(github === undefined ? undefined : { env: { ...github }, extendEnv: true }),
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                }),
                (handle) => handle.exitCode,
              ),
            );
            return Number(code) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        /**
         * Who the agent's commits are by, as the service settled it, set in
         * its own repository's config by the step a cloud checkout sets it
         * with (`CHECKOUT_IDENTITY_SCRIPT`), where the line names one, and
         * gh's credential helper beside it (`AGENT_GIT_HELPER_SCRIPT`), so
         * the repository's every `git` reads the token gh's config holds;
         * whether both were. Note that it runs as the agent, in its
         * repository with its home and caches in its folder, never as the
         * device's own git, which a repository the agent rigged could steer;
         * and on every launch, since a repository made before the launch line
         * carried an identity holds none.
         */
        const checkoutSet = (layout: DeviceAgentLayout, identity: CheckoutIdentity | undefined) => {
          const script = [
            ...(identity === undefined ? [] : [CHECKOUT_IDENTITY_SCRIPT]),
            AGENT_GIT_HELPER_SCRIPT,
          ].join("\n");
          const env = {
            ...shellVariables,
            ...(identity === undefined ? {} : checkoutIdentityEnv(identity)),
            ...agentGitHelperEnv(platform.clis.paths.gh),
          };
          const run = agentOnBox(
            { folder: layout.folder, command: "/bin/bash", args: ["-c", script], env },
            platform.clis.paths.gh,
          );
          return Effect.scoped(
            Effect.flatMap(
              ChildProcess.make(run.command, [...run.args], {
                cwd: layout.checkoutPath,
                env: run.env,
                extendEnv: false,
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
                forceKillAfter: KILL_GRACE,
              }),
              (handle) => handle.exitCode,
            ),
          ).pipe(
            Effect.map((code) => Number(code) === 0),
            Effect.orElseSucceed(() => false),
          );
        };

        /**
         * A fresh token for the agent's repository from the service, written
         * into gh's config in the agent's home, which its `gh` and `git` read
         * on every call (`agentGithubWritten`); whether it was. A token
         * refused or unanswered is reported in those words alone.
         */
        const gaveGithubToken = (agentId: string) =>
          Effect.gen(function* () {
            const token = yield* asked(client.githubToken(agentId));
            if (token === undefined) return false;
            yield* agentGithubWritten(deviceAgentLayout(folder, agentId).folder, token);
            return true;
          }).pipe(
            Effect.orElseSucceed(() => false),
            Effect.tap((had) =>
              had
                ? Effect.void
                : Effect.sync(() => report("a local agent's GitHub token was not had")),
            ),
          );

        /**
         * The agent's GitHub token renewed once the last one had is
         * `GITHUB_TOKEN_REFRESH` old, or a minute after one that was not had,
         * for as long as it runs. Note that its age is read off the wall
         * clock every `GITHUB_TOKEN_CHECK`, never waited out in one sleep,
         * because a machine asleep stretches a wait but not the token's hour.
         */
        const renewingGithub = (
          agentId: string,
          had: boolean,
        ): Effect.Effect<never, never, FileSystem.FileSystem> =>
          Effect.gen(function* () {
            let hadAt = had ? yield* Clock.currentTimeMillis : undefined;
            for (;;) {
              yield* Effect.sleep(GITHUB_TOKEN_CHECK);
              const now = yield* Clock.currentTimeMillis;
              if (hadAt !== undefined && now - hadAt < Duration.toMillis(GITHUB_TOKEN_REFRESH)) {
                continue;
              }
              if (yield* gaveGithubToken(agentId)) hadAt = now;
            }
          });

        /** Whether the agent's work stands in its folder: its repository, or its checkout folder for an agent with none. */
        const workExists = (layout: DeviceAgentLayout, withRepository: boolean) =>
          Effect.orElseSucceed(
            fileSystem.exists(
              withRepository ? path.join(layout.checkoutPath, ".git") : layout.checkoutPath,
            ),
            () => false,
          );

        /**
         * The runner started for a launch line, its first lines written, and
         * its exit settling the line; the line settled as not started where it
         * cannot be. A launch that finds none of the agent's work in its
         * folder (`workExists`), which was cleared since its last turn, and
         * would continue a harness's session, lets that session go and starts
         * the agent afresh from a repository made anew, telling it so ahead of
         * its first message (`LAUNCH_NOTE.CLEARED`).
         */
        const launched = (
          agentId: string,
          line: DeviceAgentLine,
          secrets: DeviceAgentLaunchSecrets | undefined,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const layout = deviceAgentLayout(folder, agentId);
            const payload = decodeLaunch(line.payload);
            // Note that a launch naming a worktree outside the agent's own folder is never made.
            if (
              Option.isNone(payload) ||
              secrets === undefined ||
              payload.value.checkoutPath !== layout.checkoutPath
            ) {
              return yield* notStarted(agentId, line.id);
            }
            const withRepository = payload.value.repository !== null;
            // Note that an agent that ran on the developer's own logins on the Mac keeps its Git folder in the shared clone and its harness's sessions in the developer's own home, so it never starts again.
            const ran = yield* ranAs(agentId, layout.checkoutPath);
            if (Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.BARE)) {
              report(
                "a local agent that ran on the developer's own logins on this Mac was not started, since its work is outside a folder of its own",
              );
              return yield* notStarted(agentId, line.id, DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY);
            }
            if (platform.formerlyDirect && Option.isNone(ran)) {
              yield* keepMode(agentId, platform.deviceIsolation);
            }
            // Note that the agent is kept as this machine's before its folder is made, so an uninstall finds whatever a launch cut off left.
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            yield* usedNow(agentId);
            const cleared =
              sessionResumed(secrets.stdin) && !(yield* workExists(layout, withRepository));
            if (cleared) {
              report("a local agent's folder was cleared since its last turn, so it starts afresh");
            }
            // Note that the token is had before the repository is made, since the clone reads it too, through gh's helper.
            const hadToken = withRepository && (yield* gaveGithubToken(agentId));
            const made = yield* madeWorktree(
              layout,
              payload.value.repository,
              payload.value.startBranch,
              withRepository ? agentGithubEnv(layout.folder, platform.clis.paths.gh) : undefined,
            );
            if (!made) {
              // Note that the token was written before the repository was made, and no turn reads it where none starts.
              yield* agentGithubForgotten(layout.folder);
              return yield* notStarted(agentId, line.id);
            }
            const temp = layout.temp;
            yield* Effect.ignore(fileSystem.makeDirectory(temp, { recursive: true, mode: 0o700 }));
            const runnerScope = yield* Scope.fork(agentScope);
            // Note that the turn is let go of last as the runner's scope closes, once the runner has ended, and the agent stamped as used.
            const refused = yield* Scope.addFinalizer(
              runnerScope,
              Effect.provideContext(Effect.andThen(turnLetGo(layout), usedNow(agentId)), services),
            ).pipe(
              Effect.andThen(agentFoldersMade(layout.folder)),
              Effect.as(Option.none<string>()),
              Effect.orElseSucceed(() => Option.some("the agent's folders could not be made")),
            );
            if (Option.isSome(refused)) {
              yield* Scope.close(runnerScope, Exit.void);
              report(`a local agent could not be readied to start: ${refused.value}`);
              return yield* notStarted(agentId, line.id);
            }
            if (withRepository && !(yield* checkoutSet(layout, payload.value.identity))) {
              yield* Scope.close(runnerScope, Exit.void);
              report(
                "a local agent's commit identity or GitHub helper could not be set in its repository",
              );
              return yield* notStarted(agentId, line.id);
            }
            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            const command = platform.launch({
              agentId,
              folder: layout.folder,
              checkout: layout.checkoutPath,
              node: platform.tools.node,
              bundle: platform.runnerBundle,
              env: { ...shellVariables, TMPDIR: temp, ...platform.runnerEnv, ...secrets.env },
            });
            const started = yield* ChildProcess.make(command.command, [...command.args], {
              cwd: layout.checkoutPath,
              env: command.env,
              extendEnv: false,
              // Note that stdin stays open past the first lines, since every later line of the agent's is written to it.
              stdin: {
                stream: Stream.fromQueue(stdin).pipe(Stream.map((text) => encoder.encode(text))),
                endOnDone: false,
              },
              // Note that nothing the runner prints is kept, since a credential must never reach a log.
              stdout: "ignore",
              stderr: "ignore",
              forceKillAfter: KILL_GRACE,
            }).pipe(Scope.provide(runnerScope), Effect.option);
            if (Option.isNone(started)) {
              yield* Scope.close(runnerScope, Exit.void);
              return yield* notStarted(agentId, line.id);
            }
            const handle = started.value;
            if (withRepository)
              yield* Effect.forkIn(renewingGithub(agentId, hadToken), runnerScope);
            yield* keepLaunch(userId, line.id, agentId);
            yield* Queue.offer(
              stdin,
              notedFirstLines(secrets.stdin, cleared ? [LAUNCH_NOTE.CLEARED] : [], cleared),
            );
            // Note that the launch is forgotten only once the service took its settle, which every
            // beat asks again where it did not, so one an outage left unsettled is settled once it ends.
            const exited = yield* Effect.gen(function* () {
              const code = yield* Effect.option(handle.exitCode);
              const ending = { exitCode: Option.getOrUndefined(Option.map(code, Number)) };
              // Note that how it ended is kept before the runner is let go of, so a beat that settles it first carries its exit code.
              endings.set(line.id, ending);
              runners.delete(agentId);
              // Note that the launch is starting again while its scope closes, so no beat settles it before its turn is let go of.
              starting.add(line.id);
              yield* Scope.close(runnerScope, Exit.void).pipe(
                Effect.ensuring(Effect.sync(() => starting.delete(line.id))),
              );
              yield* settledLaunch(line.id, ending);
            }).pipe(Effect.forkIn(agentScope));
            runners.set(agentId, { lineId: line.id, stdin, handle, exited });
          });

        /**
         * Why the agent's folder holds work a discard would lose, as the
         * platform's check says it, run on the box; none where the platform
         * names no check or the check finds nothing. A check that fails,
         * outlasts `UNSAVED_CHECK`, or cannot start is taken as work, since
         * the folder may hold the only copy.
         */
        const unsavedWork = (layout: DeviceAgentLayout) =>
          Effect.gen(function* () {
            if (platform.unsavedWorkScript === undefined) return Option.none<string>();
            const script = platform.unsavedWorkScript({ worktree: layout.checkoutPath });
            return yield* Effect.scoped(
              Effect.gen(function* () {
                const handle = yield* ChildProcess.make("/bin/bash", ["-c", script], {
                  cwd: folder,
                  stdin: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                });
                const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
                if (Number(yield* handle.exitCode) !== 0) return Option.some(UNSAVED_UNKNOWN);
                const reason = printed.trim().split("\n")[0] ?? "";
                return reason.length > 0 ? Option.some(reason) : Option.none<string>();
              }),
            ).pipe(
              Effect.timeoutOption(UNSAVED_CHECK),
              Effect.map(Option.getOrElse(() => Option.some(UNSAVED_UNKNOWN))),
            );
          }).pipe(Effect.orElseSucceed(() => Option.some(UNSAVED_UNKNOWN)));

        /**
         * The runner given stopped and its exit waited for, so its line is
         * settled first. Its process group alone is asked to end (SIGTERM)
         * and killed once `KILL_GRACE` has passed, so nothing of the host's or
         * of another agent's is stopped with it. Its turn is let go of once it
         * has ended.
         */
        const ended = (runner: Runner) =>
          Effect.gen(function* () {
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        /** The agent's runner, where one runs, stopped and its exit waited for (`ended`). */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            yield* ended(runner);
          });

        /**
         * The agent let go of: its runner stopped and its exit settled, and
         * its folder removed with everything in it, its worktree and what its
         * runner and commands
         * wrote there; the shared clone the worktree was made from stays, and
         * the next worktree made of it prunes this one's record. A folder
         * that stands no more holds nothing to lose and goes at once, as does
         * one kept `KEPT_FOR` since (`LET_GO.KEPT_PAST`). Otherwise a device
         * whose platform names a check of the worktree keeps the folder, and
         * says why, where the check finds work in it that is nowhere else, or
         * cannot say, and records it kept, with when it first was, so no
         * later pass checks it again (`swept`). A step that fails is
         * reported, and tried again by a later pass, since the agent still
         * holds something here.
         */
        const discarded = (agentId: string, by: LetGo) =>
          Effect.gen(function* () {
            yield* stopped(agentId);
            const layout = deviceAgentLayout(folder, agentId);
            const stands = yield* Effect.orElseSucceed(
              fileSystem.exists(layout.folder),
              () => false,
            );
            const unsaved =
              !stands || by === LET_GO.KEPT_PAST
                ? Option.none<string>()
                : yield* unsavedWork(layout);
            if (Option.isSome(unsaved)) {
              report(`a local agent's folder was kept, since ${unsaved.value}: ${agentId}`);
              const at = yield* Clock.currentTimeMillis;
              yield* updateState((current) => ({
                ...current,
                kept: { ...current.kept, [agentId]: current.kept?.[agentId] ?? at },
              }));
              return DISCARD_END.KEPT;
            }
            yield* fileSystem.remove(layout.folder, { recursive: true, force: true });
            yield* usedForgotten(agentId);
            yield* forgetOwnedAgent(kernel.stateRoot, agentId);
            // Note that a folder kept keeps its record too, so the agent, launched again, runs the way it ran.
            if ((yield* Ref.get(state)).modes?.[agentId] !== undefined) yield* forgetMode(agentId);
            if ((yield* Ref.get(state)).kept?.[agentId] !== undefined) {
              yield* updateState(({ kept, ...current }) => ({
                ...current,
                kept: Object.fromEntries(
                  Object.entries(kept ?? {}).filter(([id]) => id !== agentId),
                ),
              }));
            }
            return DISCARD_END.REMOVED;
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                report(`a local agent's folder could not be removed: ${agentId}`);
                return DISCARD_END.FAILED;
              }),
            ),
          );

        /** A files line's files written under the agent's folder, each at its mode; one outside the folder is never written. */
        const wroteFiles = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const files = decodeFiles(payload);
            if (Option.isNone(files)) return;
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            // Note that files a later line names use the agent's folder already, so no pass clears it before that line.
            yield* usedNow(agentId);
            const layout = deviceAgentLayout(folder, agentId);
            for (const file of files.value.files) {
              const target = path.normalize(file.path);
              if (!target.startsWith(`${layout.folder}/`)) continue;
              const parent = path.dirname(target);
              yield* fileSystem.makeDirectory(parent, { recursive: true, mode: 0o700 });
              const real = yield* fileSystem.realPath(parent);
              const root = yield* fileSystem.realPath(layout.folder);
              if (real !== root && !real.startsWith(`${root}/`)) continue;
              const written = path.join(real, path.basename(target));
              // Note that whatever stands at the path is taken away first and the file made anew,
              // never written through, since a symlink the agent left there could point anywhere.
              yield* fileSystem.remove(written, { force: true });
              yield* fileSystem.writeFile(written, file.contents, { flag: "wx", mode: file.mode });
              yield* fileSystem.chmod(written, file.mode);
            }
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report("a local agent's files could not be written")),
            ),
          );

        /**
         * One line of the agent's, delivered: a runner started, written to,
         * or stopped, files written, or the agent let go of; every line but a
         * launch settled at once. A kind this follower does not know, one a
         * newer service added, is settled without being acted on, so it never
         * holds back the agent's later lines.
         */
        const delivered = (
          agentId: string,
          claimed: DeviceAgentClaimedLine,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const { line } = claimed;
            switch (line.kind) {
              case DEVICE_AGENT_LINE_KIND.LAUNCH:
                // Note that a launch replaces the runner it finds, which is ended and its line settled first.
                // It is starting until its runner runs or it is settled unstarted, so no beat settles it meanwhile.
                return yield* Effect.gen(function* () {
                  yield* stopped(agentId);
                  // Note that a launch whose claim was asked again lost its secrets with the first answer, so it is settled as a runner gone, which ends its turn in words.
                  if (claimed.secretsGone === true) return yield* settle(line.id);
                  return yield* launched(agentId, line, claimed.secrets, agentScope);
                }).pipe(Effect.ensuring(Effect.sync(() => starting.delete(line.id))));
              case DEVICE_AGENT_LINE_KIND.MESSAGE:
              case DEVICE_AGENT_LINE_KIND.RETUNE: {
                const text = decodeStdin(line.payload);
                const runner = runners.get(agentId);
                if (Option.isSome(text) && runner !== undefined) {
                  yield* Queue.offer(runner.stdin, text.value.text);
                }
                break;
              }
              case DEVICE_AGENT_LINE_KIND.FILES:
                yield* wroteFiles(agentId, line.payload);
                break;
              case DEVICE_AGENT_LINE_KIND.STOP:
                yield* stopped(agentId);
                break;
              case DEVICE_AGENT_LINE_KIND.DISCARD:
                yield* discarded(agentId, LET_GO.LINE);
                break;
            }
            yield* settle(line.id);
          });

        /** A claimed line handed to its agent's worker, a launch marked starting first, so no beat settles it before its runner runs. */
        const handedOver = (claimed: DeviceAgentClaimedLine) =>
          Effect.gen(function* () {
            if (claimed.line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH) starting.add(claimed.line.id);
            undelivered += 1;
            yield* Queue.offer(yield* mailboxOf(claimed.line.agentId), claimed);
          });

        /** The lock an agent's line is delivered under, one per agent (`deliveryLocks`). */
        const deliveryLockOf = (agentId: string) => {
          const kept = deliveryLocks.get(agentId);
          if (kept !== undefined) return kept;
          const made = Semaphore.makeUnsafe(1);
          deliveryLocks.set(agentId, made);
          return made;
        };

        /** The agent's mailbox, its worker started the first time a line of its arrives. */
        const mailboxOf = (agentId: string) =>
          Effect.gen(function* () {
            const kept = mailboxes.get(agentId);
            if (kept !== undefined) return kept;
            const mailbox = yield* Queue.unbounded<DeviceAgentClaimedLine>();
            mailboxes.set(agentId, mailbox);
            const worker = Effect.scoped(
              Effect.gen(function* () {
                const agentScope = yield* Effect.scope;
                for (;;) {
                  const claimed = yield* Queue.take(mailbox);
                  yield* deliveryLockOf(agentId)
                    .withPermit(delivered(agentId, claimed, agentScope))
                    .pipe(Effect.ensuring(Effect.sync(() => void (undelivered -= 1))));
                }
              }),
            );
            yield* FiberMap.run(workers, agentId, worker);
            return mailbox;
          });

        /**
         * The token each line's claim carries, by the line's id, minted at its
         * first claim and kept until a claim of it is answered, so the claim
         * asked again after its answer was lost is the same claim, which the
         * service answers again rather than refusing as taken.
         */
        const claimTokens = new Map<string, string>();

        /** One line claimed by its id under its token, asked again a few times where unanswered; refused, or nothing where never answered. */
        const claimedLine = (id: string) =>
          Effect.gen(function* () {
            const token = claimTokens.get(id) ?? kernel.createId();
            claimTokens.set(id, token);
            const answer = yield* asked(client.claimLine(deviceId, id, token)).pipe(
              Effect.repeat({
                schedule: Schedule.spaced(CLAIM_RETRY.every),
                times: CLAIM_RETRY.times,
                until: (answered) => answered !== undefined,
              }),
            );
            if (answer !== undefined) claimTokens.delete(id);
            return answer;
          });

        /**
         * One line claimed and, where granted, handed to its agent's mailbox;
         * whether the claim was answered. Note that the claim and its
         * hand-over are uninterruptible, because a line the service granted
         * is this Mac's alone to deliver, and its token is let go of in the
         * same step, so no line is handed over twice. Both hold `claiming`,
         * so a beat never settles a launch whose claim is unanswered; none is
         * asked once the device has paused its claims to switch releases.
         */
        const lineTaken = (id: string) =>
          Effect.uninterruptible(
            claiming.withPermit(
              Effect.gen(function* () {
                if (paused) return false;
                const answer = yield* claimedLine(id);
                if (answer === undefined) return false;
                if ("line" in answer) yield* handedOver(answer);
                return true;
              }),
            ),
          );

        /**
         * The lines read and claimed in the service's order, each handed to
         * its agent's mailbox. A claim never answered ends the batch there,
         * so a later line of the same agent is never delivered before it, and
         * is asked again under its token before the next read, since the
         * service lists no line once claimed and the claim may have landed.
         */
        const linesFollowed = Effect.forever(
          Effect.gen(function* () {
            if (paused) return yield* Effect.sleep(REREAD);
            for (const id of [...claimTokens.keys()]) {
              if (!(yield* lineTaken(id))) return yield* Effect.sleep(REREAD);
            }
            const lines = yield* asked(client.lines(deviceId));
            if (lines === undefined) return yield* Effect.sleep(REREAD);
            for (const line of lines) {
              if (!(yield* lineTaken(line.id))) return;
            }
          }),
        );

        /** One request claimed and answered on a fiber of its own. */
        const answered = (request: DeviceAgentRequest) =>
          Effect.gen(function* () {
            if (paused) return;
            const claimed = yield* asked(client.claimRequest(deviceId, request.id)).pipe(
              Effect.repeat({
                schedule: Schedule.spaced(CLAIM_RETRY.every),
                times: CLAIM_RETRY.times,
                until: (answer) => answer !== undefined,
              }),
            );
            if (claimed === undefined || !("agentId" in claimed)) return;
            const layout = deviceAgentLayout(folder, claimed.agentId);
            const answer = yield* answeredLocalAgentRequest(layout, claimed).pipe(
              Effect.provideContext(services),
            );
            yield* asked(client.answerRequest(deviceId, claimed.id, answer));
          });

        /** The requests read, each answered on its own fiber, so a slow read holds up neither the reads nor the others. */
        const requestsFollowed = Effect.forever(
          Effect.gen(function* () {
            if (paused) return yield* Effect.sleep(REREAD);
            const requests = yield* asked(client.requests(deviceId));
            if (requests === undefined) return yield* Effect.sleep(REREAD);
            for (const request of requests) yield* FiberSet.run(answering, answered(request));
          }),
        );

        /** The launch lines of the runners running now. */
        const runningLaunches = () => new Set([...runners.values()].map((runner) => runner.lineId));

        /**
         * Every kept launch of the account's whose runner ended, settled
         * again with how it ended; let go of where the service took it, or
         * where its answer (`open`) no longer holds the device to it, since a
         * line long settled may be gone and refuse every settle.
         */
        /** The beats in a row each kept launch the service no longer listed had its settle refused on, by line id. */
        const refusedUnlisted = new Map<string, number>();

        /**
         * Every kept launch of the account's whose runner ended, settled
         * again with how it ended; let go of where the service took it, or where its answer
         * (`open`) no longer listed it and its settle was refused on
         * `GONE_AFTER_REFUSALS` beats in a row, since a line long settled
         * may be gone and refuse every settle, while one only hidden by a
         * stop queued after it is taken well before.
         */
        const pendingSettled = (open: ReadonlySet<string> | undefined) =>
          Effect.gen(function* () {
            const running = runningLaunches();
            const pending = (yield* Ref.get(state)).launches.filter(
              (launch) =>
                launch.userId === userId && !running.has(launch.id) && !starting.has(launch.id),
            );
            for (const launch of pending) {
              const ending = endings.get(launch.id);
              if (!(yield* settle(launch.id, ending?.exitCode, ending?.refusal))) {
                const unlisted = open !== undefined && !open.has(launch.id);
                const refusals = unlisted ? (refusedUnlisted.get(launch.id) ?? 0) + 1 : 0;
                refusedUnlisted.set(launch.id, refusals);
                if (refusals < GONE_AFTER_REFUSALS) continue;
              }
              refusedUnlisted.delete(launch.id);
              endings.delete(launch.id);
              yield* forgetLaunch(launch.id);
            }
          });

        /**
         * A beat, and the device converged to the launches its answer holds
         * it to: every kept launch whose runner ended settled again; every
         * runner that ran as the beat was sent whose launch the answer does
         * not name stopped, as a stop line stops it; and every launch the
         * answer names that the device neither ran, started, nor kept as the
         * beat was sent, and still does not, settled as a runner gone. Note
         * that what the device runs is read before the beat is sent, because
         * the answer is read after it: a launch claimed later is never judged
         * against an answer that could not have named it. An answer naming no
         * launches, from a service before the list, converges nothing but
         * the kept launches' settles. The beat's answer, where one came.
         */
        const reconciledBeat = Effect.gen(function* () {
          const ran = new Map(runners);
          const knew = new Set([
            ...starting,
            ...runningLaunches(),
            ...(yield* Ref.get(state)).launches.map((launch) => launch.id),
          ]);
          const beat: DeviceAgentBeat | undefined = yield* beatOf(deviceId);
          if (beat !== undefined) yield* Deferred.succeed(beaten, undefined);
          const open = beat?.openLaunches === undefined ? undefined : new Set(beat.openLaunches);
          yield* pendingSettled(open);
          if (open === undefined) return beat;
          for (const [agentId, runner] of ran) {
            if (open.has(runner.lineId) || runners.get(agentId) !== runner) continue;
            report("a local agent's runner was stopped, since the service no longer holds it here");
            yield* FiberSet.run(stopping, ended(runner));
          }
          const kept = new Set((yield* Ref.get(state)).launches.map((launch) => launch.id));
          const unknown = [...open].filter((id) => !knew.has(id) && !kept.has(id));
          if (unknown.length === 0) return beat;
          // Note that these are settled holding `claiming`, so none is one whose claim is under way, and each is read again first.
          yield* claiming.withPermit(
            Effect.forEach(
              unknown,
              (id) => (starting.has(id) || runningLaunches().has(id) ? Effect.void : settle(id)),
              { discard: true },
            ),
          );
          return beat;
        });

        /** Whether the device runs nothing and has nothing under way: no runner, no launch starting, no line it claimed waiting or being delivered, and no request being answered. */
        const idle = Effect.map(
          FiberSet.size(answering),
          (requests) =>
            runners.size === 0 && starting.size === 0 && undelivered === 0 && requests === 0,
        );

        /**
         * The switch to the release the host's update holds, once the device
         * is idle: its claims of lines and requests paused under `claiming`,
         * so no line's claim is under way, where it is idle still there and
         * no claim's answer was lost, since that claim may have been handed a
         * launch only this process could ask for again. A line claimed since
         * the first look keeps the claims going and the switch waits for a
         * later beat, as does a switch that did not go through; one that did
         * leaves them paused, since the daemon ends, and since a line it
         * claimed and a request it is answering are idle's to wait out, the
         * daemon's end cuts off neither.
         */
        const switchedWhileIdle = (update: LocalAgentsUpdate) =>
          Effect.gen(function* () {
            if (!(yield* idle)) return;
            const stopped = yield* claiming.withPermit(
              Effect.gen(function* () {
                if (claimTokens.size > 0 || !(yield* idle)) return false;
                paused = true;
                return true;
              }),
            );
            if (!stopped) return;
            if (!(yield* update.switched(beatOf(deviceId)))) paused = false;
          });

        /** A beat converged to (`reconciledBeat`), its release handed to the host's update, and the switch to one it holds where the device is idle. */
        const followedBeat = Effect.gen(function* () {
          const beat = yield* reconciledBeat;
          const { update } = dependencies;
          if (update === undefined || beat === undefined) return;
          yield* update.heard(beat.release);
          if (yield* update.waiting) yield* switchedWhileIdle(update);
        });

        /** The successful reads in a row each agent this machine made was left out of, by its id. */
        const missedReads = new Map<string, number>();
        /** The pass each agent left out was last tried on, so the agents never tried go first and the rest take turns, and a few that always fail never take every place. */
        const lastTried = new Map<string, number>();
        let passes = 0;

        /**
         * The work given done on the agent under its delivery lock, only
         * where that is free and the agent stands idle: no line of its
         * delivered or waiting to be, a launch among them, no runner, and no
         * launch kept, since the service may hold the device to it yet; none
         * otherwise.
         */
        const whileIdle = <A, R>(agentId: string, work: Effect.Effect<A, never, R>) =>
          deliveryLockOf(agentId)
            .withPermitsIfAvailable(1)(
              Effect.gen(function* () {
                const mailbox = mailboxes.get(agentId);
                const waiting = mailbox !== undefined && (yield* Queue.size(mailbox)) > 0;
                const kept = (yield* Ref.get(state)).launches.some(
                  (launch) => launch.agentId === agentId,
                );
                if (waiting || kept || runners.has(agentId)) {
                  return Option.none<A>();
                }
                return Option.some(yield* work);
              }),
            )
            .pipe(Effect.map(Option.flatten));

        /** The use (`usedAt`) each agent's folder stood at when a pass's check found work in it, or could not say, so it is checked again only once the agent has been used since. */
        const holdingWork = new Map<string, number>();

        /**
         * The agent's folder, unused for `FOLDER_UNUSED_FOR`, removed whole
         * where it still stands at the use `at` the pass read it at and the
         * platform's check finds all its work on GitHub (`unsavedWork`), so
         * its next launch starts afresh from its branch
         * (`LAUNCH_NOTE.CLEARED`); its stamp goes with it, but the agent
         * stays this machine's, and its mode stays, since it is not archived.
         * One whose check finds work, or cannot say, is recorded so
         * (`holdingWork`) and kept.
         */
        const folderCleared = (agentId: string, at: number) =>
          Effect.gen(function* () {
            // Note that an agent used since the pass read it, as a files line ahead of its launch uses it, is no longer unused.
            if (!Option.exists(yield* usedAt(folder, agentId), (now) => now === at)) {
              return CLEAR_END.PASSED_OVER;
            }
            const layout = deviceAgentLayout(folder, agentId);
            const unsaved = yield* unsavedWork(layout);
            if (Option.isSome(unsaved)) {
              holdingWork.set(agentId, at);
              report(
                `a local agent's folder unused for ${Duration.format(FOLDER_UNUSED_FOR)} was kept, since ${unsaved.value}: ${agentId}`,
              );
              return CLEAR_END.KEPT;
            }
            yield* fileSystem.remove(layout.folder, { recursive: true, force: true });
            yield* usedForgotten(agentId);
            holdingWork.delete(agentId);
            report(
              `a local agent's folder unused for ${Duration.format(FOLDER_UNUSED_FOR)} was removed, its work all on GitHub: ${agentId}`,
            );
            return CLEAR_END.REMOVED;
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => {
                report(`a local agent's folder could not be removed: ${agentId}`);
                return CLEAR_END.FAILED;
              }),
            ),
          );

        /**
         * The folders of the agents given, this machine's as the pass read
         * them, whose agents went unused for `FOLDER_UNUSED_FOR` before `now`
         * (`usedAt`), cleared longest unused first (`folderCleared`), each
         * only while its agent stands idle (`whileIdle`), so never a running
         * one's. Never one kept for work since its agent was left out
         * (`kept`), one that ran on the developer's own logins, whose launch
         * is refused for good, or one whose check found work, or could not
         * say, at the use it stands at (`holdingWork`); and at most
         * `FOLDER_CHECKS_PER_PASS` checks run a pass. It runs last in a pass
         * (`swept`), so a read that was not answered clears no folder either.
         */
        const unusedCleared = (agentIds: readonly string[], now: number) =>
          Effect.gen(function* () {
            const mine = new Set(agentIds);
            for (const id of [...holdingWork.keys()]) {
              if (!mine.has(id)) holdingWork.delete(id);
            }
            const unused: { readonly id: string; readonly at: number }[] = [];
            for (const id of agentIds) {
              const at = yield* usedAt(folder, id);
              if (Option.isNone(at)) continue;
              if (now - at.value >= Duration.toMillis(FOLDER_UNUSED_FOR)) {
                unused.push({ id, at: at.value });
              }
            }
            const keptAt = (yield* Ref.get(state)).kept ?? {};
            let checks = 0;
            for (const { id, at } of unused.sort((one, other) => one.at - other.at)) {
              if (checks >= FOLDER_CHECKS_PER_PASS) return;
              if (keptAt[id] !== undefined || holdingWork.get(id) === at) continue;
              const ran = yield* ranAs(id, deviceAgentLayout(folder, id).checkoutPath);
              if (Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.BARE)) continue;
              const ended = yield* whileIdle(id, folderCleared(id, at));
              if (Option.exists(ended, (end) => end !== CLEAR_END.PASSED_OVER)) checks += 1;
            }
          });

        /**
         * One pass over the agents this machine made (`ownedAgents`), never
         * another Luke install's, each left be while it is not idle
         * (`whileIdle`). Their ids are read first, then the live agents, so
         * an agent named was made before the read was asked. Every agent left
         * out of `ORPHAN_AFTER` answered reads in a row, and not kept for work
         * it holds, is let go of whole as a discard lets go of it, as is one
         * kept `KEPT_FOR` since, up to `ORPHANS_PER_PASS`, those tried longest
         * ago first; a read that was not answered lets go of no agent whole.
         * Then the folders of idle agents unused for `FOLDER_UNUSED_FOR` are
         * cleared (`unusedCleared`).
         */
        const swept = Effect.gen(function* () {
          passes += 1;
          const owned = (yield* ownedAgents(kernel.stateRoot))
            .filter((id) => AGENT_UUID.test(id))
            .sort();
          const now = yield* Clock.currentTimeMillis;
          const live = yield* asked(client.liveAgents(deviceId));
          if (live === undefined) return;
          const mine = new Set(owned);
          const standing = new Set(live);
          for (const id of [...missedReads.keys()]) {
            if (!mine.has(id) || standing.has(id)) {
              missedReads.delete(id);
              lastTried.delete(id);
            }
          }
          for (const id of owned) {
            if (!standing.has(id)) missedReads.set(id, (missedReads.get(id) ?? 0) + 1);
          }
          // Note that a kept folder whose agent is no longer this machine's, or stands again, is forgotten, so the agent is tried anew while it is left out.
          const stays = (id: string) => mine.has(id) && !standing.has(id);
          if (Object.keys((yield* Ref.get(state)).kept ?? {}).some((id) => !stays(id))) {
            yield* updateState((latest) => ({
              ...latest,
              kept: Object.fromEntries(
                Object.entries(latest.kept ?? {}).filter(([id]) => stays(id)),
              ),
            }));
          }
          const keptAt = (yield* Ref.get(state)).kept ?? {};
          const keptPast = (id: string) =>
            keptAt[id] !== undefined && now - keptAt[id] >= Duration.toMillis(KEPT_FOR);
          const unlisted = [...missedReads]
            .filter(
              ([id, missed]) =>
                missed >= ORPHAN_AFTER && (keptAt[id] === undefined || keptPast(id)),
            )
            .map(([id]) => id)
            .sort((one, other) => (lastTried.get(one) ?? 0) - (lastTried.get(other) ?? 0));
          let tried = 0;
          for (const id of unlisted) {
            if (tried >= ORPHANS_PER_PASS) break;
            const past = keptPast(id);
            const ended = yield* whileIdle(
              id,
              discarded(id, past ? LET_GO.KEPT_PAST : LET_GO.SWEEP),
            );
            if (Option.isNone(ended)) continue;
            tried += 1;
            lastTried.set(id, passes);
            if (ended.value === DISCARD_END.FAILED) continue;
            lastTried.delete(id);
            missedReads.delete(id);
            if (ended.value !== DISCARD_END.REMOVED) continue;
            report(
              past
                ? `a local agent's folder kept a week for work in it was removed: ${id}`
                : `a local agent the service no longer lists here was removed: ${id}`,
            );
          }
          // Note that the unused folders are read once the agents left out are let go of, so none is checked twice in one pass.
          yield* unusedCleared(owned, now);
        });

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        // Note that a pass that died is reported and the next still runs, since a repeat ends at the first failure and nothing else would start it again before the follow does.
        const sweepPass = Effect.catchDefect(swept, () =>
          Effect.sync(() => report("a pass over this machine's local agents failed")),
        );
        yield* Effect.forkScoped(
          Effect.andThen(
            Deferred.await(beaten),
            Effect.repeat(sweepPass, Schedule.spaced(PASS_EVERY)),
          ),
        );
        yield* presence(userId, deviceId, Effect.provideContext(followedBeat, services));
      });

    /** The id this follower holds the machine's lease under (`follower-lock.ts`), minted once. */
    const holder = kernel.createId();
    /** Whether this follower last found the machine's lease held by another, so it says so once rather than every turn. */
    const refusedLock = yield* Ref.make(false);

    /**
     * The machine's lease, taken for as long as the scope stands and renewed
     * every `IDLE` while it does; none where another follower holds it,
     * which is said once, and otherwise what waits until the lease is lost
     * to another follower, which is said too.
     */
    const leased = Effect.gen(function* () {
      if (!(yield* takeFollowerLock(kernel.stateRoot, holder))) {
        if (!(yield* Ref.getAndSet(refusedLock, true))) {
          report("another follower runs this machine's local agents, so this one follows none");
        }
        return Option.none<Effect.Effect<void>>();
      }
      yield* Ref.set(refusedLock, false);
      yield* Effect.addFinalizer(() => releaseFollowerLock(kernel.stateRoot, holder));
      const lost = yield* Deferred.make<void>();
      yield* Effect.forkScoped(
        Effect.andThen(Effect.sleep(IDLE), renewFollowerLock(kernel.stateRoot, holder)).pipe(
          Effect.repeat({ until: (held) => !held }),
          Effect.andThen(
            Effect.sync(() => report("this follower lost the machine's lease, so it stops")),
          ),
          Effect.andThen(Deferred.succeed(lost, undefined)),
        ),
      );
      yield* reread;
      return Option.some(Deferred.await(lost));
    });

    /**
     * One turn of the loop: with the gate shut, a rest; with it open, the
     * machine's lease taken, the device registered, every agent its own
     * state names kept as its own (`adopted`), every launch it kept
     * from a runner that ended with the app or the gate settled as gone, its
     * turn let go of first, as is every other agent's this machine made, and
     * the account's agents followed until the gate shuts or the account
     * changes, when the follow's scope closes, every runner it started is
     * stopped with its group, and the lease is given back.
     */
    const turn = Effect.gen(function* () {
      const userId = dependencies.accountId();
      if (!(yield* gateOpen) || userId === undefined || Option.isNone(home)) {
        return yield* Effect.sleep(IDLE);
      }
      yield* Effect.scoped(openTurn(userId, home.value));
    });

    /** An open gate's turn for the account `userId` names, from its home folder, under the machine's lease. */
    const openTurn = (userId: string, folder: string) =>
      Effect.gen(function* () {
        const lost = yield* leased;
        if (Option.isNone(lost)) return yield* Effect.sleep(IDLE);
        // Note that a lease lost to another follower ends the turn wherever it stands, its setup's retries and the kept launches' recovery among it, so nothing of this follower's registers or settles a launch once another holds the machine, and the follow ends with every runner it started.
        yield* Effect.race(underLease(userId, folder), lost.value);
      });

    /** What an open gate's turn does once it holds the machine's lease: the device readied and registered, the launches it kept settled, and its agents followed. */
    const underLease = (userId: string, folder: string) =>
      Effect.gen(function* () {
        const deviceId = yield* deviceOf(userId);
        const { tools } = platform;
        const registered = (setup: DeviceSetupRegister) =>
          client.register(deviceId, {
            name: platform.deviceName,
            platform: platform.devicePlatform,
            arch: platform.deviceArch,
            isolation: platform.deviceIsolation,
            home: folder,
            claudeExecutable: tools.claude,
            codexExecutable: tools.codex,
            signedIn: NOT_SIGNED_IN,
            capabilities: platform.deviceCapabilities,
            ...setup,
          });
        // Note that the device registers as ready only once it has what its agents run on, so Start never takes one that cannot run an agent.
        if (!(yield* readyForOpening(userId, deviceId, registered))) {
          return yield* Effect.sleep(IDLE);
        }
        const shellVariables = yield* shellEnvironment;
        if (!(yield* asked(registered({})))) return yield* Effect.sleep(IDLE);
        // Note that the agents this install ran are kept as its own before its kept launches are settled and forgotten, and before its first pass runs.
        yield* adopted(folder);
        yield* unstampedStamped(folder);
        const left = (yield* Ref.get(state)).launches.filter((launch) => launch.userId === userId);
        for (const launch of left) {
          // Note that a runner that ended with the app left its turn standing, so its turn is let go of before its launch is settled.
          if (launch.agentId !== undefined) {
            yield* turnLetGo(deviceAgentLayout(folder, launch.agentId));
          }
          if (yield* asked(client.settleLine(deviceId, launch.id))) yield* forgetLaunch(launch.id);
        }
        // Note that no runner runs yet, so whatever a run cut off left in the folder of any agent this machine made is let go of too; the agents of another Luke install sharing `~/.luke/agents` are never named here.
        const kept = new Set(left.flatMap((launch) => launch.agentId ?? []));
        for (const agentId of yield* ownedAgents(kernel.stateRoot)) {
          if (!kept.has(agentId)) yield* turnLetGo(deviceAgentLayout(folder, agentId));
        }
        yield* Effect.scoped(follow(userId, deviceId, folder, shellVariables));
      });

    const lifetime = Effect.gen(function* () {
      // A turn that died is reported and the follow rests before the next, as a shut gate does.
      const guarded = Effect.catchDefect(Effect.provideContext(turn, services), () =>
        Effect.andThen(
          Effect.sync(() => report("the local agents' follow failed")),
          Effect.sleep(IDLE),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    // Note that the follower answers nothing itself: the panel asks This Mac's luke-host (`compose-this-mac-host.ts`).
    const methods: Composer["methods"] = {};
    return { methods, lifetime } satisfies Composer;
  });
}
