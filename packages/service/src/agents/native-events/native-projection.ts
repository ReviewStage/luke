import { nativeTurnId, reasoningItemId } from "@luke/database/models/ids";
import type { WireValue } from "@luke/wire";
import { Option, Schema } from "effect";
import {
  addModelUsage,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  type BrainRequestStatus,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainRunUsage,
  finishedSentencesOf,
  sessionKey,
} from "../../core.js";
import { BRAIN_HOST_TURN, BRAIN_HOST_TURN_KIND } from "../brain-host/bounds.js";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeMoment,
  type NativeWakeup,
  PLAN_STATUS,
  type PlanStatus,
} from "./native-moments.js";

/**
 * native-projection.ts -- a native harness's moments folded into the store writer's events, as eve's relay folds eve's stream.
 *
 * A coding agent on a native harness runs one turn per launch of its runner:
 * the turn opens at the first sign of work (the line Luke handed it, the
 * harness's start, or its first words) and ends with the launch, so a model
 * turn that ends with background work or a wakeup still to come leaves the
 * agent's turn running, as eve's parked turn does. Inside it each model call
 * is a step; its words are told the writer a finished sentence at a time
 * while they form, and whole once the step is over; each call stands in the
 * record before its answer and settles with it; reasoning joins under an id
 * minted from the step. The turn's journal is the record of its work, and
 * the writer closes it with the turn's end, keeping a coding agent's words,
 * so no answer is rebuilt from what the projection held. The usage of each
 * model turn is summed onto the turn and settled with it, on the model the
 * agent ran on. What the projection holds between the runner's batches is
 * this file's `NativeProjection`, small whatever the run's length: the turn,
 * its step, the step's words so far, and the calls it holds by name.
 *
 * The projection is pure: it answers the state it moved to and the writes,
 * in order, that the route makes under the conversation's lock
 * (`runner-events-app.ts`), so a test reads what a stream amounts to
 * without a database.
 */

/** A step's words: those it completed, those still forming, and how much of them the writer was told. */
const DraftSchema = Schema.Struct({
  completed: Schema.String,
  forming: Schema.String,
  told: Schema.Number,
});
type Draft = typeof DraftSchema.Type;

const EMPTY_DRAFT: Draft = { completed: "", forming: "", told: 0 };

const StepSchema = Schema.Struct({
  /** The harness's own id for the model call's answer, where it named one. */
  key: Schema.optionalKey(Schema.String),
  /** Whether the step takes more of its call's answer; a closed step's next words open another. */
  open: Schema.Boolean,
  draft: DraftSchema,
  /** How many reasoning summaries the step told, which numbers the next one's id. */
  reasoning: Schema.Number,
});
type Step = typeof StepSchema.Type;

const UsageSchema = Schema.Struct({
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  cachedInputTokens: Schema.Number,
  reasoningTokens: Schema.Number,
  cacheWriteTokens: Schema.optionalKey(Schema.Number),
});

const TurnSchema = Schema.Struct({
  /** The store's id for the turn. */
  id: Schema.String,
  /** When the turn opened, in epoch milliseconds; absent on a turn kept from before it was recorded. */
  openedAt: Schema.optionalKey(Schema.Number),
  /** The number of the last event told the writer for the turn, which numbers its next. */
  told: Schema.Number,
  /** How many steps the turn has opened. */
  steps: Schema.Number,
  step: Schema.optionalKey(StepSchema),
  /** The calls the turn holds, by id, under the name each is stored under. */
  calls: Schema.Record(Schema.String, Schema.String),
  usage: Schema.optionalKey(UsageSchema),
  /** Why the newest model turn failed, where it did. */
  failure: Schema.optionalKey(Schema.String),
  /** The MCP servers mentioned to the agent that this turn took as it started, which its calls are handed whatever the switches say. */
  servers: Schema.optionalKey(Schema.Array(Schema.String)),
});
type Turn = typeof TurnSchema.Type;

/** What the projection keeps between batches. */
const NativeProjectionSchema = Schema.Struct({
  turn: Schema.optionalKey(TurnSchema),
  /** The harness's own session id as last recorded. */
  session: Schema.optionalKey(Schema.String),
  /** The plan's limit as it last refused the harness, kept until it lifts. */
  rateLimit: Schema.optionalKey(Schema.String),
  /** When that limit resets, in epoch milliseconds, where the harness said. */
  rateLimitResetsAt: Schema.optionalKey(Schema.Number),
  /** The running total a harness that reports one (Codex) last reported, which the next report is metered against. */
  metered: Schema.optionalKey(UsageSchema),
  /** When a batch last kept the runner's sandbox alive (`../sandbox-keep-alive.ts`), in epoch milliseconds. */
  keptAliveAt: Schema.optionalKey(Schema.Number),
});
export type NativeProjection = typeof NativeProjectionSchema.Type;

const EMPTY_PROJECTION: NativeProjection = {};

const readProjection = Schema.decodeUnknownOption(NativeProjectionSchema);

/** The projection a conversation kept, or the empty one before its first save or for state no longer read. */
export function heldProjection(saved: WireValue | null): NativeProjection {
  return Option.getOrElse(readProjection(saved), () => EMPTY_PROJECTION);
}

/** The projection with the servers the turn under way took as it started, where that turn is the one named. */
export function withTurnServers(
  state: NativeProjection,
  turnId: string,
  servers: readonly string[],
): NativeProjection {
  const turn = state.turn;
  if (turn === undefined || turn.id !== turnId || servers.length === 0) return state;
  return { ...state, turn: { ...turn, servers: [...servers] } };
}

/** The servers the turn under way took as it started; none where no turn is under way. */
export function turnServersOf(state: NativeProjection): readonly string[] {
  return state.turn?.servers ?? [];
}

/** A write the projection asks of the store, in the order it must land. */
export const NATIVE_WRITE = {
  /** Queue the turn's row, ahead of its start. */
  ENQUEUE: "enqueue",
  /** Hand the writer one event of the turn. */
  EVENT: "event",
  /** Take the awaiting line written under the client id into the turn. */
  TAKE_LINE: "take_line",
  /** Record the harness's session id on the conversation. */
  SESSION: "session",
  /** Record that the harness folded its context. */
  COMPACTED: "compacted",
  /** Record how a turn found the plan that pays for the agent, on its row. */
  PLAN_STATUS: "plan_status",
  /** Replace the wakeups Luke delivers to the agent once due (`coding-agent-wakeups.ts`). */
  WAKEUPS: "wakeups",
} as const;

export type NativeWrite =
  | { readonly kind: typeof NATIVE_WRITE.ENQUEUE; readonly turnId: string }
  | { readonly kind: typeof NATIVE_WRITE.EVENT; readonly event: BrainRunEvent }
  | {
      readonly kind: typeof NATIVE_WRITE.TAKE_LINE;
      readonly turnId: string;
      readonly clientId: string;
    }
  | { readonly kind: typeof NATIVE_WRITE.SESSION; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_WRITE.WAKEUPS; readonly wakeups: readonly NativeWakeup[] }
  | { readonly kind: typeof NATIVE_WRITE.COMPACTED }
  | {
      readonly kind: typeof NATIVE_WRITE.PLAN_STATUS;
      readonly status: PlanStatus;
      /** When a reached limit resets, in epoch milliseconds, where the harness said. */
      readonly resetsAt?: number;
      /** When the turn that found it opened, so a credential saved since is not judged by it. */
      readonly turnOpenedAt?: number;
    };

/** What one event is projected under: its conversation and number, the instant, the model the agent runs on, and which tools the record holds. */
export interface NativeProjectionContext {
  readonly conversationId: string;
  readonly sequence: number;
  readonly now: number;
  readonly model: string | undefined;
  /** Whether the stored tool set holds a call of this name; a call of any other is left out, its answer with it. */
  readonly registered: (name: string) => boolean;
  /** Where a moment the record leaves out is said. */
  readonly report: (message: string) => void;
}

/** The projection as one event moves it, and the writes it asks for. */
export interface Projected {
  readonly state: NativeProjection;
  readonly writes: readonly NativeWrite[];
}

/** Two runs of words as a reply reads them: on lines of their own. */
function joinedWords(head: string, tail: string): string {
  return head.length === 0 ? tail : `${head}\n${tail}`;
}

/** A draft's words a listener may be told while it still forms: through its last finished sentence, or whole where nothing forms. */
function tellable(draft: Draft): string {
  return draft.forming.length === 0
    ? draft.completed
    : finishedSentencesOf(joinedWords(draft.completed, draft.forming));
}

/** Everything one event's moments do, gathered as they are folded. */
class Fold {
  state: NativeProjection;
  readonly writes: NativeWrite[] = [];
  readonly #context: NativeProjectionContext;

  constructor(state: NativeProjection, context: NativeProjectionContext) {
    this.state = state;
    this.#context = context;
  }

  #setTurn(turn: Turn | undefined): void {
    const { turn: _held, ...rest } = this.state;
    this.state = turn === undefined ? rest : { ...rest, turn };
  }

  /** Tells the writer one event of the turn, numbered after the last. */
  #tell(turn: Turn, body: BrainRunEventBody): Turn {
    const told = turn.told + 1;
    this.writes.push({
      kind: NATIVE_WRITE.EVENT,
      event: {
        ...body,
        conversationId: sessionKey(this.#context.conversationId),
        turnId: turn.id,
        sequence: told,
      },
    });
    return { ...turn, told };
  }

  /** The turn under way, opened here, by the event's own number, where none is. */
  turn(): Turn {
    const held = this.state.turn;
    if (held !== undefined) return held;
    const id = nativeTurnId(this.#context.conversationId, this.#context.sequence);
    this.writes.push({ kind: NATIVE_WRITE.ENQUEUE, turnId: id });
    const { origin, trigger } = BRAIN_HOST_TURN_KIND[BRAIN_HOST_TURN.TYPED];
    const opened = this.#tell(
      { id, told: 0, steps: 0, calls: {}, openedAt: this.#context.now },
      { kind: BRAIN_RUN_EVENT.TURN_STARTED, origin, trigger, at: this.#context.now },
    );
    this.#setTurn(opened);
    return opened;
  }

  /** The step's words through what may be told now, or whole where `whole`, where the writer was told less. */
  #drafted(turn: Turn, step: Step, whole: boolean): Turn {
    const { completed, forming } = step.draft;
    const text =
      whole && forming.length > 0 ? joinedWords(completed, forming) : tellable(step.draft);
    if (text.length <= step.draft.told) return { ...turn, step };
    const told = this.#tell(turn, {
      kind: BRAIN_RUN_EVENT.TEXT_DRAFTED,
      step: turn.steps,
      text,
    });
    return { ...told, step: { ...step, draft: { ...step.draft, told: text.length } } };
  }

  /** The step's words told whole, and the step closed. */
  #closed(turn: Turn): Turn {
    const step = turn.step;
    if (step === undefined) return turn;
    const told = this.#drafted(turn, step, true);
    return { ...told, step: { ...(told.step ?? step), open: false } };
  }

  /** The step the next part belongs to: the one open, where it is the same model call's, or a new one. */
  #step(key: string | undefined): Turn {
    const turn = this.turn();
    const step = turn.step;
    if (step?.open === true && (key === undefined || step.key === undefined || step.key === key)) {
      if (key === undefined || step.key !== undefined) return turn;
      const keyed = { ...turn, step: { ...step, key } };
      this.#setTurn(keyed);
      return keyed;
    }
    const closed = this.#closed(turn);
    const steps = closed.steps + 1;
    const opened = this.#tell(
      { ...closed, steps },
      { kind: BRAIN_RUN_EVENT.STEP_STARTED, step: steps },
    );
    const fresh = { open: true, draft: EMPTY_DRAFT, reasoning: 0 };
    const next: Turn = { ...opened, step: key === undefined ? fresh : { ...fresh, key } };
    this.#setTurn(next);
    return next;
  }

  /** The step's words grown, and told where another sentence finished. */
  #words(grow: (draft: Draft) => Draft): void {
    const turn = this.#step(undefined);
    const step = turn.step;
    if (step === undefined) return;
    this.#setTurn(this.#drafted(turn, { ...step, draft: grow(step.draft) }, false));
  }

  #reasoning(text: string): void {
    const turn = this.#step(undefined);
    const step = turn.step;
    if (step === undefined) return;
    const id = reasoningItemId(this.#context.conversationId, turn.id, turn.steps, step.reasoning);
    const told = this.#tell(turn, {
      kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
      summary: text,
      item: { id, summary: text },
    });
    this.#setTurn({ ...told, step: { ...step, reasoning: step.reasoning + 1 } });
  }

  #toolStarted(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.TOOL_STARTED }>): void {
    if (!this.#context.registered(moment.name)) {
      this.#context.report(`A call to ${moment.name} names no stored tool and is not recorded.`);
      return;
    }
    const turn = this.#step(undefined);
    if (turn.calls[moment.callId] !== undefined) return;
    const told = this.#tell(turn, {
      kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
      callId: moment.callId,
      name: moment.name,
      input: moment.input,
    });
    this.#setTurn({ ...told, calls: { ...told.calls, [moment.callId]: moment.name } });
  }

  #toolSettled(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.TOOL_SETTLED }>): void {
    const turn = this.state.turn;
    const name = turn?.calls[moment.callId];
    if (turn === undefined || name === undefined) return;
    this.#setTurn(
      this.#tell(turn, {
        kind: BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
        callId: moment.callId,
        name,
        settlement: moment.settlement,
        ...(moment.input !== undefined ? { input: moment.input } : undefined),
      }),
    );
  }

  /** The turn's end: its words told whole, then its status, cost, and why it failed, where it did. */
  #ended(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.ENDED }>): void {
    // Note that the wakeups are the launch's, written whether or not a turn was under way.
    if (moment.wakeups !== undefined) {
      this.writes.push({ kind: NATIVE_WRITE.WAKEUPS, wakeups: moment.wakeups });
    }
    const held = this.state.turn;
    if (held === undefined) return;
    const turn = this.#closed(held);
    const status = statusOf(moment.ending, turn.failure);
    const failed = status === BRAIN_REQUEST_STATUS.FAILED;
    const detail = [moment.detail, turn.failure, this.state.rateLimit]
      .filter((word) => word !== undefined)
      .join("; ");
    const model = this.#context.model;
    this.#tell(turn, {
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status,
      ...(failed ? { failure: BRAIN_REQUEST_FAILURE.MODEL } : undefined),
      ...(failed && detail.length > 0 ? { failureDetail: detail } : undefined),
      ...(turn.usage !== undefined ? { usage: turn.usage } : undefined),
      ...(turn.usage !== undefined && model !== undefined
        ? { usageByModel: [{ model, ...turn.usage }] }
        : undefined),
      responseIds: [],
      at: this.#context.now,
    });
    this.#setTurn(undefined);
    // Note that a limit is the launch's: the next launch is refused again or it is not.
    const { rateLimit: _spent, rateLimitResetsAt: _resets, ...rest } = this.state;
    this.state = rest;
  }

  #usage(usage: BrainRunUsage): void {
    const turn = this.turn();
    this.#setTurn({ ...turn, usage: addModelUsage(turn.usage, usage) });
  }

  /** A running total metered: the turn under way takes what it grew by; with no turn under way it is only noted, so it is not metered again. */
  #usageTotal(total: BrainRunUsage): void {
    const grown = usageGrowth(this.state.metered, total);
    this.state = { ...this.state, metered: total };
    const turn = this.state.turn;
    if (turn === undefined || grown === undefined) return;
    this.#setTurn({ ...turn, usage: addModelUsage(turn.usage, grown) });
  }

  #result(failure: string | undefined): void {
    const { failure: _held, ...turn } = this.#closed(this.turn());
    this.#setTurn(failure === undefined ? turn : { ...turn, failure });
  }

  fold(moment: NativeMoment): void {
    switch (moment.kind) {
      case NATIVE_MOMENT.LINE_ACCEPTED: {
        const turn = this.turn();
        this.writes.push({
          kind: NATIVE_WRITE.TAKE_LINE,
          turnId: turn.id,
          clientId: moment.clientId,
        });
        return;
      }
      case NATIVE_MOMENT.SESSION:
        if (this.state.session === moment.sessionId) return;
        this.state = { ...this.state, session: moment.sessionId };
        this.writes.push({ kind: NATIVE_WRITE.SESSION, sessionId: moment.sessionId });
        return;
      case NATIVE_MOMENT.ACTIVE:
        this.turn();
        return;
      case NATIVE_MOMENT.STEP:
        this.#step(moment.key);
        return;
      case NATIVE_MOMENT.STEP_CLOSED: {
        const turn = this.state.turn;
        if (turn !== undefined) this.#setTurn(this.#closed(turn));
        return;
      }
      case NATIVE_MOMENT.TEXT_DELTA:
        this.#words((draft) => ({ ...draft, forming: draft.forming + moment.text }));
        return;
      case NATIVE_MOMENT.TEXT:
        this.#words((draft) => ({
          ...draft,
          completed: joinedWords(draft.completed, moment.text),
          forming: "",
        }));
        return;
      case NATIVE_MOMENT.REASONING:
        this.#reasoning(moment.text);
        return;
      case NATIVE_MOMENT.TOOL_STARTED:
        this.#toolStarted(moment);
        return;
      case NATIVE_MOMENT.TOOL_SETTLED:
        this.#toolSettled(moment);
        return;
      case NATIVE_MOMENT.USAGE:
        this.#usage(moment.usage);
        return;
      case NATIVE_MOMENT.USAGE_TOTAL:
        this.#usageTotal(moment.total);
        return;
      case NATIVE_MOMENT.RESULT:
        this.#result(moment.failure);
        return;
      case NATIVE_MOMENT.COMPACTED:
        this.writes.push({ kind: NATIVE_WRITE.COMPACTED });
        return;
      case NATIVE_MOMENT.RATE_LIMIT: {
        const { rateLimit: _held, rateLimitResetsAt: _resets, ...rest } = this.state;
        this.state = moment.refused
          ? {
              ...rest,
              rateLimit: moment.detail,
              ...(moment.resetsAt !== undefined
                ? { rateLimitResetsAt: moment.resetsAt }
                : undefined),
            }
          : rest;
        return;
      }
      case NATIVE_MOMENT.PLAN: {
        // Note that a reached limit resets when the limit the harness last reported says.
        const resetsAt =
          moment.status === PLAN_STATUS.LIMIT_REACHED ? this.state.rateLimitResetsAt : undefined;
        const turnOpenedAt = this.state.turn?.openedAt;
        this.writes.push({
          kind: NATIVE_WRITE.PLAN_STATUS,
          status: moment.status,
          ...(resetsAt !== undefined ? { resetsAt } : undefined),
          ...(turnOpenedAt !== undefined ? { turnOpenedAt } : undefined),
        });
        return;
      }
      case NATIVE_MOMENT.WAITING: {
        // Note that a waiting turn is still under way: its words are told whole and nothing ends.
        const turn = this.state.turn;
        if (turn !== undefined) this.#setTurn(this.#closed(turn));
        return;
      }
      case NATIVE_MOMENT.ENDED:
        this.#ended(moment);
        return;
    }
  }
}

type Usage = typeof UsageSchema.Type;

/**
 * What a running total grew by since the one before: all of it where none
 * was metered or where it is smaller (a new thread counts from nothing), and
 * nothing where it did not grow.
 */
function usageGrowth(before: Usage | undefined, total: Usage): BrainRunUsage | undefined {
  const grown = {
    inputTokens: total.inputTokens - (before?.inputTokens ?? 0),
    outputTokens: total.outputTokens - (before?.outputTokens ?? 0),
    cachedInputTokens: total.cachedInputTokens - (before?.cachedInputTokens ?? 0),
    reasoningTokens: total.reasoningTokens - (before?.reasoningTokens ?? 0),
    cacheWriteTokens: (total.cacheWriteTokens ?? 0) - (before?.cacheWriteTokens ?? 0),
  };
  const counts = Object.values(grown);
  if (counts.some((count) => count < 0)) return total;
  return counts.some((count) => count > 0) ? grown : undefined;
}

/** The turn's status by how its launch ended: done, unless its last model turn failed; stopped is cancelled. */
function statusOf(
  ending: (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING],
  failure: string | undefined,
): BrainRequestStatus {
  switch (ending) {
    case NATIVE_ENDING.DONE:
      return failure === undefined ? BRAIN_REQUEST_STATUS.SUCCEEDED : BRAIN_REQUEST_STATUS.FAILED;
    case NATIVE_ENDING.STOPPED:
      return BRAIN_REQUEST_STATUS.CANCELLED;
    case NATIVE_ENDING.FAILED:
      return BRAIN_REQUEST_STATUS.FAILED;
  }
}

/** One event's moments folded into the projection: the state it moves to, and the writes it asks for, in order. */
export function projectMoments(
  state: NativeProjection,
  moments: readonly NativeMoment[],
  context: NativeProjectionContext,
): Projected {
  const fold = new Fold(state, context);
  for (const moment of moments) fold.fold(moment);
  return { state: fold.state, writes: fold.writes };
}
