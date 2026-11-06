import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type ContentBlock,
  INPUT_LINE,
  type InputLine,
  type IntegrationServer,
  RUNNER_END,
  RUNNER_ENV,
  type RunnerConfig,
  type RunnerEnd,
} from "@repo/agent-runner/protocol";
import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { settleRunnerLostTurns } from "@repo/database/models/abandoned-turns";
import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import {
  type Agent,
  type AgentLatestTurn,
  awaitingLinesOfReached,
  hasRepository,
  latestTurnsOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentOfConversation,
  readAgentRouting,
  readNativeRunStanding,
  recordAgentRunnerToken,
} from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import {
  clearNativeRewindHanded,
  readNativeRewind,
} from "@repo/database/models/conversation-rewind";
import { deviceAgentAwaitsUpdate } from "@repo/database/models/device-agent-store";
import {
  ANY_LAUNCH,
  clearRunnerLines,
  queueRunnerLine,
  runnerLinesWaiting,
  withdrawRunnerLine,
} from "@repo/database/models/runner-line-store";
import { sandboxHeld } from "@repo/database/models/sandbox-terminal-lease";
import { queueSessionSandboxes } from "@repo/database/models/session-sandbox-cleanup";
import { type ConversationTarget, storeWriter } from "@repo/database/models/writer";
import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { TURN_FAILURE } from "@repo/features/turn-run";
import { causeKind, failureKind } from "@repo/runtime/effect";
import type { UserContent } from "ai";
import {
  Cause,
  Clock,
  Context,
  Data,
  DateTime,
  Duration,
  Effect,
  Option,
  Redacted,
  Ref,
  Schedule,
} from "effect";
import { TURN_ORIGIN } from "../../core.js";
import type { HostedEnvironment } from "../../environment.js";
import {
  recordServerEvent,
  type SERVER_AGENT_HARNESS,
  SERVER_EVENT,
  SERVER_HANDOFF_PATH,
} from "../../events/server-events.js";
import { AfterResponse, afterResponse } from "../../http/after-response.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  PLAN_REFUSAL,
  RUNTIME_REFUSAL,
} from "../eve-host/eve-sessions.js";
import {
  AgentMachine,
  type AgentMachineService,
  type FoundPlace,
  LaunchRefused,
  type MachineLayout,
  type MachineLifecycle,
  type MachineName,
  type MachinePlace,
  PLACE_RESUME,
  type RecordedRunner,
  RUNNER_RECORD,
  type RunnerHandle,
  type RunnerMark,
} from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { extraCheckoutPaths } from "../repository-sandbox-contract.js";
import { REPOSITORY_REFUSAL } from "../repository-shell.js";
import {
  type FirewallEntry,
  LAUNCH_SWAP,
  type LaunchSwapKind,
  type LaunchSwaps,
  newPlaceholder,
  placeholderSwap,
} from "../sandbox-firewall.js";
import {
  COMMAND_GONE,
  NOT_FOUND_STATUS,
  type SandboxFile,
  SandboxUnavailable,
  sessionEnding,
} from "../vercel-sandbox-api.js";
import { BEARER_PREFIX, runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { type AgentImage, AgentImageMissing } from "./agent-image.js";
import { agentFailureSaid, agentLogIds, keptFailureWords, runningLogId } from "./agent-log.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import { agentFirewallSources, CheckoutRefused, type CheckoutServices } from "./checkout.js";
import { nativeSkillFiles } from "./native-skills.js";
import { holdingRunner, holdingRunnerIfFree } from "./runner-lease.js";
import { type NativeSessions, RUNNER_CHECKOUT, RUNNER_CHOICE } from "./runtime-sessions.js";
import { nativeSkills } from "./skills.js";
import { CODER_TOOL_SET } from "./tool-set.js";
import { coderTurnMessage, readNativeTurnHanded, recordNativeTurnHanded } from "./turn-message.js";

export type RunnerServices = CheckoutServices | AgentMachine | AgentImage | HostedEnvironment;

export interface RunnerSessionsOptions {
  readonly userId: string;
  readonly eventsUrl: string;
  readonly linesUrl: string;
  readonly mcpUrl: string;
  readonly integrations: (agent: Agent) => Effect.Effect<readonly IntegrationServer[]>;
  readonly instructions: (
    agent: Agent,
    place: Pick<MachineLayout, "checkoutPath" | "installedSkills" | "sharedFiles">,
  ) => Effect.Effect<string>;
  readonly nextSequence: (
    conversationId: string,
  ) => Effect.Effect<number, { readonly _tag: string }>;
}

export interface HarnessLaunch {
  readonly env: Readonly<Record<string, string>>;
  readonly held?: {
    readonly env: Readonly<Record<string, string>>;
    readonly kind: LaunchSwapKind;
    readonly entry: FirewallEntry;
    readonly fingerprint?: Redacted.Redacted;
  };
}

interface HarnessAhead {
  readonly lines: readonly InputLine[];
}

export interface RunnerHarness<E extends { readonly _tag: string }> {
  readonly name: string;
  readonly runtime: (typeof SERVER_AGENT_HARNESS)[keyof typeof SERVER_AGENT_HARNESS];
  readonly sessionPrefix: string;
  readonly launch: (
    agent: Agent,
  ) => Effect.Effect<HarnessLaunch, E | LaunchRefused, RunnerServices>;
  readonly config: (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) => Effect.Effect<RunnerConfig, LaunchRefused>;
  readonly skillRoots: readonly string[];
  readonly ahead: (agent: Agent) => Effect.Effect<HarnessAhead, E | LaunchRefused, RunnerServices>;
}

const FINGERPRINT_CHARS = 32;

const FAILED_STATUS = { UNAVAILABLE: 503, REFUSED: 422 } as const;

const IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MINTED_AT_DIGITS = 12;

function sessionIdOf(prefix: string, mintedAt: number): string {
  return `${prefix}${mintedAt.toString(16).padStart(MINTED_AT_DIGITS, "0")}-${randomUUID()}`;
}

const BEARER_BYTES = 32;

const BEARER_HEADER = "authorization";

interface HeldBearer {
  readonly handed: string;
  readonly swap: FirewallEntry | undefined;
}

function heldBearer(bearer: string, agent: Agent, host: string): HeldBearer {
  if (agent.machine === AGENT_MACHINE.DEVICE) return { handed: bearer, swap: undefined };
  const placeholder = Redacted.value(newPlaceholder());
  const swap = placeholderSwap({
    domain: host,
    header: BEARER_HEADER,
    placeholder: Redacted.make(`${BEARER_PREFIX}${placeholder}`),
    value: Redacted.make(`${BEARER_PREFIX}${bearer}`),
  });
  return { handed: placeholder, swap };
}

function launchSwaps(credential: HarnessLaunch, bearer: HeldBearer): LaunchSwaps {
  const swaps = new Map<LaunchSwapKind, FirewallEntry>();
  if (credential.held !== undefined) swaps.set(credential.held.kind, credential.held.entry);
  if (bearer.swap !== undefined) swaps.set(LAUNCH_SWAP.RUNNER, bearer.swap);
  return swaps;
}

const ATTACHMENT_MODE = 0o644;

const ATTACHMENT_NAME_CHARS = 80;

type MessageLine = Extract<InputLine, { readonly type: typeof INPUT_LINE.MESSAGE }> & {
  readonly uuid: string;
};

interface RunnerMessage {
  readonly line: MessageLine;
  readonly files: readonly SandboxFile[];
  readonly turn: EveHostTurn;
  readonly timeZone: string | undefined;
}

interface OpenedLine {
  readonly line: InputLine;
  readonly taken: Effect.Effect<void, never, DatabaseServices>;
}

function attachmentFileName(name: string, at: number): string {
  const safe = name.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^[.-]+/u, "");
  const dot = safe.lastIndexOf(".");
  const extension = dot > 0 ? safe.slice(dot).slice(0, 16) : "";
  const stem = (dot > 0 ? safe.slice(0, dot) : safe).slice(
    0,
    ATTACHMENT_NAME_CHARS - extension.length,
  );
  return `${at + 1}-${stem === "" ? "attachment" : stem}${extension}`;
}

function runnerContent(
  message: string | UserContent,
  harness: string,
  lineId: string,
  attachments: string,
): { readonly content: readonly ContentBlock[]; readonly files: readonly SandboxFile[] } {
  if (typeof message === "string") return { content: [{ type: "text", text: message }], files: [] };
  const files: SandboxFile[] = [];
  const content = message.flatMap((part, at): ContentBlock[] => {
    if (part.type === "text") return [{ type: "text" as const, text: part.text }];
    if (part.type !== "file" && part.type !== "image") return [];
    const mediaType = part.type === "file" ? part.mediaType : (part.mediaType ?? "");
    const data = part.type === "file" ? part.data : part.image;
    const base64 = base64Of(data);
    if (IMAGE_TYPES.has(mediaType) && base64 !== undefined) {
      return [
        {
          type: "image" as const,
          source: {
            type: "base64" as const,
            media_type: mediaType as "image/png",
            data: base64,
          },
        },
      ];
    }
    const name = part.type === "file" ? (part.filename ?? "a file") : "an image";
    if (base64 === undefined) {
      return [
        {
          type: "text" as const,
          text: `[${name} (${mediaType}) was attached but cannot be passed to ${harness}]`,
        },
      ];
    }
    const path = `${attachments}/${lineId}/${attachmentFileName(name, at)}`;
    files.push({
      path,
      contents: new Uint8Array(Buffer.from(base64, "base64")),
      mode: ATTACHMENT_MODE,
    });
    return [
      {
        type: "text" as const,
        text: `[${name} (${mediaType}) was attached: it is at ${path} in your sandbox, read it from there]`,
      },
    ];
  });
  return { content, files };
}

function base64Of(data: unknown): string | undefined {
  if (data instanceof Uint8Array) return Buffer.from(data).toString("base64");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("base64");
  const text = data instanceof URL ? data.href : typeof data === "string" ? data : undefined;
  if (text === undefined) return undefined;
  if (text.startsWith("data:")) {
    const comma = text.indexOf(",");
    return comma < 0 || !text.slice(0, comma).endsWith(";base64")
      ? undefined
      : text.slice(comma + 1);
  }
  return /^[A-Za-z0-9+/=\s]+$/u.test(text) ? text : undefined;
}

function line(value: RunnerConfig | InputLine): string {
  return `${JSON.stringify(value)}\n`;
}

function stdinText(lines: readonly InputLine[]): string {
  return lines.map(line).join("");
}

function stopLine(launch: number): InputLine {
  return { type: INPUT_LINE.STOP, launch };
}

function launchFingerprint(
  credential: HarnessLaunch,
  integrations: readonly IntegrationServer[],
): string {
  const env = Object.entries(credential.env).sort(([one], [other]) => one.localeCompare(other));
  const names = integrations.map((each) => each.name).sort();
  const { held } = credential;
  const swapped =
    held === undefined
      ? undefined
      : {
          slot: held.kind,
          credential: held.fingerprint === undefined ? undefined : Redacted.value(held.fingerprint),
        };
  return createHash("sha256")
    .update(JSON.stringify({ env, names, held: swapped }))
    .digest("hex")
    .slice(0, FINGERPRINT_CHARS);
}

function pastWarmWindow(
  machine: AgentMachineKind,
  turn: AgentLatestTurn | undefined,
  now: number,
): boolean {
  const window = CODER.RUNNER_WARM[machine];
  if (Duration.isZero(window) || turn === undefined) return false;
  if (RUNNING_TURN_STATUSES.has(turn.status)) return false;
  return turn.settledAt === null || now - turn.settledAt.getTime() > Duration.toMillis(window);
}

function placeOfHandle(handle: RunnerHandle): MachinePlace {
  return {
    machine: handle.machine,
    session: handle.session,
    name: handle.name,
    running: handle.running,
  };
}

function recordOf(found: FoundPlace, userId: string, agentId: string) {
  return { machine: found.machine, session: found.session, name: found.name, userId, agentId };
}

type HandoffPath = (typeof SERVER_HANDOFF_PATH)[keyof typeof SERVER_HANDOFF_PATH];

const RESUME_WHILE_ENDING = {
  schedule: Schedule.spaced(CODER.RESUME_WHILE_ENDING.SPACING),
  times: CODER.RESUME_WHILE_ENDING.TRIES,
  while: sessionEnding,
};

function firstPlace(machine: MachineLifecycle, userId: string, sessionId: string) {
  return Effect.map(machine.findPlaces(userId, sessionId), (places) =>
    Option.fromNullishOr(places[0]),
  );
}

function liveRunner(
  machine: MachineLifecycle,
  found: FoundPlace,
  within?: Duration.Duration,
): Effect.Effect<RecordedRunner | undefined, SandboxUnavailable> {
  const runner = found.runner;
  if (runner === undefined) return Effect.succeed(undefined);
  return machine
    .runnerExit(runner.handle, within)
    .pipe(Effect.map((exit) => (exit === null ? runner : undefined)));
}

function queuedFor(userId: string, agentId: string, launch: number, lines: readonly InputLine[]) {
  return Effect.forEach(
    lines,
    (each) =>
      Effect.flatMap(
        queueRunnerLine(userId, {
          agentId,
          launch,
          text: JSON.stringify(each),
          ...(each.type === INPUT_LINE.MESSAGE && each.uuid !== undefined
            ? { lineId: each.uuid }
            : undefined),
        }),
        (place) =>
          Option.isSome(place)
            ? Effect.void
            : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      ),
    { discard: true },
  );
}

function deliveredTo(
  machine: MachineLifecycle,
  userId: string,
  agentId: string,
  runner: RecordedRunner,
  lines: readonly InputLine[],
): Effect.Effect<void, LaunchRefused | StoreFailure | SandboxUnavailable, DatabaseServices> {
  return runner.mark.linesRead === true
    ? queuedFor(userId, agentId, runner.mark.firstSequence, lines)
    : machine.writeLine(runner.handle, stdinText(lines));
}

function stopWritten(machine: MachineLifecycle, runner: RecordedRunner) {
  return machine.wrote(runner.handle, stdinText([stopLine(runner.mark.firstSequence)]));
}

function failedStatus(failure: { readonly _tag: string }): number {
  if (failure instanceof LaunchRefused) {
    return failure.planRefusal === PLAN_REFUSAL.UNREACHABLE
      ? FAILED_STATUS.UNAVAILABLE
      : FAILED_STATUS.REFUSED;
  }
  if (failure instanceof AgentImageMissing) return FAILED_STATUS.REFUSED;
  return failure instanceof SandboxUnavailable
    ? (failure.status ?? FAILED_STATUS.UNAVAILABLE)
    : FAILED_STATUS.UNAVAILABLE;
}

class LaunchCut extends Data.TaggedError("LaunchCut")<{
  readonly kind: string;
  readonly interrupted: boolean;
}> {}

function launchFailureOf(cause: Cause.Cause<{ readonly _tag: string }>): { readonly _tag: string } {
  return Option.getOrElse(
    Cause.findErrorOption(cause),
    () => new LaunchCut({ kind: causeKind(cause), interrupted: Cause.hasInterruptsOnly(cause) }),
  );
}

function failureWords(failure: { readonly _tag: string }): string {
  if (failure instanceof LaunchRefused) return failure.reason;
  if (failure instanceof CheckoutRefused) {
    return failure.detail === undefined ? failure.reason : `${failure.reason} ${failure.detail}`;
  }
  if (failure instanceof LaunchCut) {
    return failure.interrupted ? "the launch was interrupted" : `the launch died: ${failure.kind}`;
  }
  return failure instanceof SandboxUnavailable ? failure.message : failureKind(failure);
}

function kindOf(failure: { readonly _tag: string }): string {
  return failure instanceof LaunchCut ? failure.kind : failureKind(failure);
}

function namedOutcome(failure: { readonly _tag: string }): boolean {
  if (failure instanceof CheckoutRefused) return failure.reason === CODER_REFUSAL.NOT_REACHABLE;
  return (
    failure instanceof LaunchRefused &&
    (failure.planRefusal !== undefined ||
      failure.keyRefusal !== undefined ||
      failure.deviceRemoved === true ||
      failure.deviceAway === true)
  );
}

export const runnerSessions = <
  E extends { readonly _tag: string },
  Turn extends EveHostTurn = EveHostTurn,
>(
  harness: RunnerHarness<E>,
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  Effect.gen(function* () {
    const context = yield* Effect.context<RunnerServices>();
    const machine: AgentMachineService = yield* AgentMachine;
    const { userId } = options;
    const serviceHost = new URL(options.eventsUrl).hostname;

    const agentOf = (conversationId: string) =>
      Effect.flatMap(readAgentOfConversation(userId, conversationId), (agent) =>
        Option.isSome(agent)
          ? Effect.succeed(agent.value)
          : Effect.fail(new LaunchRefused({ reason: "no agent" })),
      );

    const ownsPlace = (found: FoundPlace) =>
      found.agentId === undefined
        ? Effect.succeed(false)
        : Effect.map(readAgent(userId, found.agentId), Option.isSome);

    const extraCheckoutsOf = (agent: Agent) =>
      hasRepository(agent)
        ? Effect.map(readAgentRepositories(userId, agent.id), ([, ...extras]) =>
            extraCheckoutPaths(extras.map((extra) => extra.repository)),
          )
        : Effect.succeed([]);

    const renewCredential = (target: ConversationTarget, agent: Agent, place: MachinePlace) =>
      Effect.gen(function* () {
        if (!hasRepository(agent)) return;
        const sources = yield* agentFirewallSources(target, agent);
        yield* machine.firewall.write(place, agent.userId, sources);
      });

    const writeInstalledSkills = (place: MachinePlace, files: readonly SandboxFile[]) =>
      (files.length === 0 ? Effect.void : machine.writeFiles(place, files)).pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `The installed skills of a ${harness.name} agent were not written: ${keptFailureWords(failureWords(failure))}`,
          ),
        ),
      );

    const launch = <AE, AR>(
      agent: Agent,
      place: {
        readonly name: MachineName;
        readonly running: MachinePlace;
        readonly session: string;
      },
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      resume: string | undefined,
      credential: HarnessLaunch,
      alongside: Effect.Effect<void, AE, AR>,
      queuedFirst?: OpenedLine,
    ) =>
      Effect.gen(function* () {
        const bearer = randomBytes(BEARER_BYTES).toString("base64url");
        const runnerBearer = heldBearer(bearer, agent, serviceHost);
        const swaps = launchSwaps(credential, runnerBearer);
        if (swaps.size > 0) {
          yield* machine.firewall.keepLaunch(place.running, agent.userId, {
            agentId: agent.id,
            swaps,
          });
        }
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        const recorded = {
          machine: place.running.machine,
          session: place.running.session,
          name: place.name,
          userId,
          agentId: agent.id,
        };
        const launching = (firstSequence: number) =>
          machine.recordRunner(recorded, {
            kind: RUNNER_RECORD.LAUNCHED,
            mark: { firstSequence },
          });
        const ready = Effect.all(
          [
            Effect.gen(function* () {
              const firstSequence = yield* options.nextSequence(agent.conversationId);
              const read = Effect.gen(function* () {
                const rewind = Option.getOrUndefined(
                  yield* readNativeRewind({ userId, conversationId: agent.conversationId }),
                );
                const rewindBefore = resume === undefined ? undefined : rewind;
                const config = yield* harness.config(
                  agent,
                  layout,
                  resume,
                  firstSequence,
                  rewindBefore,
                );
                const warm = !Duration.isZero(CODER.RUNNER_WARM[place.running.machine]);
                return {
                  config: {
                    ...config,
                    ...(layout.linesRead ? { linesUrl: options.linesUrl } : undefined),
                    ...(warm ? { warm } : undefined),
                  },
                  rewind,
                };
              });
              const opened =
                first === undefined
                  ? Effect.succeed(undefined)
                  : queuedFirst !== undefined
                    ? Effect.succeed(queuedFirst)
                    : openedLine(agent, place.session, first, resume === undefined);
              const [, made, opening] = yield* Effect.all(
                [launching(firstSequence), read, opened],
                { concurrency: "unbounded" },
              );
              return { firstSequence, ...made, opening };
            }),
            first === undefined ? Effect.void : filesWritten(place.running, first),
            layout.linesRead ? clearedForLaunch(userId, agent.id) : Effect.void,
            recordAgentRunnerToken(userId, agent.id, runnerTokenDigest(bearer)),
            swaps.size === 0
              ? Effect.void
              : Effect.flatMap(agentFirewallSources(target, agent), (sources) =>
                  machine.firewall.write(place.running, agent.userId, sources),
                ),
            alongside,
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.map(([made]) => made));
        const {
          handle,
          ready: { firstSequence, rewind, opening },
        } = yield* machine.launchRunner(place.running, {
          env: {
            ...credential.env,
            ...credential.held?.env,
            [RUNNER_ENV.BEARER]: runnerBearer.handed,
          },
          userId,
          agentId: agent.id,
          extraCheckouts: yield* extraCheckoutsOf(agent),
          name: place.name,
          ready,
          firstLines: (made) =>
            Effect.gen(function* () {
              const mark: RunnerMark = {
                firstSequence: made.firstSequence,
                fingerprint: launchFingerprint(credential, yield* options.integrations(agent)),
                ...(layout.linesRead ? { linesRead: true } : undefined),
              };
              const opened = made.opening === undefined ? [] : [made.opening.line];
              if (layout.linesRead) {
                yield* queued(agent, made.firstSequence, opened);
                return { lines: line(made.config), mark };
              }
              if (opened.length === 0) return yield* new LaunchRefused({ reason: "no message" });
              return { lines: [made.config, ...opened].map(line).join(""), mark };
            }),
          abandon: (made) =>
            Effect.andThen(
              layout.linesRead && first !== undefined
                ? withdrawRunnerLine(userId, agent.id, first.line.uuid)
                : Effect.void,
              launching(made.firstSequence),
            ),
        });
        if (opening !== undefined) yield* opening.taken;
        if (rewind !== undefined) {
          yield* clearNativeRewindHanded(agent.conversationId, rewind).pipe(
            Effect.tapError(() =>
              Effect.ignore(Effect.andThen(machine.kill(handle), launching(firstSequence))),
            ),
          );
        }
        yield* replaceAgentWakeups(agent.id, []).pipe(
          Effect.catch((failure) =>
            Effect.logWarning(
              `a relaunched agent's wakeups were not handed back: ${failureKind(failure)}`,
            ),
          ),
        );
      });

    const queued = (agent: Agent, launch: number, lines: readonly InputLine[]) =>
      queuedFor(userId, agent.id, launch, lines);

    const delivered = (agent: Agent, runner: RecordedRunner, lines: readonly InputLine[]) =>
      deliveredTo(machine, userId, agent.id, runner, lines);

    const messageLine = (message: EveMessage<Turn>, layout: MachineLayout): RunnerMessage => {
      const uuid = message.lineId ?? randomUUID();
      const { content, files } = runnerContent(
        message.message,
        harness.name,
        uuid,
        layout.attachments,
      );
      return {
        line: { type: INPUT_LINE.MESSAGE, uuid, content },
        files,
        turn: message.turn,
        timeZone: message.timeZone,
      };
    };

    const openedLine = (
      agent: Agent,
      sessionId: string,
      sent: RunnerMessage,
      fresh: boolean,
    ): Effect.Effect<OpenedLine, never, DatabaseServices> =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        const handed = fresh ? {} : yield* readNativeTurnHanded(target);
        const admitted: AdmittedConversation = {
          caller: userId,
          target,
          runtimeSessionId: sessionId,
          timeZone: sent.timeZone,
        };
        const now = yield* Clock.currentTimeMillis;
        const turn = { kind: sent.turn, turnId: undefined };
        const opened = yield* coderTurnMessage(admitted, agent, turn, handed, now);
        const { content } = sent.line;
        const ahead: readonly ContentBlock[] =
          opened.text === undefined ? [] : [{ type: "text", text: opened.text }];
        const taken = recordNativeTurnHanded(target, opened.handed);
        return { line: { ...sent.line, content: [...ahead, ...content] }, taken };
      });

    const filesWritten = (place: MachinePlace, message: RunnerMessage) =>
      message.files.length === 0 ? Effect.void : machine.writeFiles(place, message.files);

    const failed = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        agentFailureSaid(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
          kindOf(failure),
          !namedOutcome(failure),
        ),
        {
          outcome: EVE_SEND_OUTCOME.FAILED,
          status: failedStatus(failure),
          ...(failure instanceof LaunchRefused && failure.planRefusal !== undefined
            ? { planRefusal: failure.planRefusal }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.planResetsAt !== undefined
            ? { planResetsAt: failure.planResetsAt }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.keyRefusal !== undefined
            ? { keyRefusal: failure.keyRefusal }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.deviceRemoved === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_REMOVED }
            : undefined),
          ...(failure instanceof LaunchRefused && failure.deviceAway === true
            ? { runtimeRefusal: RUNTIME_REFUSAL.DEVICE_AWAY }
            : undefined),
        } as const,
      );

    const unavailable = (call: string) => (failure: { readonly _tag: string }) =>
      Effect.as(
        Effect.logWarning(
          `A ${harness.name} ${call} failed: ${keptFailureWords(failureWords(failure))}`,
        ),
        {
          outcome: "failed" as const,
          status: failedStatus(failure),
        },
      );

    const openedPlace = (
      agent: Agent,
      sessionId: string,
      layout: MachineLayout,
      first: RunnerMessage | undefined,
      credential: HarnessLaunch,
      queuedFirst?: OpenedLine,
      sandboxOpened: Effect.Effect<void> = Effect.void,
    ) =>
      Effect.gen(function* () {
        const target: ConversationTarget = { userId, conversationId: agent.conversationId };
        yield* machine.open(
          {
            session: sessionId,
            target,
            agent,
            harness: harness.name,
            beside: Effect.map(nativeSkills(target, agent, harness.skillRoots), (skills) =>
              nativeSkillFiles(skills, layout.skillsUpload),
            ),
          },
          (opened, skills) =>
            Effect.andThen(
              Effect.andThen(
                Effect.logInfo(`A ${harness.name} launch opened its sandbox`),
                sandboxOpened,
              ),
              launch(
                agent,
                { name: opened.name, running: opened.place, session: sessionId },
                layout,
                first,
                undefined,
                credential,
                Effect.all([opened.finishCheckout, writeInstalledSkills(opened.place, skills)], {
                  concurrency: "unbounded",
                  discard: true,
                }),
                queuedFirst,
              ),
            ).pipe(Effect.annotateLogs(runningLogId(opened.place.running))),
        );
      });

    const relaunched = (
      agent: Agent,
      sessionId: string,
      name: MachineName,
      running: MachinePlace,
      layout: MachineLayout,
      sent: RunnerMessage | undefined,
    ) =>
      Effect.gen(function* () {
        const target = { userId, conversationId: agent.conversationId };
        const [, routing, credential] = yield* Effect.all(
          [
            machine.checkOutExtras(running, target, agent, false),
            readAgentRouting(userId, agent.id),
            harness.launch(agent),
          ],
          { concurrency: "unbounded" },
        );
        const resume = Option.getOrUndefined(
          Option.flatMapNullishOr(routing, (read) => read.nativeSession),
        );
        yield* launch(
          agent,
          { name, running, session: sessionId },
          layout,
          sent,
          resume,
          credential,
          Effect.void,
        );
      });

    const staleWarm = (agent: Agent, runner: RunnerMark, turnRunning: boolean) =>
      Effect.gen(function* () {
        if (runner.fingerprint === undefined || turnRunning) return false;
        const credential = yield* harness.launch(agent);
        const now = launchFingerprint(credential, yield* options.integrations(agent));
        return now !== runner.fingerprint;
      });

    const sendHolding = (
      sessionId: string,
      message: EveMessage<Turn>,
      layout: MachineLayout,
      sent: RunnerMessage,
      handsOn: boolean,
    ) =>
      Effect.gen(function* () {
        const [found, agentRead] = yield* Effect.all(
          [firstPlace(machine, userId, sessionId), Effect.exit(agentOf(message.conversationId))],
          { concurrency: "unbounded" },
        );
        if (Option.isNone(found)) return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        const agent = yield* agentRead;
        if (found.value.agentId !== agent.id) {
          return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        }
        const target = { userId, conversationId: agent.conversationId };
        const accepted = {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        const turnRunning = turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status);
        const handedAt = yield* Clock.currentTimeMillis;
        const handed = (path: HandoffPath) =>
          recordServerEvent(
            SERVER_EVENT.AGENT_HANDOFF,
            { userId, workspaceId: agent.organizationId },
            {
              harness: harness.runtime,
              path,
              turn_running: turnRunning,
              ...(turnRunning || turn?.settledAt == null
                ? {}
                : {
                    idle_seconds: Math.max(
                      0,
                      Math.round((handedAt - turn.settledAt.getTime()) / 1_000),
                    ),
                  }),
            },
          );
        const running = found.value.runner;
        if (running !== undefined) {
          const runnerPlace = placeOfHandle(running.handle);
          if (
            pastWarmWindow(found.value.machine, turn, handedAt) ||
            (yield* stopWritten(machine, running)) ||
            (yield* staleWarm(agent, running.mark, turnRunning))
          ) {
            yield* machine.kill(running.handle);
            yield* relaunched(agent, sessionId, found.value.name, runnerPlace, layout, sent);
            yield* handed(SERVER_HANDOFF_PATH.RELAUNCHED);
            return accepted;
          }
          const reads = running.mark.linesRead === true;
          const [ahead, opened, uploaded, exit] = yield* Effect.all(
            [
              harness.ahead(agent),
              openedLine(agent, sessionId, sent, false),
              filesWritten(runnerPlace, sent).pipe(
                Effect.as(true),
                Effect.catchIf(sessionEnding, () => Effect.succeed(false)),
              ),
              reads
                ? machine.runnerExit(running.handle, CODER.RUNNER_EXIT_READ).pipe(
                    Effect.catchIf(sessionEnding, () => Effect.succeed(COMMAND_GONE)),
                    Effect.orElseSucceed(() => null),
                  )
                : Effect.succeed(null),
            ],
            { concurrency: "unbounded" },
          );
          const lines = [...ahead.lines, opened.line];
          const wrote =
            uploaded &&
            (reads
              ? exit === null &&
                (yield* Effect.as(queued(agent, running.mark.firstSequence, lines), true))
              : yield* machine.writeLine(running.handle, lines.map(line).join("")).pipe(
                  Effect.as(true),
                  Effect.catchIf(
                    (failure) =>
                      (failure instanceof SandboxUnavailable &&
                        failure.status === NOT_FOUND_STATUS) ||
                      sessionEnding(failure),
                    () => Effect.succeed(false),
                  ),
                ));
          if (wrote) {
            yield* opened.taken;
            yield* Effect.gen(function* () {
              const renewed = yield* renewCredential(target, agent, runnerPlace).pipe(
                Effect.timeoutOption(CODER.CREDENTIAL_RENEWAL),
                Effect.catch((failure) =>
                  Effect.as(
                    Effect.logWarning(
                      `A ${harness.name} runner's credential was not renewed: ${keptFailureWords(failureWords(failure))}`,
                    ),
                    Option.some(undefined),
                  ),
                ),
              );
              if (Option.isNone(renewed)) {
                yield* Effect.logWarning(
                  `A ${harness.name} runner's credential renewal outlasted its bound and was given up`,
                );
              }
            }).pipe(Effect.annotateLogs(runningLogId(runnerPlace.running)));
            yield* handed(SERVER_HANDOFF_PATH.WARM);
            return accepted;
          }
        }
        const wasUp = found.value.running !== undefined;
        if (handsOn) {
          const routing = yield* readAgentRouting(userId, agent.id);
          const fresh = Option.isNone(
            Option.flatMapNullishOr(routing, (read) => read.nativeSession),
          );
          const opened = yield* openedLine(agent, sessionId, sent, fresh);
          yield* queued(agent, ANY_LAUNCH, [opened.line]);
          yield* opened.taken;
          yield* handedOnAfter(sessionId, agent, sent.line.uuid, handed);
          return accepted;
        }
        const resumed = yield* Effect.gen(function* () {
          const place = yield* machine.resume(found.value);
          if (place === PLACE_RESUME.GONE) return place;
          yield* relaunched(agent, sessionId, found.value.name, place, layout, sent);
          return place;
        }).pipe(Effect.retry({ times: 1, while: sessionEnding }));
        if (resumed === PLACE_RESUME.GONE) {
          yield* openedPlace(agent, sessionId, layout, sent, yield* harness.launch(agent));
          yield* machine
            .discard(found.value)
            .pipe(
              Effect.catch((failure) =>
                Effect.logWarning(
                  `An expired ${harness.name} sandbox was not deleted: ${failure.message}`,
                ),
              ),
            );
          yield* handed(SERVER_HANDOFF_PATH.FRESH);
          return accepted;
        }
        yield* handed(wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED);
        return accepted;
      });

    const cancelHolding = (sessionId: string, turnId: string, agent: Agent) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isNone(found) || found.value.agentId !== agent.id) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }
        const { conversationId } = agent;
        const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
        if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) {
          return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
        }
        const live = yield* liveRunner(machine, found.value, CODER.RUNNER_EXIT_READ);
        if (live === undefined) return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED } as const;
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]).pipe(
          Effect.catchIf(
            (failure) =>
              failure instanceof SandboxUnavailable && failure.status === NOT_FOUND_STATUS,
            () => Effect.void,
          ),
        );
        return { outcome: EVE_CANCEL_OUTCOME.ACCEPTED, launch: live.mark.firstSequence } as const;
      });

    const forcedStop = (
      sessionId: string,
      turnId: string,
      agent: Agent,
      launch: number | undefined,
    ) =>
      Effect.andThen(
        Effect.sleep(CODER.STOP_CONFIRM),
        holdingRunner(
          agent.id,
          Effect.gen(function* () {
            const { conversationId } = agent;
            const turn = (yield* latestTurnsOfReached([conversationId])).get(conversationId);
            if (turn?.id !== turnId || !RUNNING_TURN_STATUSES.has(turn.status)) return;
            if (turn.cancelRequestedAt === null) return;
            const found = yield* firstPlace(machine, userId, sessionId);
            const live =
              Option.isSome(found) && found.value.agentId === agent.id
                ? yield* liveRunner(machine, found.value)
                : undefined;
            if (Option.isSome(found) && live !== undefined && live.mark.firstSequence === launch) {
              yield* Effect.logWarning(
                `A ${harness.name} runner did not end its turn on a Stop, and was ended`,
              );
              yield* machine.kill(live.handle);
              yield* recordAgentRunnerToken(userId, agent.id, null);
              yield* machine.recordRunner(recordOf(found.value, userId, agent.id), {
                kind: RUNNER_RECORD.NONE,
              });
            }
            const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
            const now = yield* Clock.currentTimeMillis;
            yield* settleRunnerLostTurns(writer, conversationId, now, undefined, new Set([turnId]));
          }),
        ),
      );

    const haltHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isNone(found)) return;
        const agent = yield* agentOf(conversationId);
        if (found.value.agentId !== agent.id) return;
        const live = yield* liveRunner(machine, found.value);
        if (live === undefined) return;
        const { handle } = live;
        yield* delivered(agent, live, [stopLine(live.mark.firstSequence)]);
        const exited = machine.runnerExit(handle).pipe(Effect.timeoutOption(CODER.RUNNER_HALT));
        const stopped = yield* exited;
        if (Option.isNone(stopped) || stopped.value === null) {
          yield* machine.kill(handle);
          yield* exited;
        }
        yield* recordAgentRunnerToken(userId, agent.id, null);
        yield* machine.recordRunner(recordOf(found.value, userId, agent.id), {
          kind: RUNNER_RECORD.NONE,
        });
      });

    const retuneHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isNone(found)) return RUNNER_CHOICE.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        if (found.value.agentId !== agent.id) return RUNNER_CHOICE.NOT_LIVE;
        const live = yield* liveRunner(machine, found.value);
        if (live === undefined) return RUNNER_CHOICE.NOT_LIVE;
        const ahead = yield* harness.ahead(agent);
        const model = ahead.lines.filter((each) => each.type === INPUT_LINE.MODEL);
        if (model.length === 0) return RUNNER_CHOICE.NOT_LIVE;
        yield* delivered(agent, live, model);
        return RUNNER_CHOICE.WRITTEN;
      });

    const checkOutHolding = (sessionId: string, conversationId: string) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isNone(found)) return RUNNER_CHECKOUT.NOT_LIVE;
        const agent = yield* agentOf(conversationId);
        const running = found.value.running;
        if (found.value.agentId !== agent.id || running === undefined) {
          return RUNNER_CHECKOUT.NOT_LIVE;
        }
        const target = { userId, conversationId: agent.conversationId };
        yield* renewCredential(target, agent, running);
        yield* machine.checkOutExtras(running, target, agent, true);
        return RUNNER_CHECKOUT.CHECKED_OUT;
      });

    const deliverWaitingHolding = (sessionId: string, agent: Agent) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isNone(found) || found.value.agentId !== agent.id) return undefined;
        if (!(yield* linesWaitAt(userId, agent.id))) return undefined;
        if ((yield* liveRunner(machine, found.value)) !== undefined) return undefined;
        const layout = yield* machine.layout(agent);
        if (!layout.linesRead) return undefined;
        const wasUp = found.value.running !== undefined;
        const resumed = yield* Effect.gen(function* () {
          const place = yield* machine.resume(found.value);
          if (place === PLACE_RESUME.GONE) return place;
          yield* relaunched(agent, sessionId, found.value.name, place, layout, undefined);
          return place;
        }).pipe(Effect.retry(RESUME_WHILE_ENDING));
        if (resumed === PLACE_RESUME.GONE) {
          yield* openedPlace(agent, sessionId, layout, undefined, yield* harness.launch(agent));
          yield* Effect.ignore(machine.discard(found.value));
          return SERVER_HANDOFF_PATH.FRESH;
        }
        return wasUp ? SERVER_HANDOFF_PATH.RELAUNCHED : SERVER_HANDOFF_PATH.RESUMED;
      });

    const launchFailed =
      (agent: Agent, sessionId: string) => (failure: { readonly _tag: string }) =>
        Effect.gen(function* () {
          const words = keptFailureWords(failureWords(failure));
          yield* agentFailureSaid(
            `A ${harness.name} launch failed after its Start: ${words}`,
            kindOf(failure),
            !namedOutcome(failure),
            TURN_FAILURE.MODEL,
          );
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          const detail =
            failure instanceof CheckoutRefused
              ? words
              : failure instanceof LaunchRefused
                ? `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE}: ${failure.reason}`
                : `${REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE} ${words}`;
          yield* settleRunnerLostTurns(
            writer,
            agent.conversationId,
            yield* Clock.currentTimeMillis,
            detail,
          );
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`A failed launch's turn was not written: ${causeKind(cause)}`),
          ),
          Effect.annotateLogs(agentLogIds(agent, sessionId)),
        );

    const launchedAfterStart = <R>(
      agent: Agent,
      sessionId: string,
      launching: (
        sandboxOpened: Effect.Effect<void>,
      ) => Effect.Effect<void, { readonly _tag: string }, R>,
      withdrawn: Effect.Effect<void, never, DatabaseServices>,
    ) =>
      Effect.gen(function* () {
        const opened = yield* Ref.make(false);
        const failedWith = (cause: Cause.Cause<{ readonly _tag: string }>) =>
          Effect.andThen(withdrawn, launchFailed(agent, sessionId)(launchFailureOf(cause)));
        const interrupted = Effect.flatMap(Ref.get(opened), (up) =>
          up
            ? agentFailureSaid(
                `A ${harness.name} launch was interrupted after its sandbox opened, so its runner may run`,
                causeKind(Cause.interrupt()),
                true,
              )
            : failedWith(Cause.interrupt()),
        );
        return yield* Effect.gen(function* () {
          yield* Effect.logInfo(`A ${harness.name} launch began after its Start`);
          yield* holdingRunner(agent.id, launching(Ref.set(opened, true)));
          yield* Effect.logInfo(`A ${harness.name} launch started its runner`);
        }).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : failedWith(cause),
          ),
          Effect.onInterrupt(() => interrupted),
        );
      }).pipe(Effect.annotateLogs(agentLogIds(agent, sessionId)));

    const handedOn = (
      sessionId: string,
      agent: Agent,
      lineId: string,
      handed: ((path: HandoffPath) => Effect.Effect<void>) | undefined,
    ) =>
      Effect.gen(function* () {
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isSome(found) && found.value.agentId === agent.id) {
          const path = yield* deliverWaitingHolding(sessionId, agent);
          if (handed !== undefined) yield* handed(path ?? SERVER_HANDOFF_PATH.WARM);
          return;
        }
        yield* Effect.logWarning(
          `A ${harness.name} message queued behind another call found its session ended`,
        );
        yield* withdrawRunnerLine(userId, agent.id, lineId);
      });

    const handedOnAfter = (
      sessionId: string,
      agent: Agent,
      lineId: string,
      handed?: (path: HandoffPath) => Effect.Effect<void>,
    ) =>
      afterResponse(
        `A ${harness.name} hand-on`,
        holdingRunner(
          agent.id,
          handedOn(sessionId, agent, lineId, handed),
          CODER.RUNNER_LEASE.HOLD,
        ),
      );

    const sentTo = (
      agent: Agent,
      sessionId: string,
      message: EveMessage<Turn>,
      answersFirst: boolean,
    ) =>
      Effect.gen(function* () {
        const layout = yield* machine.layout(agent);
        const sent = messageLine(message, layout);
        const queues = layout.linesRead && sent.files.length === 0 && answersFirst;
        const handed = yield* queues
          ? holdingRunnerIfFree(agent.id, sendHolding(sessionId, message, layout, sent, true))
          : Effect.map(
              holdingRunner(agent.id, sendHolding(sessionId, message, layout, sent, false)),
              Option.some,
            );
        if (Option.isSome(handed)) return handed.value;
        const found = yield* firstPlace(machine, userId, sessionId);
        if (Option.isSome(found) && found.value.agentId !== agent.id) {
          return { outcome: EVE_SEND_OUTCOME.RETIRED } as const;
        }
        const ahead = yield* harness.ahead(agent);
        const recorded = Option.isSome(found) ? found.value.runner : undefined;
        yield* recorded === undefined
          ? queued(agent, ANY_LAUNCH, [sent.line])
          : queued(agent, recorded.mark.firstSequence, [...ahead.lines, sent.line]);
        yield* handedOnAfter(sessionId, agent, sent.line.uuid);
        return {
          outcome: EVE_SEND_OUTCOME.ACCEPTED,
          sessionId,
          deliveryId: sent.line.uuid,
        } as const;
      });

    const sessions: NativeSessions<Turn> = {
      open: (message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            const sessionId = sessionIdOf(harness.sessionPrefix, yield* Clock.currentTimeMillis);
            return yield* Effect.gen(function* () {
              const credential = yield* harness.launch(agent);
              const layout = yield* machine.layout(agent);
              const first = messageLine(message, layout);
              const withdrawn = layout.linesRead
                ? Effect.ignore(withdrawRunnerLine(userId, agent.id, first.line.uuid))
                : Effect.void;
              const opened = layout.linesRead
                ? yield* openedLine(agent, sessionId, first, true)
                : undefined;
              if (opened !== undefined) yield* queued(agent, ANY_LAUNCH, [opened.line]);
              yield* afterResponse(
                `A ${harness.name} launch`,
                launchedAfterStart(
                  agent,
                  sessionId,
                  (sandboxOpened) =>
                    openedPlace(agent, sessionId, layout, first, credential, opened, sandboxOpened),
                  withdrawn,
                ),
              ).pipe(Effect.onError(() => withdrawn));
              return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId } as const;
            }).pipe(
              Effect.catch(failed("open")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("open")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId })),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      send: (sessionId, message) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const agent = yield* agentOf(message.conversationId);
            return yield* sentTo(agent, sessionId, message, Option.isSome(after)).pipe(
              Effect.catch(failed("send")),
              Effect.annotateLogs(agentLogIds(agent, sessionId)),
            );
          }).pipe(
            Effect.catch(failed("send")),
            Effect.annotateLogs(agentLogIds({ conversationId: message.conversationId }, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      cancel: (sessionId, turnId) =>
        Effect.gen(function* () {
          const after = yield* Effect.serviceOption(AfterResponse);
          return yield* Effect.gen(function* () {
            const found = yield* firstPlace(machine, userId, sessionId);
            const agentId = Option.isSome(found) ? found.value.agentId : undefined;
            const agent = agentId === undefined ? Option.none() : yield* readAgent(userId, agentId);
            if (Option.isNone(agent)) {
              return { outcome: EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN } as const;
            }
            const canceled = yield* holdingRunner(
              agent.value.id,
              cancelHolding(sessionId, turnId, agent.value),
            );
            if (canceled.outcome !== EVE_CANCEL_OUTCOME.ACCEPTED || Option.isNone(after)) {
              return { outcome: canceled.outcome } as const;
            }
            const launch = "launch" in canceled ? canceled.launch : undefined;
            yield* afterResponse(
              `A ${harness.name} Stop's force`,
              forcedStop(sessionId, turnId, agent.value, launch).pipe(
                Effect.annotateLogs(agentLogIds(agent.value, sessionId)),
              ),
            );
            return { outcome: canceled.outcome } as const;
          }).pipe(
            Effect.catch(unavailable("cancel")),
            Effect.annotateLogs(agentLogIds({}, sessionId)),
            Effect.provideContext(
              Option.isSome(after) ? Context.add(context, AfterResponse, after.value) : context,
            ),
          );
        }),

      reset: (sessionId) =>
        Effect.gen(function* () {
          const places = yield* machine.findPlaces(userId, sessionId);
          if (places.length === 0) return { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;
          let retired = 0;
          for (const place of places) {
            if (!(yield* ownsPlace(place))) continue;
            retired += 1;
            if (place.agentId !== undefined) {
              yield* recordAgentRunnerToken(userId, place.agentId, null);
            }
            yield* machine.discard(place);
          }
          if (retired === 0) return { outcome: EVE_RESET_OUTCOME.NO_ACTIVE_SESSION } as const;
          yield* queueSessionSandboxes([sessionId]);
          return { outcome: EVE_RESET_OUTCOME.RESET } as const;
        }).pipe(
          Effect.catch(unavailable("reset")),
          Effect.annotateLogs(agentLogIds({}, sessionId)),
          Effect.provideContext(context),
        ),

      halt: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          yield* holdingRunner(id, haltHolding(sessionId, conversationId));
          return true;
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} halt failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              false,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      deliverWaiting: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const agent = yield* agentOf(conversationId);
          return yield* holdingRunner(agent.id, deliverWaitingHolding(sessionId, agent)).pipe(
            Effect.map((path) => path !== undefined),
            Effect.catch((failure) => Effect.as(launchFailed(agent, sessionId)(failure), false)),
            Effect.annotateLogs(agentLogIds(agent, sessionId)),
          );
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} hand-on of waiting lines failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              false,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      checkOut: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          return yield* holdingRunner(id, checkOutHolding(sessionId, conversationId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} checkout of an added repository failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_CHECKOUT.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),

      retune: (sessionId, conversationId) =>
        Effect.gen(function* () {
          const { id } = yield* agentOf(conversationId);
          return yield* holdingRunner(id, retuneHolding(sessionId, conversationId));
        }).pipe(
          Effect.catch((failure) =>
            Effect.as(
              Effect.logWarning(
                `A ${harness.name} model change failed: ${keptFailureWords(failureWords(failure))}`,
              ),
              RUNNER_CHOICE.FAILED,
            ),
          ),
          Effect.annotateLogs(agentLogIds({ conversationId }, sessionId)),
          Effect.provideContext(context),
        ),
    };
    return sessions;
  });

export interface RunnerEnding {
  readonly target: ConversationTarget;
  readonly sessionId: string;
  readonly sequence: number;
  readonly reason?: RunnerEnd | undefined;
}

const runnerMayBeAtWork = (agentId: string, now: Date) =>
  Effect.gen(function* () {
    const standing = yield* readNativeRunStanding(agentId);
    if (Option.isNone(standing)) return false;
    const { conversationId, endedAt } = standing.value;
    if (endedAt === null) return true;
    const awaiting = (yield* awaitingLinesOfReached([conversationId])).get(conversationId);
    return (
      awaiting !== undefined &&
      now.getTime() - awaiting.getTime() <= Duration.toMillis(CODER.LINE_GRACE)
    );
  });

interface WarmRunner {
  readonly sessionId: string;
  readonly userId: string;
  readonly agentId: string;
  readonly running: string;
}

const retiredHolding = (machine: MachineLifecycle, retiring: WarmRunner) =>
  Effect.gen(function* () {
    if (yield* runnerMayBeAtWork(retiring.agentId, yield* DateTime.nowAsDate)) return false;
    const found = yield* firstPlace(machine, retiring.userId, retiring.sessionId);
    if (Option.isNone(found)) return false;
    const live = yield* liveRunner(machine, found.value, CODER.RUNNER_EXIT_READ);
    if (live === undefined || live.handle.running !== retiring.running) return false;
    const retire: InputLine = { type: INPUT_LINE.RETIRE };
    yield* deliveredTo(machine, retiring.userId, retiring.agentId, live, [retire]);
    const { launch } = found.value;
    yield* machine.recordRunner(
      recordOf(found.value, retiring.userId, found.value.agentId ?? retiring.agentId),
      launch === undefined
        ? { kind: RUNNER_RECORD.NONE }
        : { kind: RUNNER_RECORD.LAUNCHED, mark: launch },
    );
    return true;
  });

export const retireWarmRunner = Effect.fn("web/retireWarmRunner")(function* (retiring: WarmRunner) {
  const machine = yield* deploymentLifecycle;
  return yield* holdingRunner(retiring.agentId, retiredHolding(machine, retiring));
});

export const retireWarmRunnerIfFree = Effect.fn("web/retireWarmRunnerIfFree")(function* (
  retiring: Omit<WarmRunner, "running">,
) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, retiring.userId, retiring.sessionId);
  const running = Option.getOrUndefined(found)?.running;
  if (running === undefined) return Option.some(false);
  return yield* holdingRunnerIfFree(
    retiring.agentId,
    retiredHolding(machine, { ...retiring, running: running.running }),
  );
});

export const RUNNER_ENDED = {
  STOPPED: "stopped",
  HELD: "held",
  STALE: "stale",
  LINES_WAITING: "lines_waiting",
} as const;

export const runnerEnded = Effect.fn("web/runnerEnded")(function* (ending: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, ending.target.userId, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  const { agentId } = found.value;
  if (agentId === undefined) return yield* stoppedAtEnd(machine, ending);
  return yield* holdingRunner(agentId, stoppedAtEnd(machine, ending));
});

export const runnerIdled = Effect.fn("web/runnerIdled")(function* (idle: RunnerEnding) {
  const machine = yield* deploymentLifecycle;
  const found = yield* firstPlace(machine, idle.target.userId, idle.sessionId);
  if (Option.isNone(found) || found.value.machine !== AGENT_MACHINE.DEVICE) return false;
  const { agentId, launch, running } = found.value;
  if (agentId === undefined || running === undefined) return false;
  if (launch !== undefined && idle.sequence < launch.firstSequence) return false;
  if (!(yield* deviceAgentAwaitsUpdate(idle.target.userId, agentId))) return false;
  return yield* retireWarmRunner({
    sessionId: idle.sessionId,
    userId: idle.target.userId,
    agentId,
    running: running.running,
  });
});

const clearedForLaunch = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* clearRunnerLines(userId, agentId, new Date(now - Duration.toMillis(CODER.LINE_GRACE)));
  });

const linesWaitAt = (userId: string, agentId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return yield* runnerLinesWaiting(
      userId,
      agentId,
      new Date(now - Duration.toMillis(CODER.LINE_GRACE)),
    );
  });

const stoppedAtEnd = Effect.fn("web/stoppedAtEnd")(function* (
  machine: MachineLifecycle,
  ending: RunnerEnding,
) {
  const found = yield* firstPlace(machine, ending.target.userId, ending.sessionId);
  if (Option.isNone(found)) return RUNNER_ENDED.STALE;
  const { launch, running, agentId } = found.value;
  if (launch !== undefined && ending.sequence < launch.firstSequence) return RUNNER_ENDED.STALE;
  if (running === undefined) return RUNNER_ENDED.STALE;
  if (
    launch?.linesRead === true &&
    agentId !== undefined &&
    ending.reason !== RUNNER_END.FAILED &&
    (yield* linesWaitAt(ending.target.userId, agentId))
  ) {
    yield* machine.firewall
      .endLaunch(running, ending.target.userId, {})
      .pipe(
        Effect.catch((failure) =>
          Effect.logWarning(
            `an ended runner's credentials stayed on a place left up for its lines: ${keptFailureWords(failureWords(failure))}`,
          ),
        ),
      );
    return RUNNER_ENDED.LINES_WAITING;
  }
  yield* machine.firewall.clear(running);
  if (yield* sandboxHeld(ending.target.conversationId, yield* DateTime.nowAsDate)) {
    return RUNNER_ENDED.HELD;
  }
  yield* machine.stop(running);
  return RUNNER_ENDED.STOPPED;
});
