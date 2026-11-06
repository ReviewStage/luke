import { nativeTurnId, reasoningItemId } from "@repo/database/models/ids";
import { CLAUDE_CODE_UNRECORDED_TOOL } from "@repo/features/agent-tools";
import { type WireValue, WireValueSchema } from "@repo/wire";
import { Option, Schema } from "effect";
import {
  addModelUsage,
  finishedSentencesOf,
  RUN_EVENT,
  RUN_STATUS,
  type RunEvent,
  type RunEventBody,
  type RunStatus,
  type RunUsage,
  sessionKey,
  TURN_FAILURE,
  type TurnFailure,
} from "../../core.js";
import { CODER_REFUSAL } from "../coder-host/bounds.js";
import { EVE_HOST_TURN, EVE_HOST_TURN_KIND } from "../eve-host/bounds.js";
import {
  NATIVE_ENDING,
  NATIVE_MOMENT,
  type NativeContextUsage,
  type NativeMoment,
  type NativeWakeup,
  PLAN_STATUS,
  type PlanStatus,
} from "./native-moments.js";

const UNRECORDED_TOOLS: ReadonlySet<string> = new Set(Object.values(CLAUDE_CODE_UNRECORDED_TOOL));

const REFUSED_STATUSES: ReadonlySet<PlanStatus> = new Set([
  PLAN_STATUS.INVALID,
  PLAN_STATUS.INELIGIBLE,
]);

const DraftSchema = Schema.Struct({
  completed: Schema.String,
  forming: Schema.String,
  told: Schema.Number,
});
type Draft = typeof DraftSchema.Type;

const EMPTY_DRAFT: Draft = { completed: "", forming: "", told: 0 };

const StepSchema = Schema.Struct({
  key: Schema.optionalKey(Schema.String),
  open: Schema.Boolean,
  draft: DraftSchema,
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

const SubagentSchema = Schema.Struct({
  callId: Schema.String,
  input: Schema.optionalKey(WireValueSchema),
  settled: Schema.optionalKey(Schema.Boolean),
});

const TurnSchema = Schema.Struct({
  id: Schema.String,
  openedAt: Schema.optionalKey(Schema.Number),
  told: Schema.Number,
  steps: Schema.Number,
  step: Schema.optionalKey(StepSchema),
  calls: Schema.Record(Schema.String, Schema.String),
  subagents: Schema.optionalKey(Schema.Record(Schema.String, SubagentSchema)),
  usage: Schema.optionalKey(UsageSchema),
  failure: Schema.optionalKey(Schema.String),
  limited: Schema.optionalKey(Schema.Boolean),
  refused: Schema.optionalKey(Schema.Boolean),
  servers: Schema.optionalKey(Schema.Array(Schema.String)),
});
type Turn = typeof TurnSchema.Type;

const NativeProjectionSchema = Schema.Struct({
  turn: Schema.optionalKey(TurnSchema),
  session: Schema.optionalKey(Schema.String),
  rateLimit: Schema.optionalKey(Schema.String),
  rateLimitResetsAt: Schema.optionalKey(Schema.Number),
  metered: Schema.optionalKey(UsageSchema),
  keptAliveAt: Schema.optionalKey(Schema.Number),
  warm: Schema.optionalKey(Schema.Boolean),
});
export type NativeProjection = typeof NativeProjectionSchema.Type;

const EMPTY_PROJECTION: NativeProjection = {};

const readProjection = Schema.decodeUnknownOption(NativeProjectionSchema);

export function heldProjection(saved: WireValue | null): NativeProjection {
  return Option.getOrElse(readProjection(saved), () => EMPTY_PROJECTION);
}

export function withTurnServers(
  state: NativeProjection,
  turnId: string,
  servers: readonly string[],
): NativeProjection {
  const turn = state.turn;
  if (turn === undefined || turn.id !== turnId || servers.length === 0) return state;
  return { ...state, turn: { ...turn, servers: [...servers] } };
}

export function turnServersOf(state: NativeProjection): readonly string[] {
  return state.turn?.servers ?? [];
}

export const NATIVE_WRITE = {
  ENQUEUE: "enqueue",
  EVENT: "event",
  TAKE_LINE: "take_line",
  SESSION: "session",
  COMPACTED: "compacted",
  PLAN_STATUS: "plan_status",
  WAKEUPS: "wakeups",
  CONTEXT: "context",
  FAILED: "failed",
} as const;

export type NativeWrite =
  | { readonly kind: typeof NATIVE_WRITE.ENQUEUE; readonly turnId: string }
  | { readonly kind: typeof NATIVE_WRITE.EVENT; readonly event: RunEvent }
  | {
      readonly kind: typeof NATIVE_WRITE.TAKE_LINE;
      readonly turnId: string;
      readonly clientId: string;
    }
  | { readonly kind: typeof NATIVE_WRITE.SESSION; readonly sessionId: string }
  | { readonly kind: typeof NATIVE_WRITE.WAKEUPS; readonly wakeups: readonly NativeWakeup[] }
  | { readonly kind: typeof NATIVE_WRITE.COMPACTED }
  | { readonly kind: typeof NATIVE_WRITE.CONTEXT; readonly usage: NativeContextUsage }
  | {
      readonly kind: typeof NATIVE_WRITE.FAILED;
      readonly turnId: string;
      readonly failure: TurnFailure;
      readonly detail: string;
      readonly expected: boolean;
      readonly refused: boolean;
    }
  | {
      readonly kind: typeof NATIVE_WRITE.PLAN_STATUS;
      readonly status: PlanStatus;
      readonly resetsAt?: number;
      readonly turnOpenedAt?: number;
    };

export interface NativeProjectionContext {
  readonly conversationId: string;
  readonly sequence: number;
  readonly now: number;
  readonly model: string | undefined;
  readonly ownKey: boolean;
  readonly registered: (name: string) => boolean;
  readonly report: (message: string) => void;
}

export interface Projected {
  readonly state: NativeProjection;
  readonly writes: readonly NativeWrite[];
}

function joinedWords(head: string, tail: string): string {
  return head.length === 0 ? tail : `${head}\n${tail}`;
}

function tellable(draft: Draft): string {
  return draft.forming.length === 0
    ? draft.completed
    : finishedSentencesOf(joinedWords(draft.completed, draft.forming));
}

function withSettledSubagents(turn: Turn, callId: string): Turn {
  const held = turn.subagents;
  if (held === undefined) return turn;
  const subagents = Object.fromEntries(
    Object.entries(held).map(([key, subagent]) => [
      key,
      subagent.callId === callId ? { ...subagent, settled: true } : subagent,
    ]),
  );
  return { ...turn, subagents };
}

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

  #tell(turn: Turn, body: RunEventBody): Turn {
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

  turn(): Turn {
    const held = this.state.turn;
    if (held !== undefined) return held;
    const { warm: _warm, ...cold } = this.state;
    this.state = cold;
    const id = nativeTurnId(this.#context.conversationId, this.#context.sequence);
    this.writes.push({ kind: NATIVE_WRITE.ENQUEUE, turnId: id });
    const { origin, trigger } = EVE_HOST_TURN_KIND[EVE_HOST_TURN.TYPED];
    const opened = this.#tell(
      { id, told: 0, steps: 0, calls: {}, openedAt: this.#context.now },
      { kind: RUN_EVENT.TURN_STARTED, origin, trigger, at: this.#context.now },
    );
    this.#setTurn(opened);
    return opened;
  }

  #drafted(turn: Turn, step: Step, whole: boolean): Turn {
    const { completed, forming } = step.draft;
    const text =
      whole && forming.length > 0 ? joinedWords(completed, forming) : tellable(step.draft);
    if (text.length <= step.draft.told) return { ...turn, step };
    const told = this.#tell(turn, {
      kind: RUN_EVENT.TEXT_DRAFTED,
      step: turn.steps,
      text,
    });
    return { ...told, step: { ...step, draft: { ...step.draft, told: text.length } } };
  }

  #closed(turn: Turn): Turn {
    const step = turn.step;
    if (step === undefined) return turn;
    const told = this.#drafted(turn, step, true);
    return { ...told, step: { ...(told.step ?? step), open: false } };
  }

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
    const opened = this.#tell({ ...closed, steps }, { kind: RUN_EVENT.STEP_STARTED, step: steps });
    const fresh = { open: true, draft: EMPTY_DRAFT, reasoning: 0 };
    const next: Turn = { ...opened, step: key === undefined ? fresh : { ...fresh, key } };
    this.#setTurn(next);
    return next;
  }

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
      kind: RUN_EVENT.REASONING_COMPLETED,
      summary: text,
      item: { id, summary: text },
    });
    this.#setTurn({ ...told, step: { ...step, reasoning: step.reasoning + 1 } });
  }

  #toolStarted(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.TOOL_STARTED }>): void {
    if (!this.#context.registered(moment.name)) {
      if (!UNRECORDED_TOOLS.has(moment.name)) {
        this.#context.report(`A call to ${moment.name} names no stored tool and is not recorded.`);
      }
      return;
    }
    const turn = this.#step(undefined);
    if (turn.calls[moment.callId] !== undefined) return;
    const told = this.#tell(turn, {
      kind: RUN_EVENT.TOOL_CALL_STARTED,
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
      this.#tell(withSettledSubagents(turn, moment.callId), {
        kind: RUN_EVENT.TOOL_CALL_SETTLED,
        callId: moment.callId,
        name,
        settlement: moment.settlement,
        ...(moment.input !== undefined ? { input: moment.input } : undefined),
      }),
    );
  }

  #subagentRunning(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.SUBAGENT_RUNNING }>,
  ): void {
    const turn = this.state.turn;
    if (turn?.calls[moment.callId] === undefined) return;
    if (turn.subagents?.[moment.key]?.settled === true) return;
    const { callId, input } = moment;
    const subagent = input === undefined ? { callId } : { callId, input };
    this.#setTurn({ ...turn, subagents: { ...turn.subagents, [moment.key]: subagent } });
  }

  #subagentEnded(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.SUBAGENT_ENDED }>,
  ): void {
    const turn = this.state.turn;
    const subagent = turn?.subagents?.[moment.key];
    if (turn === undefined || subagent === undefined || subagent.settled === true) return;
    const { callId, input } = subagent;
    this.#toolSettled({
      kind: NATIVE_MOMENT.TOOL_SETTLED,
      callId,
      settlement: moment.settlement,
      ...(input === undefined ? undefined : { input }),
    });
  }

  #endedTurn(
    moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.ENDED }>,
  ): Turn | undefined {
    const held = this.state.turn;
    if (held !== undefined) return held;
    if (moment.launchFailed !== true || this.state.warm === true) return undefined;
    return this.turn();
  }

  #ended(moment: Extract<NativeMoment, { kind: typeof NATIVE_MOMENT.ENDED }>): void {
    if (moment.wakeups !== undefined) {
      this.writes.push({ kind: NATIVE_WRITE.WAKEUPS, wakeups: moment.wakeups });
    }
    const held = this.#endedTurn(moment);
    const { warm: _warm, ...cold } = this.state;
    this.state = moment.warm === true ? { ...cold, warm: true } : cold;
    if (held === undefined) return;
    const turn = this.#closed(held);
    const status = statusOf(moment.ending, turn.failure);
    const failed = status === RUN_STATUS.FAILED;
    const ownKeyRefused =
      turn.refused === true && this.#context.ownKey ? CODER_REFUSAL.ACCOUNT_KEY_REFUSED : undefined;
    const detail = [ownKeyRefused, moment.detail, turn.failure, this.state.rateLimit]
      .filter((word) => word !== undefined)
      .join("; ");
    const model = this.#context.model;
    this.#tell(turn, {
      kind: RUN_EVENT.TURN_ENDED,
      status,
      ...(failed ? { failure: TURN_FAILURE.MODEL } : undefined),
      ...(failed && detail.length > 0 ? { failureDetail: detail } : undefined),
      ...(turn.usage !== undefined ? { usage: turn.usage } : undefined),
      ...(turn.usage !== undefined && model !== undefined
        ? { usageByModel: [{ model, ...turn.usage }] }
        : undefined),
      responseIds: [],
      at: this.#context.now,
    });
    if (failed) {
      this.writes.push({
        kind: NATIVE_WRITE.FAILED,
        turnId: turn.id,
        failure: TURN_FAILURE.MODEL,
        detail,
        expected: turn.limited === true || this.state.rateLimit !== undefined,
        refused: turn.refused === true,
      });
    }
    this.#setTurn(undefined);
    const { rateLimit: _spent, rateLimitResetsAt: _resets, ...rest } = this.state;
    this.state = rest;
  }

  #usage(usage: RunUsage): void {
    const turn = this.turn();
    this.#setTurn({ ...turn, usage: addModelUsage(turn.usage, usage) });
  }

  #usageTotal(total: RunUsage): void {
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
      case NATIVE_MOMENT.SUBAGENT_RUNNING:
        this.#subagentRunning(moment);
        return;
      case NATIVE_MOMENT.SUBAGENT_ENDED:
        this.#subagentEnded(moment);
        return;
      case NATIVE_MOMENT.USAGE:
        this.#usage(moment.usage);
        return;
      case NATIVE_MOMENT.USAGE_TOTAL:
        this.#usageTotal(moment.total);
        return;
      case NATIVE_MOMENT.CONTEXT:
        if (moment.usage.inputTokens > 0) {
          this.writes.push({ kind: NATIVE_WRITE.CONTEXT, usage: moment.usage });
        }
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
        const resetsAt =
          moment.status === PLAN_STATUS.LIMIT_REACHED ? this.state.rateLimitResetsAt : undefined;
        const turnOpenedAt = this.state.turn?.openedAt;
        const turn = this.state.turn;
        if (turn !== undefined && moment.status === PLAN_STATUS.LIMIT_REACHED) {
          this.#setTurn({ ...turn, limited: true });
        } else if (turn !== undefined && REFUSED_STATUSES.has(moment.status)) {
          this.#setTurn({ ...turn, refused: true });
        }
        this.writes.push({
          kind: NATIVE_WRITE.PLAN_STATUS,
          status: moment.status,
          ...(resetsAt !== undefined ? { resetsAt } : undefined),
          ...(turnOpenedAt !== undefined ? { turnOpenedAt } : undefined),
        });
        return;
      }
      case NATIVE_MOMENT.WAITING: {
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

function usageGrowth(before: Usage | undefined, total: Usage): RunUsage | undefined {
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

function statusOf(
  ending: (typeof NATIVE_ENDING)[keyof typeof NATIVE_ENDING],
  failure: string | undefined,
): RunStatus {
  switch (ending) {
    case NATIVE_ENDING.DONE:
      return failure === undefined ? RUN_STATUS.SUCCEEDED : RUN_STATUS.FAILED;
    case NATIVE_ENDING.STOPPED:
      return RUN_STATUS.CANCELED;
    case NATIVE_ENDING.FAILED:
      return RUN_STATUS.FAILED;
  }
}

export function projectMoments(
  state: NativeProjection,
  moments: readonly NativeMoment[],
  context: NativeProjectionContext,
): Projected {
  const fold = new Fold(state, context);
  for (const moment of moments) fold.fold(moment);
  return { state: fold.state, writes: fold.writes };
}
