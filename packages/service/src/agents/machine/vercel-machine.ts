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
import { Brand, type Context, Duration, Effect, Layer, Option, Result, Schedule } from "effect";
import type { HttpClient } from "effect/http";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import {
  AGENT_DRIVE,
  AGENT_DRIVE_FROM,
  type AgentDrive,
  type AgentDriveFrom,
  agentDrive,
} from "../agent-drive.js";
import { type BaseDriveOf, fillBaseDrive, installDependencies } from "../base-drive.js";
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
  type FirewallSession,
  type FirewallSources,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import {
  IMAGE_NOT_READY,
  type ListedSandbox,
  NAME_TAKEN,
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
  type RunnerHandle,
  type RunnerMark,
  type RunnerRecord,
} from "./agent-machine.js";

export const AGENT_TAG = "agentId";

const AGENT_TAG_BEFORE_RENAME = "lukeAgent";

export function agentTag(tags: Readonly<Record<string, string>> | undefined): string | undefined {
  return tags?.[AGENT_TAG] ?? tags?.[AGENT_TAG_BEFORE_RENAME];
}

const ATTACHMENT_DIRECTORY = "/tmp/agent-attachments";

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

export const SANDBOX_NAME = "agent-sandbox-";

export const SANDBOX_NAME_BEFORE_RENAME = "luke-agent-";

const RUNNER_SCRIPT = `${RUNNER_DIRECTORY}/agent-runner.mjs`;

const AGENT_HOME_FOLDERS = [CODEX_PIN.HOME];

const SANDBOX_ENV = { NO_COLOR: "1", GH_STACK_NO_UPDATE_NOTIFIER: "1" } as const;

const LINK_TOOLS_DIRECTORY = `if [ -d ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ] && [ ! -e ${SANDBOX_TOOLS_DIRECTORY} ] && [ ! -L ${SANDBOX_TOOLS_DIRECTORY} ]; then ln -s ${SANDBOX_TOOLS_DIRECTORY_BEFORE_RENAME} ${SANDBOX_TOOLS_DIRECTORY}; fi`;

function sharedCheckout(path: string): readonly string[] {
  return [
    `git config --system --get-all safe.directory 2>/dev/null | grep -Fxq ${path} || git config --system --add safe.directory ${path}`,
    `if [ -d ${path}/.git ] && ! git -C ${path} config --get core.sharedRepository | grep -Fxq group; then git -C ${path} config core.sharedRepository group; fi`,
    `chmod -R g+rwX ${path}`,
    `find ${path} -type d -exec chmod g+s {} +`,
  ];
}

function sharedCheckoutsScript(paths: readonly string[]): string {
  return ["set -euo pipefail", ...paths.flatMap(sharedCheckout)].join("\n");
}

const SHARE_WAIT = Duration.minutes(2);

const NOT_SHARED = "the checkouts cloned beside the agent's could not be shared with its runner";

function readyScript(extraCheckouts: readonly string[]): string {
  return [
    "set -euo pipefail",
    LINK_TOOLS_DIRECTORY,
    `if [ -d ${NATIVE_SKILLS_PATH.UPLOAD} ]; then rm -rf ${NATIVE_SKILLS_PATH.INSTALLED} && mkdir -p $(dirname ${NATIVE_SKILLS_PATH.INSTALLED}) && mv ${NATIVE_SKILLS_PATH.UPLOAD} ${NATIVE_SKILLS_PATH.INSTALLED} && chown -R root:root ${NATIVE_SKILLS_PATH.INSTALLED} && chmod -R u=rwX,go=rX ${NATIVE_SKILLS_PATH.INSTALLED}; fi`,
    ...[CODER.CHECKOUT_PATH, ...extraCheckouts].flatMap(sharedCheckout),
    `install -d -o ${AGENT_USER} -g ${AGENT_USER} -m 0755 ${SHARED_FILES_DIRECTORY}`,
  ].join("\n");
}

const NOT_READIED = "the sandbox could not be readied for the agent's runner";

const READ_EXIT = { NO_FILE: 3 } as const;

const READ_SCRIPT = [
  "set -o pipefail",
  `[ -f "$1" ] && [ -r "$1" ] || exit ${READ_EXIT.NO_FILE}`,
  `head -c "$2" -- "$1" | base64 | tr -d '\\n'`,
].join("\n");

const IMAGE_RETRY = {
  SPACED: Duration.seconds(10),
  TIMES: 18,
} as const;

export type SandboxRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

export interface VercelMachineOptions {
  readonly readToken: OidcTokenRead;
  readonly run: SandboxRunner;
}

const runningOfSession = Brand.nominal<MachineRunning>();
const nameOfSandbox = Brand.nominal<MachineName>();

function vercelPlace(session: string, name: string, sandboxSessionId: string): MachinePlace {
  return {
    machine: AGENT_MACHINE.VERCEL,
    session,
    name: nameOfSandbox(name),
    running: runningOfSession(sandboxSessionId),
  };
}

interface OpenedPlace {
  readonly name: string;
  readonly running: string;
}

function sessionOfPlace(place: OpenedPlace): SessionRef {
  return { name: place.name, sessionId: place.running };
}

function firewallSessionOf(place: OpenedPlace, userId: string): FirewallSession {
  return { userId, name: place.name, sandboxSessionId: place.running };
}

function markOf(record: AgentRunnerRecord): RunnerMark {
  return {
    firstSequence: record.firstSequence,
    ...(record.fingerprint === null ? {} : { fingerprint: record.fingerprint }),
    linesRead: true,
  };
}

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

interface KeptPlace {
  readonly userId: string;
}

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
    kept: kept as unknown as MachineKept,
  };
}

function keptOf(found: FoundPlace): KeptPlace {
  return found.kept as unknown as KeptPlace;
}

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

function readFileCommand(path: string, maxBytes: number) {
  return {
    command: "bash",
    args: ["-c", READ_SCRIPT, "read-file", path, String(maxBytes)],
  };
}

export function vercelLifecycle(api: VercelSandboxApi): MachineLifecycle {
  const firewall = sandboxFirewall(api);
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

    discard: (found) =>
      Effect.andThen(
        api.deleteSandbox(found.name),
        forgetAgentRunnerRecord(keptOf(found).userId, found.session, found.name),
      ),

    writeFiles: (place, files) =>
      Effect.flatMap(api.session(sessionOfPlace(place)), (session) => session.writeFiles(files)),

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

export function vercelMachine(api: VercelSandboxApi, run: SandboxRunner): AgentMachineService {
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

  const checkoutIn = (sandbox: OpenedPlace, userId: string, beside: FirewallSources = {}) =>
    Effect.map(Effect.context<DatabaseServices>(), (context) =>
      checkoutOver(context, sandbox, userId, beside),
    );

  const createdOn = (agent: Agent, sessionId: string, image: string, drive: AgentDrive) =>
    api.create({
      name: `${SANDBOX_NAME}${randomUUID()}`,
      image,
      tags: { [SESSION_TAG]: sessionId, [AGENT_TAG]: agent.id },
      timeoutMs: CODER.SANDBOX_TIMEOUT_MS,
      vcpus: sandboxVcpus(agent.repository),
      keepLastSnapshots: {
        count: CODER.SANDBOX_SNAPSHOTS.count,
        expiration: Duration.toMillis(CODER.SANDBOX_SNAPSHOTS.expiration),
        deleteEvicted: CODER.SANDBOX_SNAPSHOTS.deleteEvicted,
      },
      env: SANDBOX_ENV,
      mounts: { [AGENT_DRIVE.MOUNT_PATH]: drive.name },
      whenNameTaken: NAME_TAKEN.JOIN,
    });

  const runningOf = (opened: OpenedSandbox) => ({
    name: opened.name,
    running: opened.currentSessionId,
  });

  const madeDriveDeleted = (drive: AgentDrive) =>
    drive.from === AGENT_DRIVE_FROM.KEPT ? Effect.void : Effect.ignore(api.deleteDrive(drive.name));

  const openedLetGo = (opened: OpenedPlace, drive: AgentDrive) =>
    drive.from === AGENT_DRIVE_FROM.KEPT
      ? Effect.ignore(api.deleteSandbox(opened.name))
      : Effect.forEach(
          [
            Effect.flatMap(api.session(sessionOfPlace(opened)), (session) => session.stop()),
            api.deleteDrive(drive.name),
            api.deleteSandbox(opened.name),
          ],
          (step) => Effect.ignore(step),
          { discard: true },
        );

  const openStep = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    opened: OpenedPlace,
    drive: AgentDrive,
  ) =>
    drive.from === AGENT_DRIVE_FROM.KEPT
      ? effect.pipe(Effect.tapError(() => openedLetGo(opened, drive)))
      : effect.pipe(Effect.onError(() => openedLetGo(opened, drive)));

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

  const openedFromImage = (agent: Agent, sessionId: string, image: string, drive: AgentDrive) =>
    Effect.gen(function* () {
      const opened = runningOf(
        yield* createdOn(agent, sessionId, image, drive).pipe(
          Effect.retry({
            schedule: Schedule.spaced(IMAGE_RETRY.SPACED),
            times: IMAGE_RETRY.TIMES,
            while: (failure) => failure.code === IMAGE_NOT_READY,
          }),
          Effect.onError(() => madeDriveDeleted(drive)),
        ),
      );
      yield* openStep(api.createUser(opened.name, AGENT_USER, AGENT_HOME_FOLDERS), opened, drive);
      return opened;
    });

  const checkedOutOnDrive = (
    agent: WithRepository<Agent>,
    sandbox: RepositorySandbox,
    read: AgentRepositoryRead,
    from: AgentDriveFrom,
  ) =>
    Effect.gen(function* () {
      if (from === AGENT_DRIVE_FROM.KEPT) return;
      if (from === AGENT_DRIVE_FROM.EMPTY) {
        return yield* cloneAgentRepository(agent, sandbox, read, CHECKOUT_DEPTH.WHOLE);
      }
      yield* refreshAgentCheckout(agent, sandbox, read);
      yield* installDependencies(sandbox).pipe(
        Effect.catch(() => Effect.logWarning("An agent's install on its forked drive failed")),
      );
    });

  const checkedOutSandbox = (
    agent: WithRepository<Agent>,
    read: AgentRepositoryRead,
    extras: readonly AgentExtraRead[],
    sessionId: string,
    image: string,
    drive: AgentDrive,
  ) =>
    Effect.gen(function* () {
      const opened = yield* openedFromImage(agent, sessionId, image, drive);
      const sandbox = yield* checkoutIn(opened, agent.userId);
      yield* openStep(
        Effect.andThen(
          checkedOutOnDrive(agent, sandbox, read, drive.from),
          cloneAgentExtras(sandbox, extras),
        ),
        opened,
        drive,
      );
      return opened;
    });

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
      const base =
        hasRepository(agent) && read !== undefined
          ? baseDriveOf(agent, read)
          : Option.none<BaseDriveOf>();
      if (Option.isSome(base) && read !== undefined) {
        yield* fillBaseDriveInBackground(agent, base.value, image, read);
      }
      const drive = yield* agentDrive(api, sessionId, Option.getOrUndefined(base));
      const opened = yield* hasRepository(agent) && read !== undefined
        ? checkedOutSandbox(agent, read, extras, sessionId, image, drive)
        : openedFromImage(agent, sessionId, image, drive);
      return { ...opened, drive };
    });

  return {
    ...vercelLifecycle(api),

    layout: () => Effect.succeed(SANDBOX_LAYOUT),

    open: (ask, use) =>
      Effect.gen(function* () {
        const [{ name, running, drive }, [deepen, beside]] = yield* Effect.all(
          [
            openedCheckout(ask.target, ask.agent, ask.session),
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
        ).pipe(Effect.tapError(() => openedLetGo({ name, running }, drive)));
      }),

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

export function vercelMachineLayer(
  options: VercelMachineOptions,
): Layer.Layer<AgentMachine, never, HttpClient.HttpClient> {
  return Layer.effect(
    AgentMachine,
    Effect.map(vercelSandboxApi(options.readToken), (api) => vercelMachine(api, options.run)),
  );
}
