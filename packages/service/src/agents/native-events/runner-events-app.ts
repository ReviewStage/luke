import { RUNNER_EVENT } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import {
  type CodingAgent,
  readCodingAgentOfConversation,
  readCodingAgentRouting,
  recordCodingAgentCompaction,
  recordCodingAgentNativeSession,
  recordCodingAgentStep,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
import { replaceCodingAgentWakeups } from "@luke/database/models/coding-agent-wakeups";
import {
  type NativeProjectionRow,
  withNativeProjection,
} from "@luke/database/models/native-projection-store";
import { setPlanStatus } from "@luke/database/models/provider-key-store";
import {
  type ConversationTarget,
  type StoreWriter,
  storeWriter,
} from "@luke/database/models/writer";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER, type CodingAgentPayer } from "@luke/features/coding-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
} from "@luke/features/provider-key-wire";
import { type WireValue, WireValueSchema } from "@luke/wire";
import { Clock, Effect, Layer, Option, Predicate, Result, Schema } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/http";
import { BRAIN_RUN_EVENT, type BrainRunEvent, TURN_ORIGIN } from "../../core.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
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
import { reopenTaskForWork, settleTaskIfFinished } from "../../tasks/task-finish.js";
import { runnerEnded } from "../coder-host/claude-code-sessions.js";
import { estimatedTokens } from "../coder-host/token-estimate.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { admitRunnerBearer, presentedBearer, runnerTokenDigest } from "../luke-mcp/bearer.js";
import { keepAliveDue } from "../sandbox-keep-alive.js";
import { keepSessionSandboxAlive } from "../session-sandboxes.js";
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

/**
 * runner-events-app.ts -- where a native harness's runner posts its events, which land in the agent's transcript.
 *
 * The runner (`@luke/agent-runner`) posts every message its harness emits,
 * numbered in order, in batches, under the bearer it was launched with, and
 * posts a batch again until Luke takes it. A bearer no standing coding
 * agent's conversation holds, a retired one's among them, is refused before
 * the body is read (`../luke-mcp/bearer.ts`). The batch is read as moments
 * by the reader of the harness the conversation runs on
 * (`claude-code-moments.ts`, `codex-moments.ts`), folded into the store
 * writer's events
 * (`native-projection.ts`), and written under the conversation's lock in
 * one transaction with the number of the last event applied, so an event
 * already applied is passed over: a batch posted again, or two posts
 * racing, write nothing twice. A write the writer refuses is said in the
 * log and passed over, as eve's relay passes one over, since the runner
 * posting the batch again would be refused again. The answer names the last
 * event applied, which a relaunch numbers its events after. A runner posting
 * is a run under way, so a post keeps its sandbox alive past its short
 * timeout, at most every keep-alive interval (`../sandbox-keep-alive.ts`),
 * stamped in the projection under the same lock, unless it ends the launch,
 * whose sandbox is stopped instead. A batch with no events is the runner's
 * heartbeat (`@luke/agent-runner`'s `RUNNER_HEARTBEAT`), posted while its
 * harness says nothing, as it may for an hour while a background command
 * runs; it applies nothing but that.
 *
 * As eve's relay does (`../coder-host/host.ts`), the route also keeps what
 * the newest model call read on the agent's row for its context ring, the
 * batch's last such reading alone, and once a batch has started or ended a
 * turn, asks for the agent's title where none stands yet
 * (`../coder-host/title.ts`), which names its untitled task with it.
 */

/** The path a runner posts its events to. */
export const RUNNER_EVENTS_PATH = "/api/agents/runner-events";

const HTTP_METHOD = { POST: "POST" } as const;

/** The most a batch may hold: the runner's 256 events, a tool's whole answer among them, under the platform's own bound. */
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

/**
 * How a harness's messages are read: one message, as its runner posted it,
 * as the moments of the run, with what the projection holds as it is read.
 */
type NativeReader = (message: WireValue, held: NativeHeld) => readonly NativeMoment[];

/** What the batch is applied for: the conversation, its agent, and what that agent runs on. */
interface Applying {
  readonly target: ConversationTarget;
  readonly agentId: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly writer: StoreWriter;
  readonly read: NativeReader;
  /** Who pays for the agent, as recorded as it started; none for an agent from before payers. */
  readonly payer: CodingAgentPayer | undefined;
  /** The plan or prompt the agent was handed first, whose share of its context the ring estimates. */
  readonly brief: string;
}

/** The asks a call made, bound to the native turn that took each one's line. */
const ASKS = askRecord();

/** The row each plan is kept in, which a turn's word on the plan is written to; a key's payer has none. */
const PLAN_ROW: Partial<
  Record<
    CodingAgentPayer,
    { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind }
  >
> = {
  [CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
    kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  },
  [CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION]: {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  },
};

/** The API key row of the agent's model's provider, which pays for an agent on its starter's key. */
function apiKeyRowOf(
  model: string,
): { readonly provider: ProviderKeyProvider; readonly kind: ProviderKeyKind } | undefined {
  const provider = providerModelOf(model)?.provider;
  return provider === undefined ? undefined : { provider, kind: PROVIDER_KEY_KIND.API_KEY };
}

/** What one post applied: how many events, and the number of the last event the conversation has applied. */
interface Applied {
  readonly applied: number;
  readonly sequence: number | null;
}

/** A run whose sandbox a batch keeps alive: the conversation, and the session its sandbox is tagged with. */
export interface RunnerAlive {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
}

/** A launch's end the batch applied: the conversation, the session it ran under, and the number of its END event. */
export interface RunnerEnded {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
  readonly sequence: number;
}

/** What the route reads a batch with and tells of a launch's end. */
export interface RunnerEventsOptions<R = never> {
  /** How every conversation's messages are read; by the harness each conversation runs on where left out. */
  readonly read?: NativeReader;
  /**
   * Told once a batch that holds a launch's END has landed, after its
   * transaction: the sandbox's own lifecycle (P08's `runnerEnded`), which
   * stops nothing for a launch since replaced. Nothing where left out.
   */
  readonly ended?: (ended: RunnerEnded) => Effect.Effect<void, never, DatabaseServices>;
  /**
   * Told once a batch due a keep-alive has landed, after its transaction:
   * the run's sandbox kept alive (`sandboxKeptAlive`). Nothing where left out.
   */
  readonly alive?: (alive: RunnerAlive) => Effect.Effect<void, never, DatabaseServices>;
  /**
   * Told once a batch that started or ended a turn has landed, after its
   * transaction: the agent's title asked for where none stands
   * (`titleNativeAgent`). Nothing where left out.
   */
  readonly title?: (
    target: ConversationTarget,
    agent: CodingAgent,
  ) => Effect.Effect<void, never, DatabaseServices | R>;
}

/**
 * A run's sandbox kept alive as a batch of its runner's events lands
 * (`../session-sandboxes.ts`'s `keepSessionSandboxAlive`), which logs a
 * keep-alive Vercel did not confirm, since the next due batch tries again.
 */
export function sandboxKeptAlive(alive: RunnerAlive): Effect.Effect<void> {
  const { sessionId } = alive;
  if (sessionId === undefined) return Effect.void;
  return keepSessionSandboxAlive(sessionId).pipe(Effect.provide(FetchHttpClient.layer));
}

/**
 * A launch's end as the sandbox hears it (`../coder-host/claude-code-sessions.ts`'s
 * `runnerEnded`): stopped, unless a developer's Terminal holds it or a newer
 * launch replaced this one. A stop that fails is said in the log and passed
 * over, because the sandbox then stops at its own timeout or when the
 * Terminal lease's sweep finds it, and the events it ended are already kept.
 */
export function sandboxAtRunnerEnd(
  ended: RunnerEnded,
): Effect.Effect<void, never, DatabaseServices> {
  const { sessionId } = ended;
  if (sessionId === undefined) return Effect.void;
  return runnerEnded({ target: ended.target, sessionId, sequence: ended.sequence }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(
        `runner-events: the sandbox was not stopped at its launch's end: ${failure._tag}`,
      ),
    ),
  );
}

/** Which of the batch's writes moved a turn: one started, one ended, or both, as the task follows them. */
interface TurnsMoved {
  readonly started: boolean;
  readonly ended: boolean;
}

/** Whether the writes start a turn, and whether they end one, by the events they carry. */
function turnsMovedBy(writes: readonly NativeWrite[]): TurnsMoved {
  const kinds = new Set(
    writes.flatMap((write) => (write.kind === NATIVE_WRITE.EVENT ? [write.event.kind] : [])),
  );
  return {
    started: kinds.has(BRAIN_RUN_EVENT.TURN_STARTED),
    ended: kinds.has(BRAIN_RUN_EVENT.TURN_ENDED),
  };
}

/** The numbers of the events that end a launch, by the runner's own END. */
function endsOf(batch: RunnerEventBatch, after: number | null): readonly number[] {
  return unapplied(batch, after).flatMap(({ sequence, message }) =>
    Predicate.isObject(message) && "type" in message && message.type === RUNNER_EVENT.END
      ? [sequence]
      : [],
  );
}

const registered = (name: string): boolean => Object.hasOwn(CODER_TOOL_SET, name);

/** The events of the batch not yet applied, in order, each number once. */
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

/** Says a write the writer refused, which is passed over rather than posted again. */
function reportRefused(what: string, result: Result.Result<unknown, { readonly refusal: string }>) {
  return Result.isFailure(result)
    ? Effect.logWarning(`runner-events: the store refused ${what}: ${result.failure.refusal}`)
    : Effect.void;
}

/** Lands the events gathered so far as one write of the writer. */
function landEvents(applying: Applying, events: readonly BrainRunEvent[]) {
  return Effect.gen(function* () {
    if (events.length === 0) return;
    const results = yield* applying.writer.consumeAll(applying.target, events);
    for (const [index, result] of results.entries()) {
      yield* reportRefused(`a ${events[index]?.kind} event`, result);
    }
  });
}

/** One write the projection asked for, other than an event. */
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
          // A native turn's id is the one a Stop names it by (`coder-host/stop.ts`), since no runtime mints another.
          eveTurnId: write.turnId,
          origin: TURN_ORIGIN.TYPED,
          model: applying.model,
          reasoningEffort: applying.reasoningEffort,
        }),
        (result) => reportRefused("a turn's queueing", result),
      );
    case NATIVE_WRITE.TAKE_LINE:
      // A typed line awaits its turn as a row; a call's ask has none and is bound by its delivery,
      // the line's id the ask named (`brain-host/brain-ask.ts`), so the call follows the turn.
      return Effect.flatMap(
        ASKS.bindDeliveries(target, [write.clientId], write.turnId, write.joinedAfterStep),
        (bound) =>
          bound.length > 0
            ? Effect.void
            : Effect.flatMap(
                writer.takeAwaitingLine(target, { clientId: write.clientId, turnId: write.turnId }),
                (result) => reportRefused("a line's taking", result),
              ),
      );
    case NATIVE_WRITE.SESSION:
      return Effect.asVoid(
        recordCodingAgentNativeSession(target.userId, applying.agentId, write.sessionId),
      );
    case NATIVE_WRITE.COMPACTED:
      return recordCodingAgentCompaction(target.userId, applying.agentId, new Date(now));
    case NATIVE_WRITE.CONTEXT:
      // Note that the harness's own instructions and tools are no text Luke composed, so they are
      // told as the conversation's share rather than estimated, and the brief alone is estimated.
      return recordCodingAgentStep(target.userId, applying.agentId, {
        ...write.usage,
        systemPromptTokens: 0,
        toolDefinitionTokens: 0,
        briefTokens: estimatedTokens(JSON.stringify(applying.brief)),
        at: now,
      });
    case NATIVE_WRITE.WAKEUPS:
      return replaceCodingAgentWakeups(
        applying.agentId,
        write.wakeups.map(({ at, prompt }) => ({ at: new Date(at), prompt })),
      );
    case NATIVE_WRITE.PLAN_STATUS: {
      // Note that the row is the starter's credential that pays: its plan's, or, for an agent its API key
      // pays for, that key's, which a refusal marks invalid as eve's step does; a plan's limit is no key's.
      const row =
        applying.payer === CODING_AGENT_PAYER.API_KEY
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

/**
 * The writes, in order: the events between two other writes land together
 * as one of the writer's batches, so a turn's journal is rewritten once per
 * run of them rather than once for each.
 */
function landWrites(applying: Applying, writes: readonly NativeWrite[], now: number) {
  return Effect.gen(function* () {
    let events: BrainRunEvent[] = [];
    // Only the newest reading of the context stands, so one batch writes it once.
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

/** The batch's events not yet applied, projected and written, and the place the conversation keeps after them. */
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
        registered,
        report: (said) => reports.push(said),
      });
      state = projected.state;
      writes.push(...projected.writes);
      // A turn starting takes the servers mentioned to the agent since its last turn started, as
      // eve's turn start does (`agent-runtime/servers.ts`), and keeps them for its calls at Luke's
      // MCP server, which hands them whatever the switches say (`integrations/connection-door.ts`).
      // They are taken event by event, so a turn that starts and ends within one batch takes its
      // own, never the next turn's.
      for (const write of projected.writes) {
        if (write.kind !== NATIVE_WRITE.ENQUEUE) continue;
        const taken = yield* takeCodingAgentMentionedServers(
          applying.target.userId,
          applying.target.conversationId,
        );
        state = withTurnServers(state, write.turnId, taken);
      }
    }
    for (const said of reports) yield* Effect.logWarning(`runner-events: ${said}`);
    yield* landWrites(applying, writes, now);
    const last = events.at(-1)?.sequence;
    const ends = endsOf(batch, held.sequence);
    // Any post is the runner still running, a heartbeat with no events among them, but a batch that
    // ends the launch keeps nothing alive, since its sandbox is stopped once it lands; and a launch
    // that has applied nothing yet has a sandbox that opened moments ago.
    const sequence = last ?? held.sequence;
    const keepsAlive =
      sequence !== null && ends.length === 0 && keepAliveDue(state.keptAliveAt, now);
    if (keepsAlive) state = { ...state, keptAliveAt: now };
    const result = {
      applied: { applied: events.length, sequence: last ?? held.sequence } satisfies Applied,
      ends,
      turns: turnsMovedBy(writes),
      keepsAlive,
    };
    return sequence === null || (last === undefined && !keepsAlive)
      ? { result }
      : { result, saved: { sequence, projection: state } };
  });
}

/** POST: one batch of a runner's events, admitted by its bearer and applied once. */
const runnerEventsEndpoint = /* @__PURE__ */ Effect.fn("web/runnerEventsEndpoint")(function* <R>(
  options: RunnerEventsOptions<R>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices | R
> {
  const { read, ended, alive, title } = options;
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
  const agent = yield* hostedStoreOrUnavailable(
    readCodingAgentOfConversation(target.userId, target.conversationId),
  );
  if (Option.isNone(agent)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const routing = yield* hostedStoreOrUnavailable(
    readCodingAgentRouting(target.userId, agent.value.id),
  );
  const runtime = Option.map(routing, (row) => row.runtime);
  const reader =
    read ??
    (Option.contains(runtime, CONVERSATION_RUNTIME.CODEX) ? codexMoments : claudeCodeMoments);
  const body = yield* readBodyBytesEffect(MAX_BODY_BYTES);
  const batch = readBatch(yield* parseJsonBytes(body));
  if (Option.isNone(batch)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
  const applying: Applying = {
    target,
    agentId: agent.value.id,
    model: agent.value.model,
    reasoningEffort: agent.value.effort,
    writer,
    read: reader,
    payer: Option.getOrUndefined(routing)?.payer ?? undefined,
    brief: agent.value.prompt ?? agent.value.planSnapshot ?? "",
  };
  const applied = yield* hostedStoreOrUnavailable(
    withNativeProjection(target, runnerTokenDigest(bearer), (held) =>
      applyBatch(applying, batch.value, held),
    ),
  );
  // Note that a conversation cleared, or a bearer retired, since the bearer was read takes nothing more.
  if (Option.isNone(applied)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  // The task follows the turns the batch moved, once their rows are written: a turn starting takes
  // it up, and a turn's end may have finished its work (`tasks/task-finish.ts`).
  const { taskId } = agent.value;
  if (taskId !== null && applied.value.turns.started) {
    yield* reopenTaskForWork(target.userId, taskId);
  }
  if (taskId !== null && applied.value.turns.ended) {
    yield* settleTaskIfFinished(target.userId, taskId);
  }
  // Note that the title is awaited rather than forked, because the function instance ends with the answer.
  if (title !== undefined && (applied.value.turns.started || applied.value.turns.ended)) {
    yield* title(target, agent.value);
  }
  if (alive !== undefined && applied.value.keepsAlive) {
    yield* alive({ target, sessionId: admitted.value.runtimeSessionId });
  }
  if (ended !== undefined) {
    for (const sequence of applied.value.ends) {
      yield* ended({ target, sessionId: admitted.value.runtimeSessionId, sequence });
    }
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, applied.value.applied);
});

/** The group: the one events path, read as the conversation's harness's unless told otherwise, and the hosted vocabulary's own refusal for any other. */
export function runnerEventsApp<R = never>(
  options: RunnerEventsOptions<R> = {},
): WebRoutes<DatabaseServices | R> {
  const endpoint = runnerEventsEndpoint(options);
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_EVENTS_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
