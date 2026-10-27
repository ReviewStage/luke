import type { DeviceAgentClaimedLine, HostedDeviceAgentClient } from "@luke/features";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_ISOLATION,
  DEVICE_LAUNCH_REFUSAL,
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
  type LocalAgentPlatformSeam,
  type LocalAgentSandbox,
  type LocalAgentSandboxCommand,
  Reporter,
} from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { localCodexSignedIn } from "./local-agent-codex.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import { localAgentTool } from "./local-agent-tools.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-local-agents.ts -- runs on this Mac the coding agents the account starts on This Mac: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as the Local agents experiment and Settings › This Mac's Run agents on this Mac are both on.
 *
 * The service writes a local agent's work as rows under this Mac's device
 * id (`@luke/features/device-agent-wire`, `contract/device-agents.ts`): lines for
 * its runner and requests from its tools. The id is minted once per account
 * and kept in the host's state, and every time the gate opens, an app start
 * among them, the Mac first has what a runner runs on, Node and the Claude
 * Code CLI, each its pinned release fetched and checked the first time
 * (`local-agent-tools.ts`), once per opening, so a Mac offline is not asked
 * again every turn; it then registers the device with its home folder, the Claude Code
 * CLI it bundles, and which harnesses it is signed in to by itself, then
 * beats every `BEAT_EVERY` while it follows. A local agent on a harness its
 * Mac is signed in to launches on that login, so its launch line carries no
 * credential of the account's; the check is the harness's own CLI's, never
 * the credential, made under the environment a runner starts with. Codex
 * is had apart, off the follow, through its own pin, and the Mac registers
 * it, with Codex's own sign-in, once it is checked, so Start offers Codex on
 * this Mac only then, and a Mac runs Claude Code agents meanwhile. It holds
 * one read for its lines and one for its requests, each answered by the
 * service as soon as one waits, and claims each by its id.
 *
 * Lines are claimed in the order the service lists them, its id order, and
 * handed to the agent they name, whose worker takes them one at a time, so
 * an agent's lines are delivered strictly in order while agents go on side
 * by side. A launch makes the agent's worktree under its folder
 * (`deviceAgentLayout`) where it has none, through the platform's script over
 * Luke's shared clone and the developer's own Git login, and starts the
 * runner as the leader of a process group of its own, with the claim's
 * secrets in its environment and nowhere else, never a file, an argument,
 * or a log, and its first lines on its stdin; its line is settled with the
 * runner's exit code once it exits. A message or retune line is written to
 * the running runner's stdin; a files line writes its files under the
 * agent's folder; a stop line ends the runner's group; a discard line ends
 * it and removes the agent's folder with everything in it, unless the platform's
 * check of the worktree finds work there that is nowhere else (the desktop's
 * does, a host's names none); a line of a kind
 * it does not know is settled untouched. A launch whose worktree could not
 * be made is settled with the script's failure, and the runner never starts.
 *
 * A host has no developer's Git login (`githubFromLuke`), so there each
 * agent working in a repository gets a `gh` sign-in of its own, in a config
 * folder inside its folder (`GH_CONFIG_DIR`): before its worktree is made,
 * and again every `GITHUB_TOKEN_REFRESH` while its runner runs, the host
 * asks the service for an installation token for the agent's repository and
 * signs `gh` in there with it (`gh auth login --with-token`), since such a
 * token lasts an hour and a turn can last a day. Git reads the same token
 * through gh's own credential helper (`gh auth git-credential`, as `gh auth
 * setup-git` sets it), named in the environment the worktree's script and
 * the runner start with, so no file of the developer's and no wrapper of
 * any command stands in. The token goes to `gh`'s stdin and its config
 * folder alone, never an argument, a log, or a report. This Mac keeps the
 * developer's own login and does none of it.
 *
 * A host (`apps/host`) runs this same follow with a platform of its own: it
 * enrolled under a device id of its own, which it is handed
 * (`LocalAgentsDependencies.deviceId`), and says it is signed in to no
 * harness (`ownSignIns`), since no login left on the box reaches an agent
 * there. It is sandboxed (`LocalAgentPlatformSeam.sandbox`): each agent runs
 * in a VM of its own, which the follower has made and started before the
 * runner starts in it, signals the runner in before its command is killed,
 * since killing it would end the runner with no signal at all, stops once
 * the runner has ended, whatever ended it, and deletes before a discard
 * removes the agent's folder. There the runner runs on the VM's own Node,
 * Claude Code and Codex, which the device registers, so it fetches none of
 * its own; the agent's GitHub token is handed to the sandbox, which keeps
 * it outside every folder the VM mounts, in place of a `gh` sign-in in the
 * agent's folder, where the agent could read it; and a tool's command runs
 * in the VM rather than on the device, since the worktree is the agent's to
 * rig.
 *
 * This Mac runs every agent on its platform's sandboxed alternative
 * (`LocalAgentPlatformSeam.sandboxed`), a VM per agent as on a host, on the
 * sign-ins saved in Luke and a GitHub token from Luke. Each agent runs only
 * the way it first ran, which the host keeps beside its launches, and every
 * agent from before the record that has a checkout ran directly on the Mac:
 * its Git folder is in the shared clone no VM mounts and its harness's
 * sessions in the developer's own home, so its launch is settled unstarted,
 * with the refusal that says so (`DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY`), which
 * the service words as a session that cannot be reached again. A discard
 * deletes the VM of an agent that ran in one.
 *
 * Every launch this Mac claimed is kept in the host's state by its line's
 * id, no secret beside it, until its runner's exit settles it. A launch
 * still kept as the gate opens had its runner end with the app, or with the
 * gate, so it is settled with no exit code, which the service reads as a
 * runner gone: the agent's turn in flight is settled lost, and its next
 * message relaunches the runner on the harness's session.
 *
 * Requests are each answered on a fiber of their own, inside the agent's
 * folder alone (`local-agent-requests.ts`). Turning the switch or the
 * experiment off, signing out, or a run that sends nothing shuts the gate:
 * the reads end, and every runner is stopped with its process group, as the
 * quit stops them.
 */

/** How long the follow rests while the gate is shut, and how often an open gate is read again. */
const IDLE = Duration.seconds(5);
/** How often a Mac following its agents beats: a third of the service's forty-five-second presence window. */
const BEAT_EVERY = Duration.seconds(15);
/** How often a Mac found signed in to a harness is checked again, so a sign-out reaches Start and the next launch. */
const SIGN_IN_EVERY = Duration.minutes(10);
/** How long a harness's sign-in check has before its answer is taken as signed out. */
const SIGN_IN_CHECK = Duration.seconds(20);
/** How long a discard waits on the platform's check of the worktree before it keeps the folder. */
const UNSAVED_CHECK = Duration.seconds(30);
/** Why a folder is kept where its check could not say what it holds. */
const UNSAVED_UNKNOWN = "its worktree could not be checked for work not saved elsewhere";
/**
 * The `authMethod`s of `claude auth status` a launch with no credential of
 * the account's runs on: a claude.ai login, and a Console key a login saved.
 * The rest come from the environment or settings a runner is not started
 * with (`oauth_token`, `api_key_helper`, `third_party`), or are none.
 */
const CLAUDE_CODE_LOGINS: ReadonlySet<string> = new Set(["claude.ai", "api_key"]);
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
/** The folder under the agent's own that is its temp folder, which its runner and its commands write to. */
const TEMP_FOLDER = "tmp";
/** The exit code a launch is settled with where its worktree could not be made or its runner started. */
const NOT_STARTED = 1;
/** The GitHub host an agent's `gh` signs in to, and whose HTTPS remotes git's credential helper answers for. */
const GITHUB = {
  HOST: "github.com",
  CREDENTIAL_HELPER_KEY: "credential.https://github.com.helper",
} as const;
/** How soon a sign-in that failed is tried again, well inside the hour the last token lasts. */
const GITHUB_SIGN_IN_RETRY = Duration.minutes(1);

const VARIABLE = {
  HOME: "HOME",
  SHELL: "SHELL",
  USER: "USER",
  LOGNAME: "LOGNAME",
  LANG: "LANG",
  PATH: "PATH",
} as const;

/** A word quoted for a POSIX shell, as git runs a `!` credential helper through one. */
function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * What a host adds to an agent's environment so its git and its `gh` read
 * the one token Luke signed `gh` in with: gh's config folder, and gh's own
 * credential helper for GitHub over git's environment-borne config, the
 * empty helper first so no helper of the box's stands before it, as `gh auth
 * setup-git` writes it into a file.
 */
function githubEnvironment(configFolder: string, gh: string): Readonly<Record<string, string>> {
  return {
    GH_CONFIG_DIR: configFolder,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: GITHUB.CREDENTIAL_HELPER_KEY,
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: GITHUB.CREDENTIAL_HELPER_KEY,
    GIT_CONFIG_VALUE_1: `!${shellQuoted(gh)} auth git-credential`,
  };
}

/**
 * A runner in a VM asked to end there, where it still runs, and given
 * `KILL_GRACE` to: killing its command (`smolvm machine exec`) would end it
 * at once with no signal, so every process of the agent's in the VM is
 * signalled first, as a runner on the device is with its group.
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
 * account registered under, the launches whose runners this Mac started and
 * no exit has settled yet, and, on a device that runs agents either way, how
 * each agent has run here, in a VM or directly, absent from a state file
 * from before it.
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

/** What a device whose own sign-ins never run its agents says of them (`ownSignIns`). */
const NOT_SIGNED_IN: DeviceSignedIn = { claudeCode: false, codex: false };

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalAgentStateSchema));
const encodeState = Schema.encodeSync(Schema.fromJsonString(LocalAgentStateSchema));
const decodeLaunch = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);
const decodeStdin = Schema.decodeUnknownOption(deviceAgentStdinPayloadSchema);
const decodeFiles = Schema.decodeUnknownOption(deviceAgentFilesPayloadSchema);
const decodeAuthStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ authMethod: Schema.String })),
);

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

export type LocalAgentsComposer = Composer;

/** A runner this Mac started: the launch line it settles, its stdin, and the process it is. */
interface Runner {
  readonly lineId: string;
  readonly stdin: Queue.Queue<string>;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  /** The fiber that settles the launch line once the runner exits. */
  readonly exited: Fiber.Fiber<void>;
}

/** What a runner runs on: the Node it is started under and the Claude Code CLI it drives, both absolute. */
interface LocalAgentTools {
  readonly node: string;
  readonly claude: string;
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
    const given = yield* LocalAgentPlatform;
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

    /** The platform the device's agents run on: its sandboxed alternative where it has one, as This Mac does, the one given otherwise. */
    const platformNow = Effect.succeed(given.sandboxed ?? given);

    // -- the host's state ----------------------------------------------------

    const readState = fileSystem.readFileString(statePath).pipe(
      Effect.map((text) => Option.getOrElse(decodeState(text), () => NO_STATE)),
      Effect.orElseSucceed(() => NO_STATE),
    );
    const state = yield* Ref.make(yield* readState);
    const writing = yield* Semaphore.make(1);

    /**
     * The state changed and written whole, one change at a time, so a write
     * never lands over a newer one; written beside the file and moved over
     * it, so a write cut off leaves the last whole one. A write that cannot
     * land is reported, and the next one tries again.
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
     * before the record on a device that runs agents either way, directly,
     * where its checkout stands, since every such agent did. None for an agent
     * never launched here, and on a device with one way of running them.
     */
    const ranAs = (agentId: string, checkoutPath: string) =>
      Effect.gen(function* () {
        if (given.sandboxed === undefined) return Option.none<DeviceIsolation>();
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

    // -- the tools a runner runs on ------------------------------------------------

    /** The Node and Claude Code CLI this Mac's runners run on, once had, the platform they were had for, and whether a fetch was tried since the gate last opened. */
    const tools = yield* Ref.make(Option.none<LocalAgentTools>());
    const toolsFor = yield* Ref.make<LocalAgentPlatformSeam>(given);
    const fetchTried = yield* Ref.make(false);
    const fetching = yield* Semaphore.make(1);

    /**
     * The Node and the Claude Code CLI this Mac's runners run on: the ones
     * had already, where both still stand, or each had now through its pin
     * (`localAgentTool`), the app's or the checkout's own copy first; none
     * where either cannot be had. One at a time, so two asks never fetch the
     * same release twice. On a sandboxed platform they are the VM's own,
     * once the device has what its VMs run on (`LocalAgentSandbox.ready`).
     */
    const toolsHad = (platform: LocalAgentPlatformSeam) =>
      fetching.withPermit(
        Effect.gen(function* () {
          // Note that a sandboxed device's runners run on the VM's own tools, so it fetches none of its own.
          if (platform.sandbox !== undefined) {
            const inVm = (yield* platform.sandbox.ready)
              ? Option.some({
                  node: platform.sandbox.tools.node,
                  claude: platform.sandbox.tools.claude,
                })
              : Option.none<LocalAgentTools>();
            yield* Ref.set(tools, inVm);
            return inVm;
          }
          const had = yield* Ref.get(tools);
          if (Option.isSome(had)) {
            const standing = yield* Effect.all(
              [fileSystem.exists(had.value.node), fileSystem.exists(had.value.claude)],
              { concurrency: 2 },
            ).pipe(Effect.orElseSucceed(() => [false, false]));
            if (standing.every((each) => each)) return had;
          }
          const [node, claude] = yield* Effect.all(
            [
              localAgentTool(kernel.stateRoot, platform.pins.node, platform.bundled.node),
              localAgentTool(kernel.stateRoot, platform.pins.claude, platform.bundled.claude),
            ],
            { concurrency: 2 },
          );
          const both =
            Option.isSome(node) && Option.isSome(claude)
              ? Option.some({ node: node.value, claude: claude.value })
              : Option.none<LocalAgentTools>();
          yield* Ref.set(tools, both);
          return both;
        }),
      );

    /**
     * The tools as the gate opens: had already, or fetched once per opening,
     * and once per app start, since the app's first opening is one; a fetch
     * that failed waits for the next, so a Mac offline is not asked again
     * every turn.
     */
    const toolsForOpening = (platform: LocalAgentPlatformSeam) =>
      Effect.gen(function* () {
        // Note that a platform other than the last one's starts over, since nothing had for the one runs the other.
        if ((yield* Ref.getAndSet(toolsFor, platform)) !== platform) {
          yield* Ref.set(tools, Option.none());
          yield* Ref.set(codex, Option.none());
          yield* Ref.set(fetchTried, false);
        }
        const had = yield* Ref.get(tools);
        if (Option.isSome(had)) return yield* toolsHad(platform);
        if (yield* Ref.getAndSet(fetchTried, true)) return Option.none<LocalAgentTools>();
        const fetched = yield* toolsHad(platform);
        if (Option.isNone(fetched)) {
          report(
            platform.sandbox === undefined
              ? "the local agents' Node or Claude Code could not be had"
              : "the local agents' smolvm or sandbox image could not be had",
          );
        }
        return fetched;
      });

    /** The Codex this device checked against its pin (`pins.codex`), once had; none until then. */
    const codex = yield* Ref.make(Option.none<string>());
    const fetchingCodex = yield* Semaphore.make(1);

    /**
     * Codex for this Mac's local agents, apart from what a runner needs to
     * start, so the Mac registers and runs Claude Code agents while it is
     * fetched: the one had already where it still stands, or had now through
     * its pin (`localAgentTool`), the app's copy first. A fetch that fails is
     * reported, and tried again as the gate next opens or a launch finds the
     * Codex the Mac registered gone.
     */
    const codexHad = (platform: LocalAgentPlatformSeam) =>
      fetchingCodex.withPermit(
        Effect.gen(function* () {
          if (platform.sandbox !== undefined) {
            const inVm = Option.some(platform.sandbox.tools.codex);
            yield* Ref.set(codex, inVm);
            return inVm;
          }
          const kept = yield* Ref.get(codex);
          if (Option.isSome(kept) && (yield* fileSystem.exists(kept.value))) return kept;
          const had = yield* localAgentTool(
            kernel.stateRoot,
            platform.pins.codex,
            platform.bundled.codex,
          );
          if (Option.isNone(had)) report("Codex for local agents could not be had");
          yield* Ref.set(codex, had);
          return had;
        }).pipe(Effect.orElseSucceed(() => Option.none<string>())),
      );

    // -- the gate --------------------------------------------------------------

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    /** Whether this Mac runs local agents now: an account signed in, a run that sends, a home folder, and both switches on. */
    const gateOpen = Effect.map(
      switchedOn,
      (on) =>
        on && Option.isSome(home) && kernel.runMode.sendsNetwork && account.capabilitiesActive(),
    );

    // -- the developer's own environment and sign-ins ----------------------------

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
     * What a runner, a command, and a sign-in check are started with of the
     * Mac's own: the developer's identity and shell, and their login shell's
     * PATH, read once each time the gate opens; never the rest of the app's
     * environment, which is Luke's and none of the agent's.
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

    /**
     * Whether Claude Code is signed in on this Mac by itself, as the CLI the
     * Mac bundles answers `claude auth status`
     * (https://code.claude.com/docs/en/cli-reference): exit 0 when logged in,
     * with its `authMethod` as JSON. Asked under the environment a runner is
     * started with, so no variable of Luke's or the shell's stands in, and its
     * config folder left as the developer's, which the Keychain login is kept
     * under. A claude.ai login, or a Console key saved by a login, counts;
     * anything else, a check that fails or outlasts `SIGN_IN_CHECK`, does not.
     * Nothing the CLI prints is kept but that one word.
     */
    const claudeCodeSignedIn = (claude: string, env: Readonly<Record<string, string>>) =>
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* ChildProcess.make(claude, ["auth", "status"], {
            env,
            extendEnv: false,
            stdin: "ignore",
            stderr: "ignore",
          });
          const printed = yield* Stream.mkString(Stream.decodeText(handle.stdout));
          if (Number(yield* handle.exitCode) !== 0) return false;
          return Option.exists(decodeAuthStatus(printed), (status) =>
            CLAUDE_CODE_LOGINS.has(status.authMethod),
          );
        }),
      ).pipe(
        Effect.timeoutOption(SIGN_IN_CHECK),
        Effect.map((answer) => Option.getOrElse(answer, () => false)),
        Effect.orElseSucceed(() => false),
      );

    /**
     * Whether Codex is signed in on this Mac by itself, as app-server's
     * `account/read` answers it for the Codex the Mac checked, under the
     * environment a runner starts with and the developer's own default
     * `CODEX_HOME` (`local-agent-codex.ts`); not said at all while the Mac has
     * no Codex yet, nor where Codex did not answer.
     */
    const codexSignedIn = (env: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const executable = yield* Ref.get(codex);
        if (Option.isNone(executable)) return Option.none<boolean>();
        return yield* localCodexSignedIn(executable.value, env);
      });

    /**
     * Which harnesses this device is signed in to by itself, each checked as
     * its own CLI answers; neither on a device whose own sign-ins never run
     * its agents (`ownSignIns`), so every launch there carries the sign-in
     * saved in Luke.
     */
    const signedInNow = (
      platform: LocalAgentPlatformSeam,
      had: LocalAgentTools,
      env: Readonly<Record<string, string>>,
    ) =>
      Effect.gen(function* () {
        if (!platform.ownSignIns) return NOT_SIGNED_IN;
        const claudeCode = yield* claudeCodeSignedIn(had.claude, env);
        const said = yield* codexSignedIn(env);
        const signedIn: DeviceSignedIn = Option.match(said, {
          onNone: () => ({ claudeCode }),
          onSome: (each) => ({ claudeCode, codex: each }),
        });
        return signedIn;
      });

    // -- one account's follow --------------------------------------------------

    /** Everything one open gate runs for the account `userId` names, on the device it registered, from its home folder. */
    const follow = (
      platform: LocalAgentPlatformSeam,
      userId: string,
      deviceId: string,
      folder: string,
      shellVariables: Readonly<Record<string, string>>,
      had: LocalAgentTools,
      checkedSignIn: DeviceSignedIn,
      registered: (
        signedIn: DeviceSignedIn,
      ) => Effect.Effect<boolean, never, HttpClient.HttpClient>,
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
        const vmHeld = <E, R>(
          sandbox: LocalAgentSandbox,
          agentId: string,
          start: Effect.Effect<boolean, E, R>,
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
                    if (!(yield* sandbox.stopped(agentId)))
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

        /** The agent's worktree made where it has none, on the agent's GitHub sign-in where the host gave it one: a folder for an agent with no repository, and Luke's shared clone's worktree otherwise. */
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
         * The agent's `gh` signed in, in its own config folder, with a fresh
         * token for its repository from the service; whether it was. On a
         * sandboxed device the token is handed to the sandbox instead, which
         * keeps it outside every folder the agent's VM mounts, since a token
         * in the agent's folder would be the agent's to read. A token refused
         * or unanswered, or a sign-in that failed, is reported in those words
         * alone.
         */
        const signedInToGithub = (agentId: string, configFolder: string, gh: string) =>
          Effect.gen(function* () {
            const token = yield* asked(client.githubToken(agentId));
            if (token === undefined) return false;
            if (platform.sandbox !== undefined) {
              yield* platform.sandbox.githubToken(agentId, token);
              return true;
            }
            yield* fileSystem.makeDirectory(configFolder, { recursive: true, mode: 0o700 });
            const code = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make(
                  gh,
                  [
                    "auth",
                    "login",
                    "--hostname",
                    GITHUB.HOST,
                    "--with-token",
                    // Note that the token is kept in the agent's own config folder, never a keyring every agent on the box shares.
                    "--insecure-storage",
                  ],
                  {
                    env: { ...shellVariables, GH_CONFIG_DIR: configFolder },
                    extendEnv: false,
                    stdin: { stream: Stream.make(new TextEncoder().encode(token)) },
                    stdout: "ignore",
                    stderr: "ignore",
                  },
                ),
                (handle) => handle.exitCode,
              ),
            );
            return Number(code) === 0;
          }).pipe(
            Effect.orElseSucceed(() => false),
            Effect.tap((signedIn) =>
              signedIn
                ? Effect.void
                : Effect.sync(() => report("a host agent's GitHub sign-in failed")),
            ),
          );

        /** The agent's `gh` signed in again every `GITHUB_TOKEN_REFRESH`, or a minute after a sign-in that failed, for as long as it runs. */
        const renewingGithub = (
          agentId: string,
          configFolder: string,
          gh: string,
          signedIn: boolean,
        ): Effect.Effect<
          never,
          never,
          ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
        > =>
          Effect.flatMap(Effect.sleep(signedIn ? GITHUB_TOKEN_REFRESH : GITHUB_SIGN_IN_RETRY), () =>
            Effect.flatMap(signedInToGithub(agentId, configFolder, gh), (again) =>
              renewingGithub(agentId, configFolder, gh, again),
            ),
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
            // Note that a host signs the agent's own gh in before its worktree is made, since the clone reads the token too.
            const gh = platform.bundled.gh ?? "gh";
            const configFolder = layout.githubConfig;
            const signsIn = platform.githubFromLuke && payload.value.repository !== null;
            const sandbox = platform.sandbox;
            // Note that a sandboxed agent's worktree is made on the device with the token the sandbox keeps, and its runner reaches GitHub through its VM's bindings alone.
            const deviceGithub = !signsIn
              ? undefined
              : sandbox === undefined
                ? githubEnvironment(configFolder, gh)
                : sandbox.deviceGit(agentId);
            const github = sandbox === undefined ? deviceGithub : undefined;
            // Note that an agent runs only the way it first ran here: one made directly on the Mac keeps its Git folder in the shared clone no VM mounts, and one made in a VM keeps its harness's sessions in the VM's own home.
            const ran = yield* ranAs(agentId, layout.checkoutPath);
            if (Option.isSome(ran) && ran.value !== platform.deviceIsolation) {
              if (ran.value === DEVICE_ISOLATION.SANDBOX) {
                report("a local agent that ran in a VM was not started directly on this device");
                return yield* settle(line.id, NOT_STARTED);
              }
              report(
                "a local agent that ran directly on this Mac was not started, since every agent here runs in a VM now",
              );
              return yield* settle(line.id, NOT_STARTED, DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY);
            }
            if (given.sandboxed !== undefined && Option.isNone(ran)) {
              yield* keepMode(agentId, platform.deviceIsolation);
            }
            const signedIn = signsIn && (yield* signedInToGithub(agentId, configFolder, gh));
            const made = yield* madeWorktree(
              layout,
              payload.value.repository,
              payload.value.startBranch,
              deviceGithub,
            );
            if (!made) return yield* settle(line.id, NOT_STARTED);
            // Note that a Codex the Mac registered and lost since is had again before the runner starts, so a Codex agent's launch finds it.
            const kept = yield* Ref.get(codex);
            if (
              sandbox === undefined &&
              Option.isSome(kept) &&
              !(yield* Effect.orElseSucceed(fileSystem.exists(kept.value), () => false))
            ) {
              yield* codexHad(platform);
            }
            const temp = path.join(layout.folder, TEMP_FOLDER);
            yield* Effect.ignore(fileSystem.makeDirectory(temp, { recursive: true, mode: 0o700 }));
            const runnerScope = yield* Scope.fork(agentScope);
            // Note that the runner holds its VM for as long as its scope stands, so the VM is let go of last as the scope closes, once the runner has ended.
            if (sandbox !== undefined) {
              // Note that smolvm's reason names no secret, since its credentials are only ever references to their files.
              const refused = yield* vmHeld(
                sandbox,
                agentId,
                Effect.as(
                  sandbox.started({ agentId, folder: layout.folder, github: signsIn }),
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
            }
            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            const command = platform.launch({
              agentId,
              folder: layout.folder,
              checkout: layout.checkoutPath,
              node: had.node,
              bundle: platform.runnerBundle,
              env: {
                ...shellVariables,
                TMPDIR: temp,
                ...platform.runnerEnv,
                ...github,
                ...secrets.env,
              },
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
            if (sandbox !== undefined) {
              yield* Scope.addFinalizer(
                runnerScope,
                Effect.provideContext(endedInVm(sandbox, agentId, handle), services),
              );
            }
            if (signsIn) {
              yield* Effect.forkIn(
                renewingGithub(agentId, configFolder, gh, signedIn),
                runnerScope,
              );
            }
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
                if (vm !== undefined && !(yield* vmHeld(vm, agentId, vm.woken(agentId)))) {
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
         * The agent's runner, where one runs, stopped with its group and its
         * exit waited for, so its line is settled first. In a VM the runner
         * is signalled there first, since killing its command would end it
         * with no signal at all.
         */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            if (platform.sandbox !== undefined) {
              yield* endedInVm(platform.sandbox, agentId, runner.handle);
            }
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        /**
         * The VM a discard lets go of: on a device with one way of running
         * agents, its platform's; on one that runs them either way, its
         * sandboxed alternative's for an agent that ran in one, whichever way
         * it runs them now, and none for one that ran directly, whose folder
         * the device's own check reads, as it always has.
         */
        const vmOf = (agentId: string, checkoutPath: string) =>
          Effect.gen(function* () {
            if (given.sandboxed === undefined) return platform.sandbox;
            const ran = yield* ranAs(agentId, checkoutPath);
            return Option.exists(ran, (mode) => mode === DEVICE_ISOLATION.SANDBOX)
              ? given.sandboxed.sandbox
              : undefined;
          });

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
            // Note that a host's command reads the agent's GitHub sign-in as its runner does, never the token itself.
            const env = {
              ...shellVariables,
              TMPDIR: path.join(layout.folder, TEMP_FOLDER),
              ...(platform.githubFromLuke && platform.sandbox === undefined
                ? githubEnvironment(layout.githubConfig, platform.bundled.gh ?? "gh")
                : undefined),
            };
            // Note that a sandboxed agent's command runs in its VM, never on the device, since its worktree is the agent's to rig.
            const sandbox = platform.sandbox;
            const inVm =
              sandbox === undefined
                ? undefined
                : {
                    woken: vmHeld(sandbox, claimed.agentId, sandbox.woken(claimed.agentId)),
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

        /** The beats, for as long as the gate stands and the account signed in is the one the follow is for; it returns once either changes. */
        /**
         * The beats, each saying which harnesses the Mac is signed in to, for
         * as long as the gate stands and the account signed in is the one
         * the follow is for; it returns once either changes. A sign-in is
         * checked again every `SIGN_IN_EVERY` only while the last check found
         * one, so a sign-out is heard; a Mac found signed out is checked again
         * only as the gate next opens, because the check reads the Keychain,
         * and a developer who declined its prompt must not be asked again on
         * every beat.
         */
        const presence = Effect.gen(function* () {
          let signedIn = checkedSignIn;
          let sinceBeat = Duration.toMillis(BEAT_EVERY);
          let sinceCheck = 0;
          let registeredCodex = yield* Ref.get(codex);
          // Note that the follow ends once the platform turns, so the next registers the device the other way.
          while (
            (yield* gateOpen) &&
            dependencies.accountId() === userId &&
            (yield* platformNow) === platform
          ) {
            // A Codex had since the Mac registered is registered now, with its sign-in, so Start offers it.
            const hadCodex = yield* Ref.get(codex);
            if (Option.getOrUndefined(hadCodex) !== Option.getOrUndefined(registeredCodex)) {
              signedIn = yield* signedInNow(platform, had, shellVariables);
              if (yield* asked(registered(signedIn))) registeredCodex = hadCodex;
              sinceCheck = 0;
            }
            if (
              Object.values(signedIn).some((each) => each === true) &&
              sinceCheck >= Duration.toMillis(SIGN_IN_EVERY)
            ) {
              signedIn = yield* signedInNow(platform, had, shellVariables);
              sinceCheck = 0;
              sinceBeat = Duration.toMillis(BEAT_EVERY);
            }
            if (sinceBeat >= Duration.toMillis(BEAT_EVERY)) {
              yield* asked(client.beat(deviceId, signedIn));
              sinceBeat = 0;
            }
            yield* Effect.sleep(IDLE);
            sinceBeat += Duration.toMillis(IDLE);
            sinceCheck += Duration.toMillis(IDLE);
          }
        });

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        // Note that Codex is had as the gate opens, off the follow, since a fetch takes far longer than a beat.
        yield* Effect.forkScoped(codexHad(platform));
        yield* presence;
      });

    /**
     * One turn of the loop: with the gate shut, a rest; with it open, the
     * Mac registered, every launch it kept from a runner that ended with the
     * app or the gate settled as gone, and the account's agents followed
     * until the gate shuts or the account changes, when the follow's scope
     * closes and every runner it started is stopped with its group.
     */
    const turn = Effect.gen(function* () {
      const userId = dependencies.accountId();
      if (!(yield* gateOpen) || userId === undefined || Option.isNone(home)) {
        // A gate shut lets the next opening fetch the tools again, where they were not had.
        yield* Ref.set(fetchTried, false);
        return yield* Effect.sleep(IDLE);
      }
      const platform = yield* platformNow;
      // Note that the Mac registers only once it has what a runner runs on, so Start never offers a Mac that cannot run one.
      const had = yield* toolsForOpening(platform);
      if (Option.isNone(had)) return yield* Effect.sleep(IDLE);
      // Note that a sandboxed device's Codex is the VM's, had at once, so it registers with its first registration.
      if (platform.sandbox !== undefined) yield* codexHad(platform);
      const deviceId = yield* deviceOf(userId);
      const shellVariables = yield* shellEnvironment;
      const signedIn = yield* signedInNow(platform, had.value, shellVariables);
      /** The Mac registered, with the Codex it checked where it has one, its sign-ins given, and the lines beyond the first it takes. */
      const registration = (said: DeviceSignedIn) =>
        Effect.flatMap(Ref.get(codex), (checked) =>
          client.register(deviceId, {
            name: platform.deviceName,
            platform: platform.devicePlatform,
            arch: platform.deviceArch,
            isolation: platform.deviceIsolation,
            home: home.value,
            claudeExecutable: had.value.claude,
            codexExecutable: Option.getOrUndefined(checked),
            signedIn: said,
            capabilities: platform.deviceCapabilities,
          }),
        );
      const registered = yield* asked(registration(signedIn));
      if (!registered) return yield* Effect.sleep(IDLE);
      const left = (yield* Ref.get(state)).launches.filter((launch) => launch.userId === userId);
      for (const launch of left) {
        if (yield* asked(client.settleLine(deviceId, launch.id))) yield* forgetLaunch(launch.id);
      }
      yield* Effect.scoped(
        follow(
          platform,
          userId,
          deviceId,
          home.value,
          shellVariables,
          had.value,
          signedIn,
          registration,
        ),
      );
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

    const methods: PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.LOCAL_AGENTS> = {};
    return { methods, lifetime } satisfies LocalAgentsComposer;
  });
}
