import { CLAUDE_CODE_MAC_PIN, NODE_MAC_PIN } from "@luke/agent-runner/pins";
import type { HostedMacAgentClient, MacAgentClaimedLine } from "@luke/features";
import {
  MAC_AGENT_LINE_KIND,
  type MacAgentLaunchSecrets,
  type MacAgentLayout,
  type MacAgentLine,
  type MacAgentRequest,
  type MacSignedIn,
  macAgentFilesPayloadSchema,
  macAgentLaunchPayloadSchema,
  macAgentLayout,
  macAgentStdinPayloadSchema,
} from "@luke/features/mac-agent-wire";
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
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import { localAgentTool } from "./local-agent-tools.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-local-agents.ts -- runs on this Mac the coding agents the account starts on This Mac: their runners started, fed, and stopped as the service's lines say, and their tools' reads and commands answered, for as long as the Local agents experiment and Settings › This Mac's Run agents on this Mac are both on.
 *
 * The service writes a local agent's work as rows under this Mac's device
 * id (`@luke/features/mac-agent-wire`, `contract/mac-agents.ts`): lines for
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
 * the credential, made under the environment a runner starts with. It holds
 * one read for its lines and one for its requests, each answered by the
 * service as soon as one waits, and claims each by its id.
 *
 * Lines are claimed in the order the service lists them, its id order, and
 * handed to the agent they name, whose worker takes them one at a time, so
 * an agent's lines are delivered strictly in order while agents go on side
 * by side. A launch makes the agent's worktree under its folder
 * (`macAgentLayout`) where it has none, through the platform's script over
 * Luke's shared clone and the developer's own Git login, and starts the
 * runner as the leader of a process group of its own, with the claim's
 * secrets in its environment and nowhere else, never a file, an argument,
 * or a log, and its first lines on its stdin; its line is settled with the
 * runner's exit code once it exits. A message or retune line is written to
 * the running runner's stdin; a files line writes its files under the
 * agent's folder; a stop line ends the runner's group. A launch whose
 * worktree could not be made is settled with the script's failure, and the
 * runner never starts.
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

/** What the host keeps of local agents between runs: the device id each account registered under, and the launches whose runners this Mac started and no exit has settled yet. */
const LocalAgentStateSchema = Schema.Struct({
  devices: Schema.Record(Schema.String, Schema.String),
  launches: Schema.Array(Schema.Struct({ userId: Schema.String, id: Schema.String })),
});

type LocalAgentState = typeof LocalAgentStateSchema.Type;

const NO_STATE: LocalAgentState = { devices: {}, launches: [] };

const decodeState = Schema.decodeUnknownOption(Schema.fromJsonString(LocalAgentStateSchema));
const encodeState = Schema.encodeSync(Schema.fromJsonString(LocalAgentStateSchema));
const decodeLaunch = Schema.decodeUnknownOption(macAgentLaunchPayloadSchema);
const decodeStdin = Schema.decodeUnknownOption(macAgentStdinPayloadSchema);
const decodeFiles = Schema.decodeUnknownOption(macAgentFilesPayloadSchema);
const decodeAuthStatus = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ authMethod: Schema.String })),
);

/** The service's side of local agents, as this concern asks it. */
type LocalAgentClient = Pick<
  HostedMacAgentClient,
  | "register"
  | "beat"
  | "lines"
  | "claimLine"
  | "settleLine"
  | "requests"
  | "claimRequest"
  | "answerRequest"
>;

export interface LocalAgentsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "createId"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  /** The account signed in now, by its id; none where nobody is. */
  accountId: () => string | undefined;
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

    /** The device id this account registers under on this Mac, minted the first time. */
    const deviceOf = (userId: string) =>
      Effect.gen(function* () {
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

    const forgetLaunch = (id: string) =>
      updateState((current) => ({
        ...current,
        launches: current.launches.filter((launch) => launch.id !== id),
      }));

    // -- the tools a runner runs on ------------------------------------------------

    /** The Node and Claude Code CLI this Mac's runners run on, once had, and whether a fetch was tried since the gate last opened. */
    const tools = yield* Ref.make(Option.none<LocalAgentTools>());
    const fetchTried = yield* Ref.make(false);
    const fetching = yield* Semaphore.make(1);

    /**
     * The Node and the Claude Code CLI this Mac's runners run on: the ones
     * had already, where both still stand, or each had now through its pin
     * (`localAgentTool`), the app's or the checkout's own copy first; none
     * where either cannot be had. One at a time, so two asks never fetch the
     * same release twice.
     */
    const toolsHad = fetching.withPermit(
      Effect.gen(function* () {
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
            localAgentTool(kernel.stateRoot, NODE_MAC_PIN, platform.bundled.node),
            localAgentTool(kernel.stateRoot, CLAUDE_CODE_MAC_PIN, platform.bundled.claude),
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
    const toolsForOpening = Effect.gen(function* () {
      const had = yield* Ref.get(tools);
      if (Option.isSome(had)) return yield* toolsHad;
      if (yield* Ref.getAndSet(fetchTried, true)) return Option.none<LocalAgentTools>();
      const fetched = yield* toolsHad;
      if (Option.isNone(fetched)) report("the local agents' Node or Claude Code could not be had");
      return fetched;
    });

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

    /** Which harnesses this Mac is signed in to by itself, each checked as its own CLI answers. */
    const signedInNow = (had: LocalAgentTools, env: Readonly<Record<string, string>>) =>
      Effect.map(
        claudeCodeSignedIn(had.claude, env),
        (claudeCode): MacSignedIn => ({ claudeCode }),
      );

    // -- one account's follow --------------------------------------------------

    /** Everything one open gate runs for the account `userId` names, on the device it registered, from its home folder. */
    const follow = (
      userId: string,
      deviceId: string,
      folder: string,
      shellVariables: Readonly<Record<string, string>>,
      had: LocalAgentTools,
      checkedSignIn: MacSignedIn,
    ) =>
      Effect.gen(function* () {
        const workers = yield* FiberMap.make<string>();
        const mailboxes = new Map<string, Queue.Queue<MacAgentClaimedLine>>();
        const runners = new Map<string, Runner>();
        const answering = yield* FiberSet.make();

        const settle = (id: string, exitCode?: number) =>
          asked(client.settleLine(deviceId, id, exitCode));

        /** The agent's worktree made where it has none: a folder for an agent with no repository, and Luke's shared clone's worktree otherwise. */
        const madeWorktree = (
          layout: MacAgentLayout,
          repository: string | null,
          branch: string | null,
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
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                }),
                (handle) => handle.exitCode,
              ),
            );
            return Number(code) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        /** The runner started for a launch line, its first lines written, and its exit settling the line; the line settled as not started where it cannot be. */
        const launched = (
          agentId: string,
          line: MacAgentLine,
          secrets: MacAgentLaunchSecrets | undefined,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const layout = macAgentLayout(folder, agentId);
            const payload = decodeLaunch(line.payload);
            // Note that a launch naming a worktree outside the agent's own folder is never made.
            if (
              Option.isNone(payload) ||
              secrets === undefined ||
              payload.value.checkoutPath !== layout.checkoutPath
            ) {
              return yield* settle(line.id, NOT_STARTED);
            }
            const made = yield* madeWorktree(
              layout,
              payload.value.repository,
              payload.value.startBranch,
            );
            if (!made) return yield* settle(line.id, NOT_STARTED);
            const temp = path.join(layout.folder, TEMP_FOLDER);
            yield* Effect.ignore(fileSystem.makeDirectory(temp, { recursive: true, mode: 0o700 }));
            const runnerScope = yield* Scope.fork(agentScope);
            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            const started = yield* ChildProcess.make(
              platform.launcher,
              [had.node, platform.runnerBundle],
              {
                cwd: layout.checkoutPath,
                env: {
                  ...shellVariables,
                  TMPDIR: temp,
                  ...platform.runnerEnv,
                  ...secrets.env,
                },
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
              },
            ).pipe(Scope.provide(runnerScope), Effect.option);
            if (Option.isNone(started)) {
              yield* Scope.close(runnerScope, Exit.void);
              return yield* settle(line.id, NOT_STARTED);
            }
            const handle = started.value;
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

        /** The agent's runner, where one runs, stopped with its group and its exit waited for, so its line is settled first. */
        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        /** A files line's files written under the agent's folder, each at its mode; one outside the folder is never written. */
        const wroteFiles = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const files = decodeFiles(payload);
            if (Option.isNone(files)) return;
            const layout = macAgentLayout(folder, agentId);
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

        /** One line of the agent's, delivered: a runner started, written to, or stopped, or files written; every line but a launch settled at once. */
        const delivered = (
          agentId: string,
          claimed: MacAgentClaimedLine,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const { line } = claimed;
            switch (line.kind) {
              case MAC_AGENT_LINE_KIND.LAUNCH:
                // Note that a launch replaces the runner it finds, which is ended and its line settled first.
                yield* stopped(agentId);
                return yield* launched(agentId, line, claimed.secrets, agentScope);
              case MAC_AGENT_LINE_KIND.MESSAGE:
              case MAC_AGENT_LINE_KIND.RETUNE: {
                const text = decodeStdin(line.payload);
                const runner = runners.get(agentId);
                if (Option.isSome(text) && runner !== undefined) {
                  yield* Queue.offer(runner.stdin, text.value.text);
                }
                break;
              }
              case MAC_AGENT_LINE_KIND.FILES:
                yield* wroteFiles(agentId, line.payload);
                break;
              case MAC_AGENT_LINE_KIND.STOP:
                yield* stopped(agentId);
                break;
            }
            yield* settle(line.id);
          });

        /** The agent's mailbox, its worker started the first time a line of its arrives. */
        const mailboxOf = (agentId: string) =>
          Effect.gen(function* () {
            const kept = mailboxes.get(agentId);
            if (kept !== undefined) return kept;
            const mailbox = yield* Queue.unbounded<MacAgentClaimedLine>();
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
        const answered = (request: MacAgentRequest) =>
          Effect.gen(function* () {
            const claimed = yield* asked(client.claimRequest(deviceId, request.id)).pipe(
              Effect.repeat({
                schedule: Schedule.spaced(CLAIM_RETRY.every),
                times: CLAIM_RETRY.times,
                until: (answer) => answer !== undefined,
              }),
            );
            if (claimed === undefined || !("agentId" in claimed)) return;
            const layout = macAgentLayout(folder, claimed.agentId);
            const env = {
              ...shellVariables,
              TMPDIR: path.join(layout.folder, TEMP_FOLDER),
            };
            const answer = yield* answeredLocalAgentRequest(layout, claimed, env).pipe(
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
          while ((yield* gateOpen) && dependencies.accountId() === userId) {
            if (
              Object.values(signedIn).some((each) => each === true) &&
              sinceCheck >= Duration.toMillis(SIGN_IN_EVERY)
            ) {
              signedIn = yield* signedInNow(had, shellVariables);
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
      // Note that the Mac registers only once it has what a runner runs on, so Start never offers a Mac that cannot run one.
      const had = yield* toolsForOpening;
      if (Option.isNone(had)) return yield* Effect.sleep(IDLE);
      const deviceId = yield* deviceOf(userId);
      const shellVariables = yield* shellEnvironment;
      const signedIn = yield* signedInNow(had.value, shellVariables);
      const registered = yield* asked(
        client.register(deviceId, {
          name: platform.deviceName,
          home: home.value,
          claudeExecutable: had.value.claude,
          signedIn,
        }),
      );
      if (!registered) return yield* Effect.sleep(IDLE);
      const left = (yield* Ref.get(state)).launches.filter((launch) => launch.userId === userId);
      for (const launch of left) {
        if (yield* asked(client.settleLine(deviceId, launch.id))) yield* forgetLaunch(launch.id);
      }
      yield* Effect.scoped(
        follow(userId, deviceId, home.value, shellVariables, had.value, signedIn),
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
