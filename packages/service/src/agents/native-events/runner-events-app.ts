import { RUNNER_EVENT } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import {
  readCodingAgentOfConversation,
  readCodingAgentRouting,
  recordCodingAgentCompaction,
  recordCodingAgentNativeSession,
  takeCodingAgentMentionedServers,
} from "@luke/database/models/coding-agent-store";
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
import { type BrainRunEvent, TURN_ORIGIN } from "../../core.js";
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
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import { runnerEnded } from "../coder-host/claude-code-sessions.js";
import { CODER_TOOL_SET } from "../coder-host/tool-set.js";
import { admitRunnerBearer, presentedBearer, runnerTokenDigest } from "../luke-mcp/bearer.js";
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
 * event applied, which a relaunch numbers its events after.
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
}

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

/** What one post applied: how many events, and the number of the last event the conversation has applied. */
interface Applied {
  readonly applied: number;
  readonly sequence: number | null;
}

/** A launch's end the batch applied: the conversation, the session it ran under, and the number of its END event. */
export interface RunnerEnded {
  readonly target: ConversationTarget;
  readonly sessionId: string | undefined;
  readonly sequence: number;
}

/** What the route reads a batch with and tells of a launch's end. */
export interface RunnerEventsOptions {
  /** How every conversation's messages are read; by the harness each conversation runs on where left out. */
  readonly read?: NativeReader;
  /**
   * Told once a batch that holds a launch's END has landed, after its
   * transaction: the sandbox's own lifecycle (P08's `runnerEnded`), which
   * stops nothing for a launch since replaced. Nothing where left out.
   */
  readonly ended?: (ended: RunnerEnded) => Effect.Effect<void, never, DatabaseServices>;
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
      return Effect.flatMap(
        writer.takeAwaitingLine(target, { clientId: write.clientId, turnId: write.turnId }),
        (result) => reportRefused("a line's taking", result),
      );
    case NATIVE_WRITE.SESSION:
      return Effect.asVoid(
        recordCodingAgentNativeSession(target.userId, applying.agentId, write.sessionId),
      );
    case NATIVE_WRITE.COMPACTED:
      return recordCodingAgentCompaction(target.userId, applying.agentId, new Date(now));
    case NATIVE_WRITE.PLAN_STATUS: {
      // Note that the plan's row is the starter's, whose plan pays, and an agent a key pays for writes none.
      const row = applying.payer === undefined ? undefined : PLAN_ROW[applying.payer];
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
    for (const write of writes) {
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
    const result = {
      applied: { applied: events.length, sequence: last ?? held.sequence } satisfies Applied,
      ends: endsOf(batch, held.sequence),
    };
    return last === undefined
      ? { result }
      : { result, saved: { sequence: last, projection: state } };
  });
}

/** POST: one batch of a runner's events, admitted by its bearer and applied once. */
const runnerEventsEndpoint = /* @__PURE__ */ Effect.fn("web/runnerEventsEndpoint")(function* (
  read: NativeReader | undefined,
  ended: RunnerEventsOptions["ended"],
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
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
  };
  const applied = yield* hostedStoreOrUnavailable(
    withNativeProjection(target, runnerTokenDigest(bearer), (held) =>
      applyBatch(applying, batch.value, held),
    ),
  );
  // Note that a conversation cleared, or a bearer retired, since the bearer was read takes nothing more.
  if (Option.isNone(applied)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  if (ended !== undefined) {
    for (const sequence of applied.value.ends) {
      yield* ended({ target, sessionId: admitted.value.runtimeSessionId, sequence });
    }
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, applied.value.applied);
});

/** The group: the one events path, read as the conversation's harness's unless told otherwise, and the hosted vocabulary's own refusal for any other. */
export function runnerEventsApp(options: RunnerEventsOptions = {}): WebRoutes<DatabaseServices> {
  const endpoint = runnerEventsEndpoint(options.read, options.ended);
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, RUNNER_EVENTS_PATH, hostedRefusing(endpoint)),
    hostedNotFoundRoute,
  );
}
