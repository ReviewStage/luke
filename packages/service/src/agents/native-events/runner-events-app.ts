import { RUNNER_END, RUNNER_EVENT, type RunnerEnd } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  readAgentOfConversation,
  readAgentRouting,
  recordAgentCompaction,
  recordAgentNativeSession,
  recordAgentStep,
  takeAgentMentionedServers,
} from "@repo/database/models/agent-store";
import { replaceAgentWakeups } from "@repo/database/models/agent-wakeups";
import {
  type NativeProjectionRow,
  withNativeProjection,
} from "@repo/database/models/native-projection-store";
import { setPlanStatus } from "@repo/database/models/provider-key-store";
import { acceptRunnerLine } from "@repo/database/models/runner-line-store";
import {
  type ConversationTarget,
  type SettledAgentTurn,
  SettledTurnListener,
  type StoreWriter,
  storeWriter,
} from "@repo/database/models/writer";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { AGENT_PAYER, type AgentPayer } from "@repo/features/agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
} from "@repo/features/provider-key-wire";
import { HTTP_METHOD, type WireValue, WireValueSchema } from "@repo/wire";
import {
  Cause,
  Clock,
  Data,
  Effect,
  ErrorReporter,
  Layer,
  Option,
  Predicate,
  Result,
  Schema,
  type Scope,
} from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { RUN_EVENT, type RunEvent, TURN_ORIGIN } from "../../core.js";
import { afterResponse } from "../../http/after-response.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  HOSTED_REFUSAL_STATUS,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { reopenTaskForWork, settleTaskAfterTurn } from "../../tasks/task-finish.js";
import { harnessOf } from "../coder-host/native-runtime.js";
import { RUNNER_ENDED, runnerEnded, runnerIdled } from "../coder-host/runner-sessions.js";
import { NativeAgentSessions } from "../coder-host/runtime-sessions.js";
import { estimatedTokens } from "../coder-host/token-estimate.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { compactNativeTurnHanded } from "../coder-host/turn-message.js";
import { keepAliveDue } from "../sandbox-keep-alive.js";
import { keepSessionSandboxAlive } from "../session-sandboxes.js";
import { admitRunnerBearer, presentedBearer, runnerTokenDigest } from "../workspace-mcp/bearer.js";
import { claudeCodeMoments } from "./claude-code-moments.js";
import { codexMoments } from "./codex-moments.js";
import type { NativeHeld, NativeMoment } from "./native-moments.js";
import {
  heldProjection,
  NATIVE_WRITE,
  type NativeProjection,
  type NativeWrite,
  projectMoments,
  withTurnServers,
} from "./native-projection.js";
import { redactKeepingPlanCodes } from "./runner-moments.js";

export const RUNNER_EVENTS_PATH = "/api/agents/runner-events";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const RunnerEventBatchSchema = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      sequence: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      message: WireValueSchema,
    }),
  ),
});
type RunnerEventBatch = typeof RunnerEventBatchSchema.Type;

const readBatch = Schema.decodeUnknownOption(RunnerEventBatchSchema);

type NativeReader = (message: WireValue, held: NativeHeld) => readonly NativeMoment[];

interface Applying {
  readonly target: ConversationTarget;
  readonly agentId: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly writer: StoreWriter;
  readonly read: NativeReader;
  readonly payer: AgentPayer | undefined;
  readonly brief: string;
}

const PLAN_ROW: Partial<
  Record<AgentPayer, { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind }>
> = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  },
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  },
};

function apiKeyRowOf(
  model: string,
): { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind } | undefined {
  const provider = providerModelOf(model)?.provider;
  return provider === undefined ? undefined : { provider, kind: PROVIDER_KEY_KIND.API_KEY };
}

interface Applied {
  readonly applied: number;
  readonly sequence: number | null;
}

export interface RunnerAlive {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
}

export interface RunnerEnded {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
  readonly sequence: number;
  readonly reason?: RunnerEnd | undefined;
  readonly runtime?: ConversationRuntime | undefined;
}

export interface RunnerEventsOptions<R = never> {
  readonly read?: NativeReader;
  readonly ended?: (ended: RunnerEnded) => Effect.Effect<void, never, DatabaseServices>;
  readonly idled?: (idled: RunnerEnded) => Effect.Effect<void, never, DatabaseServices>;
  readonly alive?: (alive: RunnerAlive) => Effect.Effect<void, never, DatabaseServices>;
  readonly title?: (
    target: ConversationTarget,
    agent: Agent,
  ) => Effect.Effect<void, never, DatabaseServices | R>;
  readonly turnEnded?: (agent: Agent) => Effect.Effect<void, never, DatabaseServices | R>;
}

export function sandboxKeptAlive(alive: RunnerAlive): Effect.Effect<void> {
  const { sessionId } = alive;
  if (sessionId === undefined) return Effect.void;
  return keepSessionSandboxAlive(sessionId).pipe(Effect.provide(FetchHttpClient.layer));
}

export function sandboxAtRunnerEnd(
  ended: RunnerEnded,
): Effect.Effect<void, never, DatabaseServices> {
  const { sessionId } = ended;
  if (sessionId === undefined) return Effect.void;
  return afterResponse(
    "a launch's end",
    runnerEnded({
      target: ended.target,
      sessionId,
      sequence: ended.sequence,
      reason: ended.reason,
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.flatMap((left) =>
        left === RUNNER_ENDED.LINES_WAITING ? waitingHandedOn(ended, sessionId) : Effect.void,
      ),
      Effect.catch((failure) =>
        Effect.logWarning(
          `runner-events: the sandbox was not stopped at its launch's end: ${failure._tag}`,
        ),
      ),
    ),
  );
}

const waitingHandedOn = (ended: RunnerEnded, sessionId: string) =>
  Effect.gen(function* () {
    const native = yield* Effect.serviceOption(NativeAgentSessions);
    const runtime = harnessOf(ended.runtime);
    const reached =
      runtime === undefined
        ? Option.none()
        : Option.flatMap(native, (service) => service.sessions(runtime, ended.target.userId));
    if (Option.isNone(reached)) {
      return yield* Effect.logWarning(
        "runner-events: a launch's waiting lines could not be handed on here",
      );
    }
    const sessions = yield* reached.value;
    yield* sessions.deliverWaiting(sessionId, ended.target.conversationId);
  });

export function sandboxAtRunnerIdle(
  idled: RunnerEnded,
): Effect.Effect<void, never, DatabaseServices> {
  const { sessionId } = idled;
  if (sessionId === undefined) return Effect.void;
  return runnerIdled({ target: idled.target, sessionId, sequence: idled.sequence }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`runner-events: the idle runner was not retired: ${failure._tag}`),
    ),
  );
}

interface TurnsMoved {
  readonly started: boolean;
  readonly ended: boolean;
}

function turnsMovedBy(writes: readonly NativeWrite[]): TurnsMoved {
  const kinds = new Set(
    writes.flatMap((write) => (write.kind === NATIVE_WRITE.EVENT ? [write.event.kind] : [])),
  );
  return {
    started: kinds.has(RUN_EVENT.TURN_STARTED),
    ended: kinds.has(RUN_EVENT.TURN_ENDED),
  };
}

function runnerEventsOf(
  batch: RunnerEventBatch,
  after: number | null,
  type: (typeof RUNNER_EVENT)[keyof typeof RUNNER_EVENT],
): readonly number[] {
  return unapplied(batch, after).flatMap(({ sequence, message }) =>
    Predicate.isObject(message) && "type" in message && message.type === type ? [sequence] : [],
  );
}

const decodeEndReason = Schema.decodeUnknownOption(Schema.Literals(Object.values(RUNNER_END)));

function runnerEndsOf(
  batch: RunnerEventBatch,
  after: number | null,
): readonly { readonly sequence: number; readonly reason: RunnerEnd | undefined }[] {
  return unapplied(batch, after).flatMap(({ sequence, message }) =>
    Predicate.isObject(message) && "type" in message && message.type === RUNNER_EVENT.END
      ? [
          {
            sequence,
            reason: Option.getOrUndefined(
              decodeEndReason("reason" in message ? message.reason : undefined),
            ),
          },
        ]
      : [],
  );
}

const registered = (name: string): boolean => Object.hasOwn(CODER_TOOL_SET, name);

function unapplied(batch: RunnerEventBatch, after: number | null): RunnerEventBatch["events"] {
  const seen = new Set<number>();
  return [...batch.events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => {
      if ((after !== null && event.sequence <= after) || seen.has(event.sequence)) return false;
      seen.add(event.sequence);
      return true;
    });
}

class NativeTurnFailed extends Data.TaggedError("NativeTurnFailed")<{
  readonly message: string;
  readonly [ErrorReporter.attributes]: Readonly<Record<string, string>>;
}> {}

type FailedTurn = Extract<NativeWrite, { kind: typeof NATIVE_WRITE.FAILED }>;

function paysOwnCredential(payer: AgentPayer | undefined): boolean {
  return payer === AGENT_PAYER.API_KEY || (payer !== undefined && PLAN_ROW[payer] !== undefined);
}

function sayTurnFailed(
  failed: FailedTurn,
  harness: ConversationRuntime,
  payer: AgentPayer | undefined,
  ids: Readonly<Record<string, string>>,
) {
  const attributes = {
    ...ids,
    harness,
    turnId: failed.turnId,
    failure: failed.failure,
    detail: redactKeepingPlanCodes(failed.detail),
  };
  const issue = new NativeTurnFailed({
    message: `a ${harness} turn failed: ${failed.failure}`,
    [ErrorReporter.attributes]: attributes,
  });
  return Effect.andThen(
    Effect.logError("runner-events: a native turn failed").pipe(Effect.annotateLogs(attributes)),
    failed.expected || (failed.refused && paysOwnCredential(payer))
      ? Effect.void
      : ErrorReporter.report(Cause.fail(issue)),
  );
}

function reportRefused(what: string, result: Result.Result<unknown, { readonly refusal: string }>) {
  return Result.isFailure(result)
    ? Effect.logWarning(`runner-events: the store refused ${what}: ${result.failure.refusal}`)
    : Effect.void;
}

function landEvents(applying: Applying, events: readonly RunEvent[]) {
  return Effect.gen(function* () {
    if (events.length === 0) return;
    const results = yield* applying.writer.consumeAll(applying.target, events);
    for (const [index, result] of results.entries()) {
      yield* reportRefused(`a ${events[index]?.kind} event`, result);
    }
  });
}

function landWrite(
  applying: Applying,
  write: Exclude<NativeWrite, { kind: "event" }>,
  now: number,
) {
  const { target, writer } = applying;
  switch (write.kind) {
    case NATIVE_WRITE.ENQUEUE:
      return Effect.flatMap(
        writer.enqueueTurn(target, {
          turnId: write.turnId,
          eveTurnId: write.turnId,
          origin: TURN_ORIGIN.TYPED,
          model: applying.model,
          reasoningEffort: applying.reasoningEffort,
        }),
        (result) => reportRefused("a turn's queueing", result),
      );
    case NATIVE_WRITE.TAKE_LINE:
      return Effect.flatMap(
        Effect.andThen(
          acceptRunnerLine(target.userId, applying.agentId, write.clientId),
          writer.takeAwaitingLine(target, { clientId: write.clientId, turnId: write.turnId }),
        ),
        (result) => reportRefused("a line's taking", result),
      );
    case NATIVE_WRITE.SESSION:
      return Effect.asVoid(
        recordAgentNativeSession(target.userId, applying.agentId, write.sessionId),
      );
    case NATIVE_WRITE.COMPACTED:
      return Effect.andThen(
        recordAgentCompaction(target.userId, applying.agentId, new Date(now)),
        compactNativeTurnHanded(target),
      );
    case NATIVE_WRITE.CONTEXT:
      return recordAgentStep(target.userId, applying.agentId, {
        ...write.usage,
        systemPromptTokens: 0,
        toolDefinitionTokens: 0,
        briefTokens: estimatedTokens(JSON.stringify(applying.brief)),
        at: now,
      });
    case NATIVE_WRITE.FAILED:
      return Effect.void;
    case NATIVE_WRITE.WAKEUPS:
      return replaceAgentWakeups(
        applying.agentId,
        write.wakeups.map(({ at, prompt }) => ({ at: new Date(at), prompt })),
      );
    case NATIVE_WRITE.PLAN_STATUS: {
      const row =
        applying.payer === AGENT_PAYER.API_KEY
          ? write.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
            ? undefined
            : apiKeyRowOf(applying.model)
          : applying.payer === undefined
            ? undefined
            : PLAN_ROW[applying.payer];
      if (row === undefined) return Effect.void;
      return setPlanStatus(
        target.userId,
        row.provider,
        row.kind,
        write.status,
        write.resetsAt === undefined ? undefined : new Date(write.resetsAt),
        new Date(write.turnOpenedAt ?? now),
        new Date(now),
      );
    }
  }
}

function landWrites(applying: Applying, writes: readonly NativeWrite[], now: number) {
  return Effect.gen(function* () {
    let events: RunEvent[] = [];
    const lastContext = writes.findLastIndex((write) => write.kind === NATIVE_WRITE.CONTEXT);
    for (const [index, write] of writes.entries()) {
      if (write.kind === NATIVE_WRITE.CONTEXT && index !== lastContext) continue;
      if (write.kind === NATIVE_WRITE.EVENT) {
        events.push(write.event);
        continue;
      }
      yield* landEvents(applying, events);
      events = [];
      yield* landWrite(applying, write, now);
    }
    yield* landEvents(applying, events);
  });
}

function applyBatch(applying: Applying, batch: RunnerEventBatch, held: NativeProjectionRow) {
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const events = unapplied(batch, held.sequence);
    let state: NativeProjection = heldProjection(held.projection);
    const writes: NativeWrite[] = [];
    const reports: string[] = [];
    for (const { sequence, message } of events) {
      const held: NativeHeld = {
        callName: (callId) => state.turn?.calls[callId],
        session: state.session,
        sequence,
      };
      const moments = applying.read(message, held);
      const projected = projectMoments(state, moments, {
        conversationId: applying.target.conversationId,
        sequence,
        now,
        model: applying.model,
        ownKey: applying.payer === AGENT_PAYER.API_KEY,
        registered,
        report: (said) => reports.push(said),
      });
      state = projected.state;
      writes.push(...projected.writes);
      for (const write of projected.writes) {
        if (write.kind !== NATIVE_WRITE.ENQUEUE) continue;
        const taken = yield* takeAgentMentionedServers(
          applying.target.userId,
          applying.target.conversationId,
        );
        state = withTurnServers(state, write.turnId, taken);
      }
    }
    for (const said of reports) yield* Effect.logWarning(`runner-events: ${said}`);
    yield* landWrites(applying, writes, now);
    const last = events.at(-1)?.sequence;
    const ends = runnerEndsOf(batch, held.sequence);
    const idle =
      ends.length === 0
        ? runnerEventsOf(batch, held.sequence, RUNNER_EVENT.IDLE).at(-1)
        : undefined;
    const sequence = last ?? held.sequence;
    const keepsAlive =
      sequence !== null && ends.length === 0 && keepAliveDue(state.keptAliveAt, now);
    if (keepsAlive) state = { ...state, keptAliveAt: now };
    const result = {
      applied: { applied: events.length, sequence: last ?? held.sequence } satisfies Applied,
      ends,
      idle,
      turns: turnsMovedBy(writes),
      failed: writes.filter((write): write is FailedTurn => write.kind === NATIVE_WRITE.FAILED),
      keepsAlive,
    };
    return sequence === null || (last === undefined && !keepsAlive)
      ? { result }
      : { result, saved: { sequence, projection: state } };
  });
}

function eventCountOf(parsed: unknown): number | undefined {
  if (!Predicate.isObject(parsed) || !("events" in parsed)) return undefined;
  return Array.isArray(parsed.events) ? parsed.events.length : undefined;
}

const batchRefused = (
  ids: { readonly agentId: string; readonly conversationId: string },
  refusal: HostedRefusal,
  size: { readonly bytes: number | string; readonly events?: number | undefined },
) =>
  Effect.logWarning(`runner-events: a batch was refused: ${refusal.error}`).pipe(
    Effect.annotateLogs({
      ...ids,
      status: HOSTED_REFUSAL_STATUS[refusal.error],
      bytes: size.bytes,
      events: size.events ?? "unknown",
    }),
  );

const runnerEventsEndpoint = /* @__PURE__ */ Effect.fn("web/runnerEventsEndpoint")(function* <R>(
  options: RunnerEventsOptions<R>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | Scope.Scope | R
> {
  const { read, ended, idled, alive, title, turnEnded } = options;
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
  if (Option.isNone(admitted)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { target } = admitted.value;
  yield* Effect.annotateLogsScoped({ userId: target.userId });
  const agent = yield* hostedStoreOrUnavailable(
    readAgentOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(readAgentRouting(target.userId, agent.value.id));
  const runtime = Option.map(routing, (row) => row.runtime);
  const codex = Option.contains(runtime, CONVERSATION_RUNTIME.CODEX);
  const reader = read ?? (codex ? codexMoments : claudeCodeMoments);
  const refusedFor = { agentId: agent.value.id, conversationId: target.conversationId };
  const body = yield* readBodyBytesEffect(MAX_BODY_BYTES).pipe(
    Effect.tapError((refusal) =>
      batchRefused(refusedFor, refusal, {
        bytes: request.headers.get("content-length") ?? `over ${MAX_BODY_BYTES}`,
      }),
    ),
  );
  const parsed = yield* parseJsonBytes(body).pipe(
    Effect.tapError((refusal) => batchRefused(refusedFor, refusal, { bytes: body.byteLength })),
  );
  const batch = readBatch(parsed);
  if (Option.isNone(batch)) {
    yield* batchRefused(refusedFor, HOSTED_REFUSAL.INVALID_REQUEST, {
      bytes: body.byteLength,
      events: eventCountOf(parsed),
    });
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const applying: Applying = {
    target,
    agentId: agent.value.id,
    model: agent.value.model,
    reasoningEffort: agent.value.effort,
    writer,
    read: reader,
    payer: Option.getOrUndefined(routing)?.payer ?? undefined,
    brief: agent.value.prompt ?? agent.value.descriptionSnapshot ?? "",
  };
  const settled: SettledAgentTurn[] = [];
  const collecting = Layer.succeed(SettledTurnListener, {
    heard: (turn) => Effect.sync(() => void settled.push(turn)),
  });
  const applied = yield* hostedStoreOrUnavailable(
    withNativeProjection(target, runnerTokenDigest(bearer), (held) =>
      applyBatch(applying, batch.value, held),
    ).pipe(Effect.provide(collecting)),
  );
  const listener = yield* Effect.serviceOption(SettledTurnListener);
  if (Option.isSome(listener)) {
    yield* Effect.forEach(settled, listener.value.heard, { discard: true });
  }
  if (Option.isNone(applied)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const { taskId } = agent.value;
  const { runtimeSessionId } = admitted.value;
  for (const failed of applied.value.failed) {
    const harness = codex ? CONVERSATION_RUNTIME.CODEX : CONVERSATION_RUNTIME.CLAUDE_CODE;
    yield* sayTurnFailed(failed, harness, applying.payer, {
      agentId: agent.value.id,
      conversationId: target.conversationId,
      ...(taskId === null ? undefined : { taskId }),
      ...(runtimeSessionId === undefined ? undefined : { sandboxSessionId: runtimeSessionId }),
    });
  }
  if (taskId !== null && applied.value.turns.started) {
    yield* reopenTaskForWork(target.userId, taskId);
  }
  if (taskId !== null && applied.value.turns.ended) {
    yield* settleTaskAfterTurn(target.userId, taskId, agent.value.id);
  }
  if (title !== undefined && (applied.value.turns.started || applied.value.turns.ended)) {
    yield* afterResponse("a coding agent's title", title(target, agent.value));
  }
  if (turnEnded !== undefined && applied.value.turns.ended) {
    yield* afterResponse("a coding agent's queue", turnEnded(agent.value));
  }
  if (alive !== undefined && applied.value.keepsAlive) {
    yield* alive({ target, sessionId: admitted.value.runtimeSessionId });
  }
  if (ended !== undefined) {
    for (const { sequence, reason } of applied.value.ends) {
      yield* ended({
        target,
        sessionId: admitted.value.runtimeSessionId,
        sequence,
        reason,
        runtime: Option.getOrUndefined(runtime),
      });
    }
  }
  if (idled !== undefined && applied.value.idle !== undefined) {
    yield* idled({
      target,
      sessionId: admitted.value.runtimeSessionId,
      sequence: applied.value.idle,
    });
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, applied.value.applied);
});

export function runnerEventsApp<R = never>(
  options: RunnerEventsOptions<R> = {},
): WebRoutes<DatabaseServices | R> {
  const endpoint = runnerEventsEndpoint(options);
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_EVENTS_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
