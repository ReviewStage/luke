import type {
  DeviceAgentBeat,
  DeviceAgentClaimedLine,
  DeviceAgentDevice,
  DeviceAgentUpdate,
  HostedDeviceAgentClient,
} from "@repo/features";
import { DEVICE_BEAT } from "@repo/features/agent-wire";
import {
  CHECKOUT_IDENTITY_SCRIPT,
  type CheckoutIdentity,
  checkoutIdentityEnv,
} from "@repo/features/checkout-identity";
import {
  DEVICE_AGENT_LINE_KIND,
  DEVICE_GITHUB_ACCESS,
  DEVICE_LAUNCH_STEP,
  DEVICE_LAUNCH_UNSTARTED,
  DEVICE_SETUP,
  type DeviceAgentLaunchSecrets,
  type DeviceAgentLayout,
  type DeviceAgentLine,
  type DeviceAgentRelease,
  type DeviceAgentRequest,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
  deviceAgentFilesPayloadSchema,
  deviceAgentLaunchPayloadSchema,
  deviceAgentLayout,
  deviceAgentStdinPayloadSchema,
  deviceAgentsFolder,
} from "@repo/features/device-agent-wire";
import { GITHUB_TOKEN_REFRESH } from "@repo/features/host-wire";
import {
  Clock,
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
import type { Composer } from "./composer.js";
import { Environment, LocalAgentPlatform, Reporter } from "./effect/seams.js";
import type { HostKernel } from "./host-kernel.js";
import {
  AGENT_GIT_HELPER_SCRIPT,
  agentFoldersMade,
  agentGitHelperEnv,
  agentGithubEnv,
  agentGithubForgotten,
  agentGithubWritten,
  agentOnBox,
  agentOwnSignInWritten,
} from "./local-agent-box.js";
import { LAUNCH_NOTE, notedFirstLines, sessionResumed } from "./local-agent-first-lines.js";
import { answeredLocalAgentRequest } from "./local-agent-requests.js";
import { forgetOwnedAgent, keepOwnedAgent, ownedAgents } from "./local-agent-state.js";

const IDLE = Duration.seconds(5);
const SETUP_RETRY = Duration.minutes(1);
const BEAT_EVERY = Duration.millis(DEVICE_BEAT.EVERY_MS);
const BEAT_DEADLINE = Duration.seconds(5);
const REREAD = Duration.seconds(2);
const CLAIM_RETRY = { every: Duration.seconds(1), times: 5 } as const;
const KILL_GRACE = Duration.seconds(3);
const WORKTREE_DEADLINE = Duration.minutes(25);
const NOT_STARTED = 1;
const GITHUB_TOKEN_CHECK = Duration.minutes(1);
const SIGN_IN_CHECK_DEADLINE = Duration.minutes(2);

const VARIABLE = {
  HOME: "HOME",
  SHELL: "SHELL",
  USER: "USER",
  LOGNAME: "LOGNAME",
  LANG: "LANG",
  PATH: "PATH",
  SSH_AUTH_SOCK: "SSH_AUTH_SOCK",
} as const;

const HANDED_ON = [VARIABLE.HOME, VARIABLE.SHELL, VARIABLE.USER, VARIABLE.LOGNAME, VARIABLE.LANG];

type DeviceSetupRegister = Pick<DeviceAgentDevice, "setup" | "setupFailure">;

const decodeLaunch = Schema.decodeUnknownOption(deviceAgentLaunchPayloadSchema);
const decodeStdin = Schema.decodeUnknownOption(deviceAgentStdinPayloadSchema);
const decodeFiles = Schema.decodeUnknownOption(deviceAgentFilesPayloadSchema);

type LocalAgentClient = Pick<
  HostedDeviceAgentClient,
  | "register"
  | "beat"
  | "lines"
  | "claimLine"
  | "lineStep"
  | "settleLine"
  | "requests"
  | "claimRequest"
  | "answerRequest"
  | "githubToken"
>;

export interface LocalAgentsUpdate {
  readonly beating: Effect.Effect<DeviceAgentUpdate | undefined>;
  readonly heard: (release: DeviceAgentRelease | undefined) => Effect.Effect<void>;
  readonly waiting: Effect.Effect<boolean>;
  readonly switched: (beat: Effect.Effect<unknown>) => Effect.Effect<boolean>;
}

export interface LocalAgentsDependencies {
  kernel: Pick<HostKernel, "stateRoot" | "createId">;
  deviceId: string;
  switchedOn: Effect.Effect<boolean>;
  client: LocalAgentClient;
  update?: LocalAgentsUpdate | undefined;
}

interface Runner {
  readonly lineId: string;
  readonly stdin: Queue.Queue<string>;
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly exited: Fiber.Fiber<void>;
}

interface HeardBeat {
  readonly beat: DeviceAgentBeat;
  readonly ran: ReadonlyMap<string, Runner>;
  readonly knew: ReadonlySet<string>;
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
    const sshAgent = Option.match(
      yield* Effect.orDie(Config.option(Config.String(VARIABLE.SSH_AUTH_SOCK)).parse(environment)),
      {
        onNone: (): Readonly<Record<string, string>> => ({}),
        onSome: (socket) => ({ [VARIABLE.SSH_AUTH_SOCK]: socket }),
      },
    );
    const { kernel, deviceId, switchedOn, client } = dependencies;

    const tempEmptied = (layout: DeviceAgentLayout) =>
      Effect.gen(function* () {
        if (!(yield* fileSystem.exists(layout.folder))) return;
        yield* fileSystem.remove(layout.temp, { recursive: true, force: true });
        yield* fileSystem.makeDirectory(layout.temp, { recursive: true, mode: 0o700 });
      }).pipe(Effect.ignore);

    const turnLetGo = (layout: DeviceAgentLayout) =>
      Effect.gen(function* () {
        yield* agentGithubForgotten(layout.folder);
        yield* tempEmptied(layout);
      });

    const asked = <A>(call: Effect.Effect<A, never, HttpClient.HttpClient>) =>
      Effect.provideContext(call, services);

    const gateOpen = Effect.map(switchedOn, (on) => on && Option.isSome(home));

    const beat = Effect.flatMap(
      dependencies.update?.beating ?? Effect.succeed(undefined),
      (updating) => asked(client.beat(deviceId, updating)),
    );

    const timedBeat = <A>(beat: Effect.Effect<A | undefined>) =>
      Effect.map(Effect.timeoutOption(beat, BEAT_DEADLINE), Option.getOrUndefined);

    const presence = (beaten: Effect.Effect<unknown> = timedBeat(beat)) =>
      Effect.scoped(
        Effect.gen(function* () {
          if (!(yield* gateOpen)) return;
          yield* Effect.forkScoped(Effect.repeat(beaten, Schedule.fixed(BEAT_EVERY)));
          for (;;) {
            yield* Effect.sleep(IDLE);
            if (!(yield* gateOpen)) return;
          }
        }),
      );

    const readyForOpening = (
      registered: (
        setup: DeviceSetupRegister,
      ) => Effect.Effect<boolean, never, HttpClient.HttpClient>,
    ) =>
      Effect.gen(function* () {
        for (;;) {
          const ready = yield* Effect.scoped(
            Effect.gen(function* () {
              const scope = yield* Effect.scope;
              const preparing = asked(registered({ setup: DEVICE_SETUP.PREPARING })).pipe(
                Effect.andThen(Effect.forkIn(presence(), scope)),
                Effect.asVoid,
              );
              return yield* Effect.result(platform.clis.ready(preparing));
            }),
          );
          if (Result.isSuccess(ready)) return true;
          report(`the local agents' setup failed: ${ready.failure.detail}`);
          yield* asked(
            registered({ setup: DEVICE_SETUP.FAILED, setupFailure: ready.failure.detail }),
          );
          const waited = yield* Effect.race(
            Effect.as(presence(), false),
            Effect.as(Effect.sleep(SETUP_RETRY), true),
          );
          if (!waited) return false;
        }
      });

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

    const follow = (folder: string, shellVariables: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const workers = yield* FiberMap.make<string>();
        const mailboxes = new Map<string, Queue.Queue<DeviceAgentClaimedLine>>();
        const runners = new Map<string, Runner>();
        const starting = new Set<string>();
        const claiming = yield* Semaphore.make(1);
        const stopping = yield* FiberSet.make();
        let paused = false;
        let undelivered = 0;

        const answering = yield* FiberSet.make();

        const settle = (id: string, exitCode?: number) =>
          asked(client.settleLine(deviceId, id, exitCode));

        const stepReported = (agentScope: Scope.Scope, id: string, step: DeviceLaunchStep) =>
          Effect.asVoid(Effect.forkIn(asked(client.lineStep(deviceId, id, step)), agentScope));

        const notStarted = (id: string, unstarted?: DeviceLaunchUnstarted) =>
          asked(client.settleLine(deviceId, id, NOT_STARTED, unstarted));

        const madeWorktree = (
          layout: DeviceAgentLayout,
          repository: string | null,
          branch: string | null,
          github: Readonly<Record<string, string>> | undefined,
          fetching: Effect.Effect<void>,
        ) =>
          Effect.gen(function* () {
            if (yield* fileSystem.exists(path.join(layout.checkoutPath, ".git"))) return true;
            if (repository === null) {
              yield* fileSystem.makeDirectory(layout.checkoutPath, { recursive: true });
              return true;
            }
            yield* fetching;
            const script = platform.worktreeScript({
              home: folder,
              repository,
              worktree: layout.checkoutPath,
              branch,
            });
            const finished = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make("/bin/bash", ["-c", script], {
                  cwd: folder,
                  ...(github === undefined ? undefined : { env: { ...github }, extendEnv: true }),
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                }),
                (handle) => handle.exitCode,
              ),
            ).pipe(Effect.timeoutOption(WORKTREE_DEADLINE));
            if (Option.isNone(finished)) {
              report(
                `a local agent's repository was not made within ${Duration.toMinutes(WORKTREE_DEADLINE)} minutes, so its launch was given up`,
              );
              return false;
            }
            return Number(finished.value) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        const checkoutSet = (
          layout: DeviceAgentLayout,
          identity: CheckoutIdentity | undefined,
          withHelper: boolean,
        ) => {
          const script = [
            ...(identity === undefined ? [] : [CHECKOUT_IDENTITY_SCRIPT]),
            ...(withHelper ? [AGENT_GIT_HELPER_SCRIPT] : []),
            "true",
          ].join("\n");
          const env = {
            ...shellVariables,
            ...(identity === undefined ? {} : checkoutIdentityEnv(identity)),
            ...(withHelper ? agentGitHelperEnv(platform.clis.paths.gh) : {}),
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

        const ownSignInReaches = (layout: DeviceAgentLayout, repository: string) =>
          Effect.gen(function* () {
            yield* agentFoldersMade(layout.folder, {
              stateRoot: kernel.stateRoot,
              platform: platform.devicePlatform,
            });
            yield* agentOwnSignInWritten(layout.folder, folder);
            const run = agentOnBox(
              {
                folder: layout.folder,
                command: "/bin/bash",
                args: ["-c", platform.repositoryReachedScript(repository)],
                env: { ...shellVariables, ...sshAgent },
              },
              platform.clis.paths.gh,
            );
            const code = yield* Effect.scoped(
              Effect.flatMap(
                ChildProcess.make(run.command, [...run.args], {
                  cwd: layout.folder,
                  env: run.env,
                  extendEnv: false,
                  stdin: "ignore",
                  stdout: "ignore",
                  stderr: "ignore",
                  forceKillAfter: KILL_GRACE,
                }),
                (handle) => handle.exitCode,
              ),
            ).pipe(Effect.timeoutOption(SIGN_IN_CHECK_DEADLINE));
            return Option.isSome(code) && Number(code.value) === 0;
          }).pipe(Effect.orElseSucceed(() => false));

        const workExists = (layout: DeviceAgentLayout, withRepository: boolean) =>
          Effect.orElseSucceed(
            fileSystem.exists(
              withRepository ? path.join(layout.checkoutPath, ".git") : layout.checkoutPath,
            ),
            () => false,
          );

        const launched = (
          agentId: string,
          line: DeviceAgentLine,
          secrets: DeviceAgentLaunchSecrets | undefined,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const layout = deviceAgentLayout(folder, agentId);
            const payload = decodeLaunch(line.payload);
            if (
              Option.isNone(payload) ||
              secrets === undefined ||
              payload.value.checkoutPath !== layout.checkoutPath
            ) {
              return yield* notStarted(line.id);
            }
            const { repository } = payload.value;
            const withRepository = repository !== null;
            const onOwnSignIn =
              withRepository && payload.value.githubAccess === DEVICE_GITHUB_ACCESS.TOKEN;
            const withToken = withRepository && !onOwnSignIn;
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            const cleared =
              sessionResumed(secrets.stdin) && !(yield* workExists(layout, withRepository));
            if (cleared) {
              report("a local agent's folder was cleared since its last turn, so it starts afresh");
            }
            const hadToken = withToken && (yield* gaveGithubToken(agentId));
            if (onOwnSignIn && !(yield* ownSignInReaches(layout, repository))) {
              report(
                "a local agent's repository is not reached on this machine's own GitHub sign-in, so its launch was not started",
              );
              return yield* notStarted(line.id, DEVICE_LAUNCH_UNSTARTED.GITHUB_SIGN_IN);
            }
            const made = yield* madeWorktree(
              layout,
              repository,
              payload.value.startBranch,
              withToken ? agentGithubEnv(layout.folder, platform.clis.paths.gh) : undefined,
              stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.FETCHING),
            );
            if (!made) {
              yield* agentGithubForgotten(layout.folder);
              return yield* notStarted(line.id);
            }
            yield* stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.STARTING);
            const temp = layout.temp;
            yield* Effect.ignore(fileSystem.makeDirectory(temp, { recursive: true, mode: 0o700 }));
            const runnerScope = yield* Scope.fork(agentScope);
            const refused = yield* Scope.addFinalizer(
              runnerScope,
              Effect.provideContext(turnLetGo(layout), services),
            ).pipe(
              Effect.andThen(
                agentFoldersMade(layout.folder, {
                  stateRoot: kernel.stateRoot,
                  platform: platform.devicePlatform,
                }),
              ),
              Effect.as(Option.none<string>()),
              Effect.orElseSucceed(() => Option.some("the agent's folders could not be made")),
            );
            if (Option.isSome(refused)) {
              yield* Scope.close(runnerScope, Exit.void);
              report(`a local agent could not be readied to start: ${refused.value}`);
              return yield* notStarted(line.id);
            }
            if (
              withRepository &&
              !(yield* checkoutSet(layout, payload.value.identity, withToken))
            ) {
              yield* Scope.close(runnerScope, Exit.void);
              report(
                "a local agent's commit identity or GitHub helper could not be set in its repository",
              );
              return yield* notStarted(line.id);
            }
            const stdin = yield* Queue.unbounded<string>();
            const encoder = new TextEncoder();
            const command = platform.launch({
              agentId,
              folder: layout.folder,
              checkout: layout.checkoutPath,
              node: platform.tools.node,
              bundle: platform.runnerBundle,
              env: {
                ...shellVariables,
                ...(onOwnSignIn ? sshAgent : {}),
                TMPDIR: temp,
                ...platform.runnerEnv,
                ...secrets.env,
              },
            });
            const started = yield* ChildProcess.make(command.command, [...command.args], {
              cwd: layout.checkoutPath,
              env: command.env,
              extendEnv: false,
              stdin: {
                stream: Stream.fromQueue(stdin).pipe(Stream.map((text) => encoder.encode(text))),
                endOnDone: false,
              },
              stdout: "ignore",
              stderr: "ignore",
              forceKillAfter: KILL_GRACE,
            }).pipe(Scope.provide(runnerScope), Effect.option);
            if (Option.isNone(started)) {
              yield* Scope.close(runnerScope, Exit.void);
              return yield* notStarted(line.id);
            }
            const handle = started.value;
            if (withToken) yield* Effect.forkIn(renewingGithub(agentId, hadToken), runnerScope);
            yield* Queue.offer(
              stdin,
              notedFirstLines(secrets.stdin, cleared ? [LAUNCH_NOTE.CLEARED] : [], cleared),
            );
            const exited = yield* Effect.gen(function* () {
              const code = yield* Effect.option(handle.exitCode);
              runners.delete(agentId);
              starting.add(line.id);
              yield* Scope.close(runnerScope, Exit.void).pipe(
                Effect.andThen(settle(line.id, Option.getOrUndefined(Option.map(code, Number)))),
                Effect.ensuring(Effect.sync(() => starting.delete(line.id))),
              );
            }).pipe(Effect.forkIn(agentScope));
            runners.set(agentId, { lineId: line.id, stdin, handle, exited });
          });

        const ended = (runner: Runner) =>
          Effect.gen(function* () {
            yield* Effect.ignore(runner.handle.kill({ forceKillAfter: KILL_GRACE }));
            yield* Fiber.await(runner.exited);
          });

        const stopped = (agentId: string) =>
          Effect.gen(function* () {
            const runner = runners.get(agentId);
            if (runner === undefined) return;
            yield* ended(runner);
          });

        const folderRemoved = (layout: DeviceAgentLayout) =>
          Effect.gen(function* () {
            const link = yield* Effect.option(
              fileSystem.readFileString(path.join(layout.checkoutPath, ".git")),
            );
            yield* fileSystem.remove(layout.folder, { recursive: true, force: true });
            const linked = Option.flatMap(link, (text) =>
              Option.fromNullishOr(/^gitdir: (.+)$/mu.exec(text)?.[1]),
            );
            if (Option.isNone(linked)) return;
            const shared = path.resolve(layout.checkoutPath, linked.value, "..", "..");
            yield* Effect.ignore(
              Effect.scoped(
                Effect.flatMap(
                  ChildProcess.make("git", ["worktree", "prune"], {
                    cwd: shared,
                    env: shellVariables,
                    extendEnv: false,
                    stdin: "ignore",
                    stdout: "ignore",
                    stderr: "ignore",
                    forceKillAfter: KILL_GRACE,
                  }),
                  (handle) => handle.exitCode,
                ),
              ),
            );
          });

        const discarded = (agentId: string) =>
          Effect.gen(function* () {
            yield* stopped(agentId);
            yield* folderRemoved(deviceAgentLayout(folder, agentId));
            yield* forgetOwnedAgent(kernel.stateRoot, agentId);
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report(`a local agent's folder could not be removed: ${agentId}`)),
            ),
          );

        const wroteFiles = (agentId: string, payload: unknown) =>
          Effect.gen(function* () {
            const files = decodeFiles(payload);
            if (Option.isNone(files)) return;
            yield* keepOwnedAgent(kernel.stateRoot, agentId);
            const layout = deviceAgentLayout(folder, agentId);
            for (const file of files.value.files) {
              const target = path.normalize(file.path);
              if (!target.startsWith(`${layout.folder}/`)) continue;
              yield* fileSystem.makeDirectory(path.dirname(target), {
                recursive: true,
                mode: 0o700,
              });
              yield* fileSystem.writeFile(target, file.contents, { mode: file.mode });
              yield* fileSystem.chmod(target, file.mode);
            }
          }).pipe(
            Effect.catch(() =>
              Effect.sync(() => report("a local agent's files could not be written")),
            ),
          );

        const delivered = (
          agentId: string,
          claimed: DeviceAgentClaimedLine,
          agentScope: Scope.Scope,
        ) =>
          Effect.gen(function* () {
            const { line } = claimed;
            switch (line.kind) {
              case DEVICE_AGENT_LINE_KIND.LAUNCH:
                return yield* Effect.gen(function* () {
                  if (claimed.secretsGone !== true) {
                    yield* stepReported(agentScope, line.id, DEVICE_LAUNCH_STEP.PREPARING);
                  }
                  yield* stopped(agentId);
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

        const handedOver = (claimed: DeviceAgentClaimedLine) =>
          Effect.gen(function* () {
            if (claimed.line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH) starting.add(claimed.line.id);
            undelivered += 1;
            yield* Queue.offer(yield* mailboxOf(claimed.line.agentId), claimed);
          });

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
                  yield* delivered(agentId, claimed, agentScope).pipe(
                    Effect.ensuring(
                      Effect.sync(() => {
                        undelivered -= 1;
                      }),
                    ),
                  );
                }
              }),
            );
            yield* FiberMap.run(workers, agentId, worker);
            return mailbox;
          });

        const claimTokens = new Map<string, string>();

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

        const answered = (request: DeviceAgentRequest) =>
          Effect.gen(function* () {
            if (paused) return;
            const claimed = yield* asked(client.claimRequest(deviceId, request.id));
            if (claimed === undefined || !("agentId" in claimed)) return;
            const layout = deviceAgentLayout(folder, claimed.agentId);
            const answer = yield* answeredLocalAgentRequest(layout, claimed).pipe(
              Effect.provideContext(services),
            );
            yield* asked(client.answerRequest(deviceId, claimed.id, answer));
          });

        const requestsFollowed = Effect.forever(
          Effect.gen(function* () {
            if (paused) return yield* Effect.sleep(REREAD);
            const requests = yield* asked(client.requests(deviceId));
            if (requests === undefined) return yield* Effect.sleep(REREAD);
            for (const request of requests) yield* FiberSet.run(answering, answered(request));
          }),
        );

        const runningLaunches = () => new Set([...runners.values()].map((runner) => runner.lineId));

        const heardBeat = Effect.gen(function* () {
          const ran: ReadonlyMap<string, Runner> = new Map(runners);
          const knew: ReadonlySet<string> = new Set([...starting, ...runningLaunches()]);
          const answer = yield* beat;
          return answer === undefined
            ? undefined
            : ({ beat: answer, ran, knew } satisfies HeardBeat);
        });

        const reconciledBeat = (heard: HeardBeat | undefined) =>
          Effect.gen(function* () {
            if (heard === undefined) return;
            const open = new Set(heard.beat.openLaunches);
            for (const [agentId, runner] of heard.ran) {
              if (open.has(runner.lineId) || runners.get(agentId) !== runner) continue;
              report(
                "a local agent's runner was stopped, since the service no longer holds it here",
              );
              yield* FiberSet.run(stopping, ended(runner));
            }
            const unknown = [...open].filter((id) => !heard.knew.has(id));
            if (unknown.length === 0) return;
            yield* claiming.withPermit(
              Effect.forEach(
                unknown,
                (id) => (starting.has(id) || runningLaunches().has(id) ? Effect.void : settle(id)),
                { discard: true },
              ),
            );
          });

        const idle = Effect.map(
          FiberSet.size(answering),
          (requests) =>
            runners.size === 0 && starting.size === 0 && undelivered === 0 && requests === 0,
        );

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
            if (!(yield* update.switched(beat))) paused = false;
          });

        const followedBeat = (heard: HeardBeat | undefined) =>
          Effect.gen(function* () {
            yield* reconciledBeat(heard);
            const { update } = dependencies;
            if (update === undefined || heard === undefined) return;
            yield* update.heard(heard.beat.release);
            if (yield* update.waiting) yield* switchedWhileIdle(update);
          });

        yield* Effect.forkScoped(linesFollowed);
        yield* Effect.forkScoped(requestsFollowed);
        const latest = yield* Queue.sliding<HeardBeat | undefined>(1);
        const told = Effect.flatMap(timedBeat(heardBeat), (heard) => Queue.offer(latest, heard));
        const reconciling = Effect.forever(Effect.flatMap(Queue.take(latest), followedBeat));
        yield* Effect.raceFirst(presence(told), Effect.provideContext(reconciling, services));
      });

    const turn = Effect.gen(function* () {
      if (!(yield* gateOpen) || Option.isNone(home)) {
        return yield* Effect.sleep(IDLE);
      }
      yield* openTurn(home.value);
    });

    const openTurn = (folder: string) =>
      Effect.gen(function* () {
        const { tools } = platform;
        const registered = (setup: DeviceSetupRegister) =>
          client.register(deviceId, {
            name: platform.deviceName,
            platform: platform.devicePlatform,
            arch: platform.deviceArch,
            ...platform.deviceMachine,
            home: folder,
            agentsFolder: deviceAgentsFolder(folder),
            claudeExecutable: tools.claude,
            codexExecutable: tools.codex,
            capabilities: platform.deviceCapabilities,
            ...setup,
          });
        if (!(yield* readyForOpening(registered))) {
          return yield* Effect.sleep(IDLE);
        }
        const shellVariables = yield* shellEnvironment;
        if (!(yield* asked(registered({})))) return yield* Effect.sleep(IDLE);
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.forkScoped(presence());
            for (const agentId of yield* ownedAgents(kernel.stateRoot)) {
              yield* turnLetGo(deviceAgentLayout(folder, agentId));
            }
          }),
        );
        yield* Effect.scoped(follow(folder, shellVariables));
      });

    const lifetime = Effect.gen(function* () {
      const guarded = Effect.catchDefect(Effect.provideContext(turn, services), () =>
        Effect.andThen(
          Effect.sync(() => report("the local agents' follow failed")),
          Effect.sleep(IDLE),
        ),
      );
      yield* Effect.forkScoped(Effect.forever(guarded));
    });

    const methods: Composer["methods"] = {};
    return { methods, lifetime } satisfies Composer;
  });
}
