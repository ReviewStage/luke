import type {
  DeviceAgentBeat,
  DeviceAgentClaimedLine,
  DeviceAgentDevice,
  HostedDeviceAgentClient,
} from "@luke/features";
import { DEVICE_BEAT } from "@luke/features/agent-wire";
import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@luke/features/checkout-identity";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ISOLATION,
  DEVICE_LAUNCH_REFUSAL,
  DEVICE_SETUP,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLayout,
  type DeviceAgentLine,
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
import {
  Environment,
  LocalAgentPlatform,
  type LocalAgentSandbox,
  Reporter,
} from "./effect/seams.js";
import { releaseFollowerLock, renewFollowerLock, takeFollowerLock } from "./follower-lock.js";
import type { HostKernel } from "./host-kernel.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import {
  type LocalAgentState,
  localAgentDeviceOf,
  readLocalAgentState,
  writeLocalAgentState,
} from "./local-agent-state.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-local-agents.ts -- runs on this device the coding agents the account starts on it, each in a VM of its own: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as its gate stands (`LocalAgentsDependencies.switchedOn`: the Local agents experiment on a Mac; always on a host).
 *
 * The service writes a local agent's work as rows under this device's id
 * (`@luke/features/device-agent-wire`, `contract/device-agents.ts`): lines
 * for its runner and requests from its tools. A Mac's id is minted once per
 * account and kept in the host's state; a host is handed the one it enrolled
 * under (`LocalAgentsDependencies.deviceId`). Every time the gate opens, an
 * app start among them, the device first has what its VMs run on
 * (`LocalAgentSandbox.ready`: a Mac's pinned smolvm, fetched and checked,
 * and the image pulled once). A first fetch or pull takes minutes, so while
 * it runs the device registers as preparing (`DEVICE_SETUP`) and beats, and
 * the menus list it as getting ready, which takes no agent; one that failed
 * registers why and beats, so it is listed as not set up rather than not at
 * all, and is tried again after `SETUP_RETRY`'s wait, doubling from try to
 * try, for as long as the gate stands. Once it has them it registers with its home folder, the VM's
 * own Claude Code and Codex, and no harness signed in by itself, since no
 * login of the device's reaches a VM, so every launch carries the sign-in
 * saved in Luke; then it beats every `BEAT_EVERY` while it follows. It
 * holds one read for its lines and one for its requests, each answered by
 * the service as soon as one waits, and claims each by its id.
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
 * through the platform's script,
 * has the agent's VM made and started, sets in the repository, inside the
 * VM, who the agent's commits are by where the line says, as a cloud
 * checkout sets it (`@luke/features/checkout-identity`), and starts the
 * runner in it, with
 * the claim's secrets in its environment and nowhere else, never a file, an
 * argument, or a log, and its first lines on its stdin; its line is settled
 * with the runner's exit code once it exits. A message or retune line is
 * written to the running runner's stdin; a files line writes its files under
 * the agent's folder; a stop line ends the runner; a discard line ends it,
 * deletes its VM, and removes the agent's folder with everything in it,
 * unless the platform's check of the worktree finds work there that is
 * nowhere else (a Mac's does, a host's names none); a line of a kind it
 * does not know is settled untouched. A launch whose repository or VM could
 * not be made is settled as not started, and the runner never starts.
 *
 * The VM (`LocalAgentPlatformSeam.sandbox`) is made and started before the
 * runner starts in it; the runner is signalled in it before its command is
 * killed, since killing it would end the runner with no signal at all; it
 * stops once the runner has ended, whatever ended it; and it is deleted
 * before a discard removes the agent's folder. The runner runs on the VM's
 * own Node, Claude Code and Codex, which the device registers. For an agent
 * working in a repository, the device asks the service for an installation
 * token before the repository is made, and again once the last is
 * `GITHUB_TOKEN_REFRESH` old by the wall clock, read every minute, while its
 * runner runs, since such a token lasts an hour and a turn can last a day,
 * and a sleeping machine stretches a long wait but not the hour; it hands
 * it to the sandbox, which keeps
 * it outside every folder the VM mounts, so the agent only ever sees a
 * placeholder. The check of its folder for unsaved work runs in the VM
 * rather than on the device, since the worktree is the agent's to rig.
 *
 * Agents on This Mac ran directly on it before every agent ran in a VM
 * (`LocalAgentPlatformSeam.formerlyDirect`), so there the host keeps how
 * each agent ran, beside its launches, and takes an agent from before that
 * record with a checkout as one that ran directly: its Git folder is in the
 * shared clone no VM mounts and its harness's sessions in the developer's
 * own home, so its launch is settled unstarted with the refusal that says
 * so (`DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY`), and a discard checks its folder
 * on the Mac, since it has no VM to check it in.
 *
 * Every launch this device claimed is kept in the host's state by its
 * line's id and its agent's, no secret beside it, until the service takes
 * its settle. A launch still kept as the gate opens had its runner end with
 * the app, or with the gate, so its agent's VM is stopped where it still
 * runs and it is settled with no exit code, which the service reads as a
 * runner gone: the agent's turn in flight is settled lost, and its next
 * message relaunches the runner on the harness's session.
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
/** How many more times a kept launch's VM that a restart could not stop is stopped again, a beat apart, before its launch is settled regardless, since a VM already gone refuses every stop. */
const VM_STOP_TRIES = 4;
/** How a claim the service did not answer is asked again, well inside its own claim window. */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;
/** How long a runner's group has to end after SIGTERM before it is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);
/** The exit code a launch is settled with where its worktree could not be made or its runner started. */
const NOT_STARTED = 1;
/** How often an agent's GitHub token's age is read off the wall clock, and so how soon one the service did not hand is asked for again, well inside the hour the last one lasts. */
const GITHUB_TOKEN_CHECK = Duration.minutes(1);

const VARIABLE = {
  HOME: "HOME",
  SHELL: "SHELL",
  USER: "USER",
  LOGNAME: "LOGNAME",
  LANG: "LANG",
  PATH: "PATH",
} as const;

/**
 * A runner in a VM asked to end there, where it still runs, and given
 * `KILL_GRACE` to: killing its command (`smolvm machine exec`) would end it
 * at once with no signal, so every process of the agent's in the VM is
 * signalled first.
 */
function endedInVm(
  sandbox: LocalAgentSandbox,
  agentId: string,
  handle: ChildProcessSpawner.ChildProcessHandle,
): Effect.Effect<void, never, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    if (!(yield* Effect.orElseSucceed(handle.isRunning, () => false))) return;
    yield* sandbox.signalled(agentId);
    yield* Effect.timeoutOption(Effect.ignore(handle.exitCode), KILL_GRACE);
  });
}

/** The variables of the developer's own a runner and a command are started with, read from the app's environment; nothing else of Luke's is handed on. */
const HANDED_ON = [VARIABLE.HOME, VARIABLE.SHELL, VARIABLE.USER, VARIABLE.LOGNAME, VARIABLE.LANG];

/** Where a device's setup stands as it registers: nothing once it is ready, else preparing, or failed and why. */
type DeviceSetupRegister = Pick<DeviceAgentDevice, "setup" | "setupFailure">;

/** What a device says of the harnesses signed in on it by itself: none, since no login of the device's reaches its agents' VMs. */
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
>;

export interface LocalAgentsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "createId"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
  /** The device id this device enrolled under, where it enrolled one, as a host does; minted once per account and kept otherwise. */
  deviceId?: string | undefined;
  /** Whether the account's Local agents experiment and Settings › This Mac's switch are both on, read every `IDLE` while the gate is open. */
  switchedOn: Effect.Effect<boolean>;
  client: LocalAgentClient;
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

    /** The kept launches whose VM a restart could not stop, by line id, with how many more times a beat stops it again before they are settled regardless. */
    const unstopped = new Map<string, number>();

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
     * whose agents always ran in VMs.
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

    // -- the gate --------------------------------------------------------------

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    /** Whether this device runs local agents now: an account signed in, a run that sends, a home folder, and both switches on. */
    const gateOpen = Effect.map(
      switchedOn,
      (on) =>
        on && Option.isSome(home) && kernel.runMode.sendsNetwork && account.capabilitiesActive(),
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
      beaten: Effect.Effect<unknown> = asked(client.beat(deviceId, NOT_SIGNED_IN)),
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

    // -- what the VMs run on ------------------------------------------------------

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
     * Whether the device has what its VMs run on (`LocalAgentSandbox.ready`),
     * asked each time the gate opens, and after a try that failed asked
     * again once `setupRetryAfter` has passed, one try at a time, for as
     * long as the gate stands and the account is the one `userId` names; it
     * answers false only once either changes. As a fetch or pull begins (the
     * sandbox's `preparing`) the device registers as preparing and beats, so
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
              return yield* Effect.result(platform.sandbox.ready(preparing));
            }),
          );
          if (Result.isSuccess(ready)) return true;
          report("the local agents' smolvm or sandbox image could not be had");
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
     * smolvm runs under and the repository's script finds git on, read once
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
        const vmHolds = new Map<string, number>();
        const vmLocks = new Map<string, Semaphore.Semaphore>();
        /** The launch lines claimed and handed to their agents whose runners are not yet running or settled unstarted, which no beat settles. */
        const starting = new Set<string>();
        /** How each launch whose settle the service has not taken yet ended, by its line's id. */
        const endings = new Map<string, LaunchEnding>();
        /** Held by each claim and by a beat's settle of a launch the device never kept, so neither runs while the other is unanswered. */
        const claiming = yield* Semaphore.make(1);
        /** The runners a beat stops, since the service no longer holds the device to their launches. */
        const stopping = yield* FiberSet.make();

        /** The lock over the agent's VM's start and stop, one per agent, so one agent's slow start holds up no other's. */
        const vmLockOf = (agentId: string) => {
          const kept = vmLocks.get(agentId);
          if (kept !== undefined) return kept;
          const made = Semaphore.makeUnsafe(1);
          vmLocks.set(agentId, made);
          return made;
        };

        /**
         * The agent's VM started by `start` and held for as long as the scope
         * it is run in stands, by its runner or by a check of its folder
         * between turns; whether it stands. The last hold let go of stops the
         * VM, so a check between turns never leaves it running, and never
         * stops it under a runner. A VM a discard deleted is held by nothing.
         * Where a runner's launch (`lineId`) holds it and the stop fails, the
         * launch joins `unstopped`, so a beat stops it again before the
         * launch is settled.
         */
        const vmHeld = <E, R>(
          agentId: string,
          start: Effect.Effect<boolean, E, R>,
          lineId?: string,
        ) =>
          Effect.gen(function* () {
            const lock = vmLockOf(agentId);
            const up = yield* lock.withPermit(
              Effect.tap(start, (stands) =>
                Effect.sync(() => {
                  if (stands) vmHolds.set(agentId, (vmHolds.get(agentId) ?? 0) + 1);
                }),
              ),
            );
            if (!up) return false;
            yield* Effect.addFinalizer(() =>
              lock
                .withPermit(
                  Effect.gen(function* () {
                    const held = vmHolds.get(agentId);
                    if (held === undefined) return;
                    if (held > 1) return vmHolds.set(agentId, held - 1);
                    vmHolds.delete(agentId);
                    if (yield* platform.sandbox.stopped(agentId)) return;
                    if (lineId !== undefined) unstopped.set(lineId, VM_STOP_TRIES);
                    report("a local agent's VM could not be stopped");
                  }),
                )
                .pipe(Effect.provideContext(services)),
            );
            return true;
          });
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
            const ending = { exitCode: NOT_STARTED, refusal };
            // Note that a launch whose VM would not stop as its start was given up stays kept with how it ended, which every beat stops again before it settles (`vmLetGo`).
            if (unstopped.has(id)) return void endings.set(id, ending);
            yield* settledLaunch(id, ending);
          });

        /** The agent's own repository made where it has none, reading the agent's GitHub token where it has one through the sandbox's helper, never the token itself: a folder for an agent with no repository. */
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
         * with (`CHECKOUT_IDENTITY_SCRIPT`); whether it was. Note that it runs
         * in the agent's VM, never on the device, whose own git a repository
         * the agent rigged could steer, and on every launch, since a
         * repository made before the launch line carried an identity holds
         * none.
         */
        const identitySet = (
          agentId: string,
          layout: DeviceAgentLayout,
          identity: CheckoutIdentity,
        ) => {
          const run = platform.sandbox.exec({
            agentId,
            folder: layout.folder,
            cwd: layout.checkoutPath,
            command: "/bin/bash",
            args: ["-c", CHECKOUT_IDENTITY_SCRIPT],
            env: { ...shellVariables, ...checkoutIdentityEnv(identity) },
          });
          return Effect.scoped(
            Effect.flatMap(
              ChildProcess.make(run.command, [...run.args], {
                cwd: folder,
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
         * A fresh token for the agent's repository from the service, handed
         * to the sandbox, which keeps it outside every folder the agent's VM
         * mounts, where the VM's bindings read it; whether it was. A token
         * refused or unanswered is reported in those words alone.
         */
        const gaveGithubToken = (agentId: string) =>
          Effect.gen(function* () {
            const token = yield* asked(client.githubToken(agentId));
            if (token === undefined) return false;
            yield* platform.sandbox.githubToken(agentId, token);
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

        /** The runner started for a launch line, its first lines written, and its exit settling the line; the line settled as not started where it cannot be. */
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
            const sandbox = platform.sandbox;
            const withRepository = payload.value.repository !== null;
            // Note that an agent that ran directly on the Mac keeps its Git folder in the shared clone no VM mounts, and its harness's sessions in the developer's own home, so it never starts in a VM.
            const ran = yield* ranAs(agentId, layout.checkoutPath);
            if (Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.BARE)) {
              report(
                "a local agent that ran directly on this Mac was not started, since every agent here runs in a VM now",
              );
              return yield* notStarted(agentId, line.id, DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY);
            }
            if (platform.formerlyDirect && Option.isNone(ran)) {
              yield* keepMode(agentId, DEVICE_ISOLATION.SANDBOX);
            }
            // Note that the token is had before the repository is made, since the device's git reads it too, through the sandbox's helper.
            const hadToken = withRepository && (yield* gaveGithubToken(agentId));
            const made = yield* madeWorktree(
              layout,
              payload.value.repository,
              payload.value.startBranch,
              withRepository ? sandbox.deviceGit(agentId) : undefined,
            );
            if (!made) return yield* notStarted(agentId, line.id);
            const temp = layout.temp;
            yield* Effect.ignore(fileSystem.makeDirectory(temp, { recursive: true, mode: 0o700 }));
            const runnerScope = yield* Scope.fork(agentScope);
            // Note that the runner holds its VM for as long as its scope stands, so the VM is let go of last as the scope closes, once the runner has ended.
            // Note that smolvm's reason names no secret, since its credentials are only ever references to their files.
            const refused = yield* vmHeld(
              agentId,
              Effect.as(
                sandbox.started({ agentId, folder: layout.folder, github: withRepository }),
                true,
              ),
              line.id,
            ).pipe(
              Scope.provide(runnerScope),
              Effect.as(Option.none<string>()),
              Effect.catchTag("LocalAgentSandboxUnavailable", (unavailable) =>
                Effect.succeed(Option.some(unavailable.detail)),
              ),
            );
            if (Option.isSome(refused)) {
              yield* Scope.close(runnerScope, Exit.void);
              report(`a local agent's VM could not be started: ${refused.value}`);
              return yield* notStarted(agentId, line.id);
            }
            const identity = payload.value.identity;
            if (withRepository && identity !== undefined) {
              if (!(yield* identitySet(agentId, layout, identity))) {
                yield* Scope.close(runnerScope, Exit.void);
                report("a local agent's commit identity could not be set in its VM");
                return yield* notStarted(agentId, line.id);
              }
            }
            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            const command = platform.launch({
              agentId,
              folder: layout.folder,
              checkout: layout.checkoutPath,
              node: sandbox.tools.node,
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
            // Note that this runs first as the scope closes, so the runner hears a signal before its command is killed.
            yield* Scope.addFinalizer(
              runnerScope,
              Effect.provideContext(endedInVm(sandbox, agentId, handle), services),
            );
            if (withRepository)
              yield* Effect.forkIn(renewingGithub(agentId, hadToken), runnerScope);
            yield* keepLaunch(userId, line.id, agentId);
            yield* Queue.offer(stdin, secrets.stdin);
            // Note that the launch is forgotten only once the service took its settle, which every
            // beat asks again where it did not, so one an outage left unsettled is settled once it ends.
            const exited = yield* Effect.gen(function* () {
              const code = yield* Effect.option(handle.exitCode);
              const ending = { exitCode: Option.getOrUndefined(Option.map(code, Number)) };
              // Note that how it ended is kept before the runner is let go of, so a beat that settles it first carries its exit code.
              endings.set(line.id, ending);
              runners.delete(agentId);
              // Note that the launch is starting again while its scope closes, since the VM's stop outlasts a beat and no beat may settle the launch before it has said whether the stop failed.
              starting.add(line.id);
              yield* Scope.close(runnerScope, Exit.void).pipe(
                Effect.ensuring(Effect.sync(() => starting.delete(line.id))),
              );
              // Note that a launch whose VM would not stop stays kept, which every beat stops again before it settles (`vmLetGo`).
              if (unstopped.has(line.id)) return;
              yield* settledLaunch(line.id, ending);
            }).pipe(Effect.forkIn(agentScope));
            runners.set(agentId, { lineId: line.id, stdin, handle, exited });
          });

        /**
         * Why the agent's folder holds work a discard would lose, as the
         * platform's check says it; none where the platform names no check or
         * the check finds nothing. Where the agent ran in a VM (`vm`), the
         * check runs there, woken for it, and never on the device, whose own
         * git a repository the agent rigged could make run anything; a VM
         * that cannot be woken leaves the folder unchecked. A check that
         * fails, outlasts `UNSAVED_CHECK`, or cannot start is taken as work,
         * since the folder may hold the only copy.
         */
        const unsavedWork = (
          agentId: string,
          layout: DeviceAgentLayout,
          vm: LocalAgentSandbox | undefined,
        ) =>
          Effect.gen(function* () {
            if (platform.unsavedWorkScript === undefined) return Option.none<string>();
            const script = platform.unsavedWorkScript({ worktree: layout.checkoutPath });
            return yield* Effect.scoped(
              Effect.gen(function* () {
                if (vm !== undefined && !(yield* vmHeld(agentId, vm.woken(agentId)))) {
                  return (yield* fileSystem.exists(layout.checkoutPath))
                    ? Option.some(UNSAVED_UNKNOWN)
                    : Option.none<string>();
                }
                const run =
                  vm === undefined
                    ? { command: "/bin/bash", args: ["-c", script], env: undefined }
                    : vm.exec({
                        agentId,
                        folder: layout.folder,
                        cwd: layout.folder,
                        command: "/bin/bash",
                        args: ["-c", script],
                        env: shellVariables,
                      });
                const handle = yield* ChildProcess.make(run.command, [...run.args], {
                  cwd: folder,
                  ...(run.env === undefined ? undefined : { env: run.env, extendEnv: false }),
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
         * settled first. It is signalled in its VM first, since killing its
         * command would end it with no signal at all; its VM stops once it
         * has ended.
         */
        const ended = (agentId: string, runner: Runner) =>
          Effect.gen(function* () {
            yield* endedInVm(platform.sandbox, agentId, runner.handle);
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        /** The agent's runner, where one runs, stopped and its exit waited for (`ended`). */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            yield* ended(agentId, runner);
          });

        /**
         * The VM a discard lets go of: the agent's, unless it ran directly on
         * the device before every agent ran in a VM (`formerlyDirect`), when
         * it has none and its folder is checked by the device's own script,
         * as it always was.
         */
        const vmOf = (agentId: string, checkoutPath: string) =>
          Effect.map(ranAs(agentId, checkoutPath), (ran) =>
            Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.BARE)
              ? undefined
              : platform.sandbox,
          );

        /**
         * The agent let go of: its runner stopped and its exit settled, its
         * VM, where it ran in one, deleted, and its folder removed with
         * everything in it, its worktree and what its runner and commands
         * wrote there; the shared clone the worktree was made from stays, and
         * the next worktree made of it prunes this one's record. A device
         * whose platform names a check of the worktree keeps the folder, and
         * says why, where the check finds work in it that is nowhere else, or
         * cannot say; its VM goes either way. A removal that fails is
         * reported.
         */
        const discarded = (agentId: string) =>
          Effect.gen(function* () {
            yield* stopped(agentId);
            const layout = deviceAgentLayout(folder, agentId);
            const vm = yield* vmOf(agentId, layout.checkoutPath);
            const unsaved = yield* unsavedWork(agentId, layout, vm);
            // Note that the VM goes before the folder, so nothing in it is still writing there as it is removed, and a command's hold outlasting it stops nothing.
            if (vm !== undefined) {
              yield* vmLockOf(agentId).withPermit(
                Effect.andThen(
                  Effect.sync(() => vmHolds.delete(agentId)),
                  vm.deleted(agentId),
                ),
              );
            }
            if (Option.isSome(unsaved)) {
              return yield* Effect.sync(() =>
                report(`a local agent's folder was kept, since ${unsaved.value}`),
              );
            }
            yield* fileSystem.remove(layout.folder, { recursive: true, force: true });
            // Note that a folder kept keeps its record too, so the agent, launched again, runs the way it ran.
            if ((yield* Ref.get(state)).modes?.[agentId] !== undefined) yield* forgetMode(agentId);
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report("a local agent's folder could not be removed")),
            ),
          );

        /** A files line's files written under the agent's folder, each at its mode; one outside the folder is never written. */
        const wroteFiles = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const files = decodeFiles(payload);
            if (Option.isNone(files)) return;
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
                yield* discarded(agentId);
                break;
            }
            yield* settle(line.id);
          });

        /** A claimed line handed to its agent's worker, a launch marked starting first, so no beat settles it before its runner runs. */
        const handedOver = (claimed: DeviceAgentClaimedLine) =>
          Effect.gen(function* () {
            if (claimed.line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH) starting.add(claimed.line.id);
            yield* Queue.offer(yield* mailboxOf(claimed.line.agentId), claimed);
          });

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
                  yield* delivered(agentId, claimed, agentScope);
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
         * so a beat never settles a launch whose claim is unanswered.
         */
        const lineTaken = (id: string) =>
          Effect.uninterruptible(
            claiming.withPermit(
              Effect.gen(function* () {
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
         * The VM of a kept launch a restart could not stop, stopped again
         * unless its agent runs or holds it now, which stops it in turn;
         * whether its launch may be settled: once it stopped, or once
         * `VM_STOP_TRIES` more stops failed, which is said.
         */
        const vmLetGo = (id: string, agentId: string) =>
          vmLockOf(agentId).withPermit(
            Effect.gen(function* () {
              const triesLeft = unstopped.get(id) ?? 0;
              const held = runners.has(agentId) || vmHolds.has(agentId);
              if (!held && triesLeft > 0 && !(yield* platform.sandbox.stopped(agentId))) {
                unstopped.set(id, triesLeft - 1);
                return false;
              }
              if (!held && triesLeft === 0) {
                report(
                  "a local agent's VM left running could not be stopped, so its launch was settled regardless",
                );
              }
              unstopped.delete(id);
              return true;
            }),
          );

        /**
         * Every kept launch of the account's whose runner ended, settled
         * again with how it ended, a VM a restart could not stop stopped
         * first; let go of where the service took it, or where its answer
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
              if (unstopped.has(launch.id) && launch.agentId !== undefined) {
                if (!(yield* vmLetGo(launch.id, launch.agentId))) continue;
              }
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
         * the kept launches' settles.
         */
        const reconciledBeat = Effect.gen(function* () {
          const ran = new Map(runners);
          const knew = new Set([
            ...starting,
            ...runningLaunches(),
            ...(yield* Ref.get(state)).launches.map((launch) => launch.id),
          ]);
          const beat: DeviceAgentBeat | undefined = yield* asked(
            client.beat(deviceId, NOT_SIGNED_IN),
          );
          const open = beat?.openLaunches === undefined ? undefined : new Set(beat.openLaunches);
          yield* pendingSettled(open);
          if (open === undefined) return;
          for (const [agentId, runner] of ran) {
            if (open.has(runner.lineId) || runners.get(agentId) !== runner) continue;
            report("a local agent's runner was stopped, since the service no longer holds it here");
            yield* FiberSet.run(stopping, ended(agentId, runner));
          }
          const kept = new Set((yield* Ref.get(state)).launches.map((launch) => launch.id));
          const unknown = [...open].filter((id) => !knew.has(id) && !kept.has(id));
          if (unknown.length === 0) return;
          // Note that these are settled holding `claiming`, so none is one whose claim is under way, and each is read again first.
          yield* claiming.withPermit(
            Effect.forEach(
              unknown,
              (id) => (starting.has(id) || runningLaunches().has(id) ? Effect.void : settle(id)),
              { discard: true },
            ),
          );
        });

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        yield* presence(userId, deviceId, Effect.provideContext(reconciledBeat, services));
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
     * machine's lease taken, the device registered, every launch it kept
     * from a runner that ended with the app or the gate settled as gone, its
     * VM stopped first, and
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
        // Note that a lease lost to another follower ends the turn wherever it stands, its setup's retries and the kept launches' recovery among it, so nothing of this follower's registers or stops a VM once another holds the machine, and the follow ends with every runner it started.
        yield* Effect.race(underLease(userId, folder), lost.value);
      });

    /** What an open gate's turn does once it holds the machine's lease: the device readied and registered, the launches it kept settled, and its agents followed. */
    const underLease = (userId: string, folder: string) =>
      Effect.gen(function* () {
        const deviceId = yield* deviceOf(userId);
        const { tools } = platform.sandbox;
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
        // Note that the device registers as ready only once it has what its VMs run on, so Start never takes one that cannot run an agent.
        if (!(yield* readyForOpening(userId, deviceId, registered))) {
          return yield* Effect.sleep(IDLE);
        }
        const shellVariables = yield* shellEnvironment;
        if (!(yield* asked(registered({})))) return yield* Effect.sleep(IDLE);
        const left = (yield* Ref.get(state)).launches.filter((launch) => launch.userId === userId);
        for (const launch of left) {
          // Note that a runner that ended with the app may have left its VM running, so its launch is settled only once its VM stopped, which a beat tries again (`vmLetGo`).
          if (launch.agentId !== undefined && !(yield* platform.sandbox.stopped(launch.agentId))) {
            unstopped.set(launch.id, VM_STOP_TRIES);
            continue;
          }
          if (yield* asked(client.settleLine(deviceId, launch.id))) yield* forgetLaunch(launch.id);
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
