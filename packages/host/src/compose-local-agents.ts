import type {
  DeviceAgentClaimedLine,
  DeviceAgentDevice,
  HostedDeviceAgentClient,
} from "@luke/features";
import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@luke/features/checkout-identity";
import { DEVICE_BEAT } from "@luke/features/coding-agent-wire";
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
  Config,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  FiberSet,
  Option,
  Path,
  Queue,
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
  type LocalAgentSandboxCommand,
  Reporter,
} from "./effect/seams.js";
import { releaseFollowerLock, renewFollowerLock, takeFollowerLock } from "./follower-lock.js";
import type { HostKernel } from "./host-kernel.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-local-agents.ts -- runs on this device the coding agents the account starts on it, each in a VM of its own: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as the Local agents experiment and This Mac's Run agents on this Mac are both on (a host's are always).
 *
 * The service writes a local agent's work as rows under this device's id
 * (`@luke/features/device-agent-wire`, `contract/device-agents.ts`): lines
 * for its runner and requests from its tools. A Mac's id is minted once per
 * account and kept in the host's state; a host is handed the one it enrolled
 * under (`LocalAgentsDependencies.deviceId`). Every time the gate opens, an
 * app start among them, the device first has what its VMs run on
 * (`LocalAgentSandbox.ready`: a Mac's pinned smolvm, fetched and checked,
 * and the image pulled once), once per opening, so a device offline is not
 * asked again every turn. A first fetch or pull takes minutes, so while it
 * runs the device registers as preparing (`DEVICE_SETUP`) and beats, and the
 * menus list it as getting ready, which takes no agent; one that failed
 * registers why and beats until the gate shuts, so it is listed as not set
 * up rather than not at all. Once it has them it registers with its home folder, the VM's
 * own Claude Code and Codex, and no harness signed in by itself, since no
 * login of the device's reaches a VM, so every launch carries the sign-in
 * saved in Luke; then it beats every `BEAT_EVERY` while it follows. It
 * holds one read for its lines and one for its requests, each answered by
 * the service as soon as one waits, and claims each by its id.
 *
 * Lines are claimed in the order the service lists them, its id order, and
 * handed to the agent they name, whose worker takes them one at a time, so
 * an agent's lines are delivered strictly in order while agents go on side
 * by side. A launch makes the agent's own repository under its folder
 * (`deviceAgentLayout`) where it has none, through the platform's script,
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
 * token before the repository is made, and again every
 * `GITHUB_TOKEN_REFRESH` while its runner runs, since such a token lasts an
 * hour and a turn can last a day, and hands it to the sandbox, which keeps
 * it outside every folder the VM mounts, so the agent only ever sees a
 * placeholder. A tool's command runs in the VM rather than on the device,
 * since the worktree is the agent's to rig.
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
 * line's id, no secret beside it, until its runner's exit settles it. A
 * launch still kept as the gate opens had its runner end with the app, or
 * with the gate, so it is settled with no exit code, which the service reads
 * as a runner gone: the agent's turn in flight is settled lost, and its next
 * message relaunches the runner on the harness's session.
 *
 * Requests are each answered on a fiber of their own, inside the agent's
 * folder alone (`local-agent-requests.ts`). Turning the switch or the
 * experiment off, signing out, or a run that sends nothing shuts the gate:
 * the reads end, and every runner is stopped, as the quit stops them.
 */

/** How long the follow rests while the gate is shut, and how often an open gate is read again. */
const IDLE = Duration.seconds(5);
/** How often a device following its agents beats, which the service's and the window's presence reads are derived from (`DEVICE_BEAT`). */
const BEAT_EVERY = Duration.millis(DEVICE_BEAT.EVERY_MS);
/** How long a discard waits on the platform's check of the worktree before it keeps the folder. */
const UNSAVED_CHECK = Duration.seconds(30);
/** Why a folder is kept where its check could not say what it holds. */
const UNSAVED_UNKNOWN = "its worktree could not be checked for work not saved elsewhere";
/** How a held read the service did not answer is asked again. */
const REREAD = Duration.seconds(2);
/** How many times a runner's exit is settled again where the service did not take it, `REREAD` apart. */
const SETTLE_RETRIES = 30;
/** How a claim the service did not answer is asked again, well inside its own claim window. */
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;
/** How long a runner's group has to end after SIGTERM before it is sent SIGKILL. */
const KILL_GRACE = Duration.seconds(3);
/** The file in the host's state the device ids and the launches running are kept in. */
const STATE_FILE = "local-agents.json";
/** The exit code a launch is settled with where its worktree could not be made or its runner started. */
const NOT_STARTED = 1;
/** How soon a GitHub token the service did not hand is asked for again, well inside the hour the last one lasts. */
const GITHUB_TOKEN_RETRY = Duration.minutes(1);

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

/**
 * What the host keeps of local agents between runs: the device id each
 * account registered under, the launches whose runners this device started
 * and no exit has settled yet, and, on a device whose agents may have run
 * directly on it (`formerlyDirect`), how each agent has run here, in a VM or
 * directly, absent from a state file from before it.
 */
const LocalAgentStateSchema = Schema.Struct({
  devices: Schema.Record(Schema.String, Schema.String),
  launches: Schema.Array(Schema.Struct({ userId: Schema.String, id: Schema.String })),
  modes: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Literals(Object.values(DEVICE_ISOLATION))),
  ),
});

type LocalAgentState = typeof LocalAgentStateSchema.Type;

const NO_STATE: LocalAgentState = { devices: {}, launches: [] };

/** Where a device's setup stands as it registers: nothing once it is ready, else preparing, or failed and why. */
type DeviceSetupRegister = Pick<DeviceAgentDevice, "setup" | "setupFailure">;

/** What a device says of the harnesses signed in on it by itself: none, since no login of the device's reaches its agents' VMs. */
const NOT_SIGNED_IN: DeviceSignedIn = { claudeCode: false, codex: false };

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalAgentStateSchema));
const encodeState = Schema.encodeSync(Schema.fromJsonString(LocalAgentStateSchema));
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

export interface LocalAgentsComposer extends Composer {
  /** Waits until no follow of this follower's stands, its runners stopped and the machine's lease given back; a gate shut before it is asked ends the follow within `IDLE`. */
  readonly idle: Effect.Effect<void>;
  /**
   * The account's device id on this machine, minted the first time as a
   * follow would, with every launch it kept under the account handed to the
   * device itself, so the follower that runs on the device's own secret
   * (`@luke/host/daemon`), whose account is its device, settles them.
   */
  readonly handedToDevice: (userId: string) => Effect.Effect<string>;
  /** The account the device id given was minted for on this machine, as its state keeps it; none where it names none. */
  readonly ownerOf: (deviceId: string) => Effect.Effect<string | undefined>;
  /** The device registered under the id given as preparing (`DEVICE_SETUP.PREPARING`), which takes no agent; whether the service took it. */
  readonly registeredPreparing: (deviceId: string) => Effect.Effect<boolean>;
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
): Effect.Effect<LocalAgentsComposer, never, LocalAgentServices> {
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
    const statePath = path.join(kernel.stateRoot, STATE_FILE);

    // -- the host's state ----------------------------------------------------

    const readState = fileSystem.readFileString(statePath).pipe(
      Effect.map((text) => Option.getOrElse(decodeState(text), () => NO_STATE)),
      Effect.orElseSucceed(() => NO_STATE),
    );
    const state = yield* Ref.make(yield* readState);
    const writing = yield* Semaphore.make(1);
    /** The state read again from its file, as the other follower left it. */
    const reread = writing.withPermit(Effect.flatMap(readState, (read) => Ref.set(state, read)));

    /**
     * The state changed and written whole, one change at a time, so a write
     * never lands over a newer one; written beside the file and moved over
     * it, so a write cut off leaves the last whole one. A write that cannot
     * land is reported, and the next one tries again. Note that the other
     * follower this machine may run writes the file too, never while this
     * one follows (`follower-lock.ts`), so the state is read again whenever
     * this one takes the machine's lease (`reread`).
     */
    const updateState = (change: (current: LocalAgentState) => LocalAgentState) =>
      writing.withPermit(
        Effect.gen(function* () {
          const next = yield* Ref.updateAndGet(state, change);
          const written = `${statePath}.writing`;
          yield* fileSystem.writeFileString(written, `${encodeState(next)}\n`);
          yield* fileSystem.rename(written, statePath);
        }).pipe(
          Effect.catch(() =>
            Effect.sync(() => report("the local agents' state could not be saved")),
          ),
        ),
      );

    /** The device id this account registers under on this device: the one it enrolled under, or one minted the first time. */
    const deviceOf = (userId: string) =>
      Effect.gen(function* () {
        if (dependencies.deviceId !== undefined) return dependencies.deviceId;
        const kept = (yield* Ref.get(state)).devices[userId];
        if (kept !== undefined) return kept;
        const minted = kernel.createId();
        yield* updateState((current) => ({
          ...current,
          devices: { ...current.devices, [userId]: minted },
        }));
        return minted;
      });

    const keepLaunch = (userId: string, id: string) =>
      updateState((current) => ({ ...current, launches: [...current.launches, { userId, id }] }));

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
      updateState((current) => ({
        ...current,
        launches: current.launches.filter((launch) => launch.id !== id),
      }));

    // -- the gate --------------------------------------------------------------

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    /** Whether this device runs local agents now: an account signed in, a run that sends, a home folder, and both switches on. */
    const gateOpen = Effect.map(
      switchedOn,
      (on) =>
        on && Option.isSome(home) && kernel.runMode.sendsNetwork && account.capabilitiesActive(),
    );

    /** The beats, for as long as the gate stands and the account signed in is the one `userId` names; it returns once either changes. */
    const presence = (userId: string, deviceId: string) =>
      Effect.gen(function* () {
        let sinceBeat = Duration.toMillis(BEAT_EVERY);
        while ((yield* gateOpen) && dependencies.accountId() === userId) {
          if (sinceBeat >= Duration.toMillis(BEAT_EVERY)) {
            yield* asked(client.beat(deviceId, NOT_SIGNED_IN));
            sinceBeat = 0;
          }
          yield* Effect.sleep(IDLE);
          sinceBeat += Duration.toMillis(IDLE);
        }
      });

    // -- what the VMs run on ------------------------------------------------------

    /** Whether the device had what its VMs run on as it last asked, and whether it asked since the gate last opened. */
    const readied = yield* Ref.make(false);
    const readyTried = yield* Ref.make(false);
    /** Whether the service took the register saying the device's setup failed, so it may go on beating. */
    const failureListed = yield* Ref.make(false);

    /**
     * Whether the device has what its VMs run on (`LocalAgentSandbox.ready`),
     * asked again each time the gate opens once it had it, and otherwise once
     * per opening, and once per app start, since the app's first opening is
     * one; one that failed waits for the next, so a device offline is not
     * asked again every turn. As a fetch or pull begins (the sandbox's
     * `preparing`) the device registers as preparing and beats, so the
     * menus list it as getting ready rather than not at all; one that failed
     * registers why and beats for as long as the opening stands, so it is
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
        if (!(yield* Ref.get(readied)) && (yield* Ref.getAndSet(readyTried, true))) {
          if (yield* Ref.get(failureListed)) yield* presence(userId, deviceId);
          return false;
        }
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
        yield* Ref.set(readied, Result.isSuccess(ready));
        if (Result.isSuccess(ready)) return true;
        report("the local agents' smolvm or sandbox image could not be had");
        // Note that the device stays listed with why, beating until the gate shuts, which lets the next opening try again.
        const listed = yield* asked(
          registered({ setup: DEVICE_SETUP.FAILED, setupFailure: ready.failure.detail }),
        );
        yield* Ref.set(failureListed, listed);
        if (listed) yield* presence(userId, deviceId);
        return false;
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
         * it is run in stands, by its runner or by one of its tools' commands
         * between turns; whether it stands. The last hold let go of stops the
         * VM, so a command between turns never leaves it running, and never
         * stops it under a runner. A VM a discard deleted is held by nothing.
         */
        const vmHeld = <E, R>(agentId: string, start: Effect.Effect<boolean, E, R>) =>
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
                    if (!(yield* platform.sandbox.stopped(agentId)))
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

        /** The agent's GitHub token renewed every `GITHUB_TOKEN_REFRESH`, or a minute after one that was not had, for as long as it runs. */
        const renewingGithub = (
          agentId: string,
          had: boolean,
        ): Effect.Effect<never, never, FileSystem.FileSystem> =>
          Effect.flatMap(Effect.sleep(had ? GITHUB_TOKEN_REFRESH : GITHUB_TOKEN_RETRY), () =>
            Effect.flatMap(gaveGithubToken(agentId), (again) => renewingGithub(agentId, again)),
          );

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
              return yield* settle(line.id, NOT_STARTED);
            }
            const sandbox = platform.sandbox;
            const withRepository = payload.value.repository !== null;
            // Note that an agent that ran directly on the Mac keeps its Git folder in the shared clone no VM mounts, and its harness's sessions in the developer's own home, so it never starts in a VM.
            const ran = yield* ranAs(agentId, layout.checkoutPath);
            if (Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.BARE)) {
              report(
                "a local agent that ran directly on this Mac was not started, since every agent here runs in a VM now",
              );
              return yield* settle(line.id, NOT_STARTED, DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY);
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
            if (!made) return yield* settle(line.id, NOT_STARTED);
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
              return yield* settle(line.id, NOT_STARTED);
            }
            const identity = payload.value.identity;
            if (withRepository && identity !== undefined) {
              if (!(yield* identitySet(agentId, layout, identity))) {
                yield* Scope.close(runnerScope, Exit.void);
                report("a local agent's commit identity could not be set in its VM");
                return yield* settle(line.id, NOT_STARTED);
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
              return yield* settle(line.id, NOT_STARTED);
            }
            const handle = started.value;
            // Note that this runs first as the scope closes, so the runner hears a signal before its command is killed.
            yield* Scope.addFinalizer(
              runnerScope,
              Effect.provideContext(endedInVm(sandbox, agentId, handle), services),
            );
            if (withRepository)
              yield* Effect.forkIn(renewingGithub(agentId, hadToken), runnerScope);
            yield* keepLaunch(userId, line.id);
            yield* Queue.offer(stdin, secrets.stdin);
            // Note that the launch is forgotten only once the service took its settle, asked again
            // a while where it did not, so one an outage left unsettled is settled as the gate next opens.
            const exited = yield* Effect.gen(function* () {
              const code = yield* Effect.option(handle.exitCode);
              runners.delete(agentId);
              yield* Scope.close(runnerScope, Exit.void);
              const settled = yield* Option.match(code, {
                onNone: () => settle(line.id),
                onSome: (exitCode) => settle(line.id, Number(exitCode)),
              }).pipe(
                Effect.repeat({
                  schedule: Schedule.spaced(REREAD),
                  times: SETTLE_RETRIES,
                  until: (taken) => taken,
                }),
              );
              if (settled) yield* forgetLaunch(line.id);
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
         * The agent's runner, where one runs, stopped and its exit waited for,
         * so its line is settled first. It is signalled in its VM first,
         * since killing its command would end it with no signal at all.
         */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            yield* endedInVm(platform.sandbox, agentId, runner.handle);
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
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
                yield* stopped(agentId);
                return yield* launched(agentId, line, claimed.secrets, agentScope);
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

        /** One line claimed by its id, asked again a few times where unanswered; refused, or nothing where never answered. */
        const claimedLine = (id: string) =>
          asked(client.claimLine(deviceId, id)).pipe(
            Effect.repeat({
              schedule: Schedule.spaced(CLAIM_RETRY.every),
              times: CLAIM_RETRY.times,
              until: (answer) => answer !== undefined,
            }),
          );

        /**
         * The lines read and claimed in the service's order, each handed to
         * its agent's mailbox. A claim never answered ends the batch there,
         * so a later line of the same agent is never delivered before it; the
         * next read lists it again. Note that each claim and its hand-over are
         * uninterruptible, because a line the service granted is this Mac's
         * alone to deliver.
         */
        const linesFollowed = Effect.forever(
          Effect.gen(function* () {
            const lines = yield* asked(client.lines(deviceId));
            if (lines === undefined) return yield* Effect.sleep(REREAD);
            for (const line of lines) {
              const taken = yield* Effect.uninterruptible(
                Effect.gen(function* () {
                  const answer = yield* claimedLine(line.id);
                  if (answer === undefined) return false;
                  if (!("line" in answer)) return true;
                  yield* Queue.offer(yield* mailboxOf(answer.line.agentId), answer);
                  return true;
                }),
              );
              if (!taken) return;
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
            const env = { ...shellVariables, TMPDIR: layout.temp };
            // Note that an agent's command runs in its VM, never on the device, since its worktree is the agent's to rig.
            const sandbox = platform.sandbox;
            const inVm = {
              woken: vmHeld(claimed.agentId, sandbox.woken(claimed.agentId)),
              exec: (command: Omit<LocalAgentSandboxCommand, "agentId" | "folder">) =>
                sandbox.exec({ ...command, agentId: claimed.agentId, folder: layout.folder }),
            };
            const answer = yield* answeredLocalAgentRequest(layout, claimed, env, inVm).pipe(
              Effect.provideContext(services),
            );
            yield* asked(client.answerRequest(deviceId, claimed.id, answer));
          });

        /** The requests read, each answered on its own fiber, so a slow command holds up neither the reads nor the others. */
        const requestsFollowed = Effect.forever(
          Effect.gen(function* () {
            const requests = yield* asked(client.requests(deviceId));
            if (requests === undefined) return yield* Effect.sleep(REREAD);
            for (const request of requests) yield* FiberSet.run(answering, answered(request));
          }),
        );

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        yield* presence(userId, deviceId);
      });

    /** The id this follower holds the machine's lease under (`follower-lock.ts`), minted once. */
    const holder = kernel.createId();
    /** Held for as long as a follow of this follower's stands, the machine's lease with it, which `idle` waits out. */
    const following = yield* Semaphore.make(1);
    /** Whether this follower last found the machine's lease held by another, so it says so once rather than every turn. */
    const refusedLock = yield* Ref.make(false);

    /**
     * The machine's lease, taken for as long as the scope stands and renewed
     * every `IDLE` while it does; whether it was taken. A lease another
     * follower holds is said once, and the turn rests as a shut gate does.
     */
    const leased = Effect.gen(function* () {
      if (!(yield* takeFollowerLock(kernel.stateRoot, holder))) {
        if (!(yield* Ref.getAndSet(refusedLock, true))) {
          report("another follower runs this machine's local agents, so this one follows none");
        }
        return false;
      }
      yield* Ref.set(refusedLock, false);
      yield* Effect.addFinalizer(() => releaseFollowerLock(kernel.stateRoot, holder));
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.andThen(Effect.sleep(IDLE), renewFollowerLock(kernel.stateRoot, holder)),
        ),
      );
      yield* reread;
      return true;
    });

    /**
     * One turn of the loop: with the gate shut, a rest; with it open, the
     * machine's lease taken, the device registered, every launch it kept
     * from a runner that ended with the app or the gate settled as gone, and
     * the account's agents followed until the gate shuts or the account
     * changes, when the follow's scope closes, every runner it started is
     * stopped with its group, and the lease is given back.
     */
    const turn = Effect.gen(function* () {
      const userId = dependencies.accountId();
      if (!(yield* gateOpen) || userId === undefined || Option.isNone(home)) {
        // A gate shut lets the next opening ask again for what the VMs run on, where it was not had.
        yield* Ref.set(readyTried, false);
        return yield* Effect.sleep(IDLE);
      }
      yield* following.withPermit(Effect.scoped(openTurn(userId, home.value)));
    });

    /** An open gate's turn for the account `userId` names, from its home folder, under the machine's lease. */
    const openTurn = (userId: string, folder: string) =>
      Effect.gen(function* () {
        // Note that the gate is read again under the permit, since `idle` may have waited on a turn that shut it.
        if (!(yield* gateOpen) || dependencies.accountId() !== userId) return;
        if (!(yield* leased)) return yield* Effect.sleep(IDLE);
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

    const idle = following.withPermit(Effect.void);

    const ownerOf = (deviceId: string) =>
      Effect.map(
        Effect.andThen(reread, Ref.get(state)),
        ({ devices }) => Object.entries(devices).find(([, kept]) => kept === deviceId)?.[0],
      );

    const registeredPreparing = (deviceId: string) =>
      Option.match(home, {
        onNone: () => Effect.succeed(false),
        onSome: (folder) =>
          asked(
            client.register(deviceId, {
              name: platform.deviceName,
              platform: platform.devicePlatform,
              arch: platform.deviceArch,
              isolation: platform.deviceIsolation,
              home: folder,
              claudeExecutable: platform.sandbox.tools.claude,
              codexExecutable: platform.sandbox.tools.codex,
              signedIn: NOT_SIGNED_IN,
              capabilities: platform.deviceCapabilities,
              setup: DEVICE_SETUP.PREPARING,
            }),
          ),
      });

    const handedToDevice = (userId: string) =>
      Effect.gen(function* () {
        yield* reread;
        const deviceId = yield* deviceOf(userId);
        yield* updateState((current) => ({
          ...current,
          launches: current.launches.map((launch) =>
            launch.userId === userId ? { ...launch, userId: deviceId } : launch,
          ),
        }));
        return deviceId;
      });

    // Note that the follower answers nothing itself: the panel asks This Mac's luke-host (`compose-this-mac-host.ts`).
    const methods: Composer["methods"] = {};
    return {
      methods,
      lifetime,
      idle,
      handedToDevice,
      ownerOf,
      registeredPreparing,
    } satisfies LocalAgentsComposer;
  });
}
