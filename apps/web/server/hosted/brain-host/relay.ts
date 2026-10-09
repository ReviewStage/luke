import { Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { MessageStreamEvent } from "eve/client";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  addModelUsage,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  type BrainRequestFailure,
  type BrainRequestStatus,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainRunUsage,
  finishedSentencesOf,
  isRecord,
  isWireString,
  sessionKey,
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  TURN_ORIGIN,
  type TurnOrigin,
  toolCallSettlementOf,
  type UnparsedWireValue,
  unparsedWire,
  userMessage,
  userMetadataOf,
} from "../../core.js";
import { LOOK_AT_BOARD_TOOL, storedLookOutput } from "../board-look.js";
import type { AskDeliveryBinding } from "../store/asks.js";
import type { ConversationTarget, StoreWriter } from "../store/index.js";
import {
  BRAIN_HOST_TURN,
  BRAIN_HOST_TURN_KIND,
  type BrainHostTurn,
  RECEIVED_LINE,
} from "./bounds.js";
import { answerMessageId, hostTurnId, reasoningItemId, receivedMessageId } from "./ids.js";

/**
 * The relay from eve's stream into the brain's own, which both eve services
 * share: every event eve records for a session is read here, after eve has
 * written it, and told again as the `BrainRunEvent` the store writer
 * consumes, so the writer stays the sole consumer and the only thing that
 * writes a message row. The planning host composes it with the ask record,
 * whose deliveries a turn's start binds and whose Stop it carries; the
 * coding-agent host composes it without, since a message to a coding agent
 * is written ahead of its turn as a line awaiting one and taken into the
 * turn that receives it, and everything below from a turn's start to its
 * answer is the same for both. eve numbers a turn
 * inside its session and names a call by id; the relay mints the store's
 * uuid for the turn and its messages as the same function of those
 * coordinates every time, so a step eve retries lands on the rows the first
 * attempt opened rather than beside them. What a turn accumulates between
 * its events — the parts of each step in order, the usage so far, the
 * sequence numbers told — is kept in the state the caller hands in, durable
 * across eve's steps where eve runs durably and a plain object in a test.
 *
 * A step is told the moment eve starts it, before any part of it, so the
 * writer's journal carries the boundary the parts stand behind. eve emits a
 * step's `reasoning.completed` after that step's `action.result`, so the
 * journal, which appends in arrival order, holds the step's call before its
 * reasoning while the turn runs; the answer the turn completes with orders
 * every step as the model produced it — its reasoning, then its calls, then
 * its words — and replaces the journal whole. A step's words reach the
 * journal while it runs only a finished sentence at a time: eve's deltas are
 * gathered here, and the writer is told the step's words through their last
 * finished sentence each time another finishes, never at every token, so
 * the voice can say what follows settled calls before the turn ends. A
 * turn eve parks on the tasks it started (`turn.waiting`) is still under
 * way: nothing is told for the park, the next step under the same id adds
 * to the same turn, and a subagent's findings reach the record as the steps
 * that follow them, never as a turn of their own.
 */

/** One part of the answer as a step produced it, kept until the turn completes and the message is told whole. */
type RelayPart =
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string }
  | {
      readonly kind: "tool";
      readonly callId: string;
      readonly name: string;
      readonly input: UnparsedWireValue;
      readonly settlement?: ToolCallSettlement;
    }
  | { readonly kind: "text"; readonly text: string };

interface RelayStep {
  readonly parts: readonly RelayPart[];
}

/** eve numbers a turn's steps from zero; the stream numbers them from one. */
function stepOf(stepIndex: number): number {
  return stepIndex + 1;
}

/** The order a step's parts are told in the completed answer: the reasoning, then the calls, then the words. */
const PART_KIND_ORDER = { reasoning: 0, tool: 1, text: 2 } as const satisfies Record<
  RelayPart["kind"],
  number
>;

function orderedParts(step: RelayStep): readonly RelayPart[] {
  return [...step.parts].sort(
    (left, right) => PART_KIND_ORDER[left.kind] - PART_KIND_ORDER[right.kind],
  );
}

/** A step's words as eve streams them: the messages it completed, the one still forming, and how much of them the writer was told. */
interface RelayDraft {
  /** The step's completed messages, joined by line breaks as the reply joins them. */
  readonly completed: string;
  readonly forming: string;
  /** The length of the words the writer last took, which only grows. */
  readonly told: number;
  /** eve's id for the last event read into the draft, which sorts as eve emitted them, so an event eve delivers again adds nothing. */
  readonly eventId: string;
}

const EMPTY_DRAFT: RelayDraft = { completed: "", forming: "", told: 0, eventId: "" };

/** Two runs of words as the reply reads them: on lines of their own. */
function joinedWords(head: string, tail: string): string {
  return head.length === 0 ? tail : `${head}\n${tail}`;
}

interface RelayTurnState {
  readonly kind: BrainHostTurn;
  readonly sequence: number;
  readonly steps: Readonly<Record<string, RelayStep>>;
  /** Each step's usage under its index, so a step eve replays reports its usage once. */
  readonly usageBySteps: Readonly<Record<string, BrainRunUsage>>;
  /** Each step's words under its index while they form; absent in state an earlier build kept. */
  readonly drafts?: Readonly<Record<string, RelayDraft>>;
  /** Whether the store refused the ask that opened the turn: a turn with no ask on record settles no answer. */
  readonly askRefused?: true;
  /** The deliveries bound to the turn so far: those its start named, and each that joined it under way; absent in state an earlier build kept. */
  readonly deliveries?: readonly string[];
  /** How many developer lines the turn has received, and eve's id for the last one read, so a line eve delivers again adds nothing; absent in state an earlier build kept. */
  readonly received?: { readonly count: number; readonly eventId: string };
}

/** What one session's relay keeps: the turns still under way, by eve's own turn id. */
export interface RelayState {
  readonly turns: Readonly<Record<string, RelayTurnState>>;
}

export const EMPTY_RELAY_STATE: RelayState = { turns: {} };

/** Where the relay keeps its state: eve's durable session state in the hook, a plain object in a test. */
export interface RelayStateStore {
  get(): RelayState;
  update(next: (current: RelayState) => RelayState): void;
}

export function memoryRelayState(initial: RelayState = EMPTY_RELAY_STATE): RelayStateStore {
  let state = initial;
  return {
    get: () => state,
    update: (next) => {
      state = next(state);
    },
  };
}

/** The session an event belongs to and the conversation the host admitted it for. */
export interface RelayStanding {
  readonly sessionId: string;
  readonly target: ConversationTarget;
  /** The kind of turn the request that opened the current turn named; nothing when it named none. */
  readonly turn: BrainHostTurn | undefined;
  /** The model eve resolved the session's turns to, as the turn row records it; nothing where none is known. */
  readonly model?: string;
  /** The reasoning effort the turns run at, as the turn row records it; nothing where the model decides it. */
  readonly reasoningEffort?: string;
  /** The content address of the prompt the session runs under, as the turn row records it; nothing before the session composed one. */
  readonly promptHash?: string;
  /** The content address of the tool set this turn is offered, as the turn row records it. */
  readonly toolSetHash?: string;
  readonly state: RelayStateStore;
}

/**
 * What the relay and every seam it reaches answer: the store's own effect
 * over the client the request holds, which is the fiber eve's event arrived
 * on. The relay runs nothing: `brainHost`'s `relay` composes this into the
 * effect it already answers, and a test runs it on its own database.
 */
type RelayEffect<Value> = Effect.Effect<Value, SqlError | Schema.SchemaError, SqlClient.SqlClient>;

/** The ask record a planning turn binds its deliveries to, and the Stop a waiting ask took, carried the moment the turn starts. */
interface RelayAskSeams {
  /** Names the turn each ask delivered into it ran in, once eve's start names the deliveries. */
  readonly binding: AskDeliveryBinding;
  /** Carries the Stop an ask took while it waited, the moment eve's start names the turn it ran in: eve's cancel scoped to that turn, and the row's stamp. */
  readonly stopTurn: (
    target: ConversationTarget,
    sessionId: string,
    eveTurnId: string,
    turnId: string,
  ) => RelayEffect<void>;
}

interface StreamRelaySeams {
  /** The four writes the relay makes. */
  readonly writer: Pick<
    StoreWriter,
    "consume" | "enqueueTurn" | "attachAskLines" | "takeAwaitingLine"
  >;
  /** The ask record, where the conversation takes asks; nothing for a coding agent, whose turns are opened by a Start alone. */
  readonly asks?: RelayAskSeams;
  readonly now: () => number;
  /** Where a write the writer refused is said; the relay never throws into eve's turn. */
  readonly report: (message: string) => void;
}

/** The plan's turn origin for each kind of turn a request opens, as the queued row records it. */
const TURN_ORIGIN_OF_HOST_TURN = {
  [BRAIN_HOST_TURN.TYPED]: TURN_ORIGIN.TYPED,
  [BRAIN_HOST_TURN.SPOKEN]: TURN_ORIGIN.SPOKEN,
} as const satisfies Record<BrainHostTurn, TurnOrigin>;

const TOOL_CALL_KIND = "tool-call";
/** eve's own kind of action for a call to a declared subagent, named by the tool eve lowers the subagent into, which is the name its result carries. */
const SUBAGENT_CALL_KIND = "subagent-call";

const TOOL_RESULT_KIND = "tool-result";
const EVE_ACTION_COMPLETED = "completed";

type RequestedAction = Extract<
  MessageStreamEvent,
  { readonly type: "actions.requested" }
>["data"]["actions"][number];

/** The call an action requests, as the record names it; nothing for an action that is no call of a tool. */
function requestedCallOf(
  action: RequestedAction,
): { readonly callId: string; readonly name: string } | undefined {
  switch (action.kind) {
    case TOOL_CALL_KIND:
      return { callId: action.callId, name: action.toolName };
    case SUBAGENT_CALL_KIND:
      return { callId: action.callId, name: action.name };
    default:
      return undefined;
  }
}

/** The status word a tool's own output carries, when it is a record with one. */
function statusWordOf(output: UnparsedWireValue): string | undefined {
  return isRecord(output) && isWireString(output.status) ? output.status : undefined;
}

/**
 * The keys of eve's failure details whose values are fixed words or numbers:
 * the error's class name, eve's own catalog id for an error it recognized,
 * and the status codes. Read in this order, and no other key's value is:
 * `apiErrorMessage`, `upstreamMessage`, `responseBodySnippet`, and `detail`
 * are the provider's or the stack's own words, which nothing here can vouch
 * for holding no credential. The two words are held to the shape a class
 * name and a catalog id have, since eve copies an unrecognized error's own
 * `name` through, and a details object one of them does not fit yields none.
 */
const FAILURE_DETAIL_FIELDS = [
  "name",
  "semanticErrorId",
  "statusCode",
  "upstreamStatusCode",
] as const;

/** An error's class name as one is written: a capitalized identifier ending in `Error`, and nothing shaped like a token or a sentence. */
const ERROR_NAME_PATTERN = /^[A-Z][A-Za-z0-9_]{0,62}Error$/;

/** eve's catalog id for an error it recognized: a lower-case slug such as `gateway-rate-limited`. */
const SEMANTIC_ERROR_ID_PATTERN = /^[a-z][a-z0-9_-]*(\.[a-z0-9_-]+)*$/;

const FailureDetailWordsSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String.check(Schema.isPattern(ERROR_NAME_PATTERN))),
  semanticErrorId: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(SEMANTIC_ERROR_ID_PATTERN)),
  ),
  statusCode: Schema.optionalKey(Schema.Number),
  upstreamStatusCode: Schema.optionalKey(Schema.Number),
});

const readFailureDetailWords = Schema.decodeUnknownOption(FailureDetailWordsSchema);

/** How much of eve's failure message the row keeps, and how much of its details' key list, inside the writer's own 500. */
export const FAILURE_DETAIL_BOUNDS = { MESSAGE_CHARS: 200, KEYS_CHARS: 120 } as const;

/**
 * Anything shaped like a credential, each replaced whole: an `sk-` key, a
 * bearer token, a JWT from its header onward, an AWS access key id, the
 * value a `key`, `token`, or `secret` name is assigned by `=` or `:` in a
 * query string or JSON whatever prefixes the name, and a run of 32 or more
 * hex or base64 characters, url-safe alphabet included. The named forms
 * stand before the bare run, because the run would otherwise take a value's
 * head up to its first `-` or `_` and leave the tail; a value ends at a
 * space, an `&`, or a quote, so the parameter after it is still read.
 */
const CREDENTIAL_PATTERN =
  /sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|eyJ[A-Za-z0-9_.-]{16,}|(?:AKIA|ASIA)[0-9A-Z]{16}|\w*(?:key|token|secret)"?\s*[=:]\s*"?[^\s&"']+|[A-Za-z0-9+/=_-]{32,}/gi;

const REDACTED = "[redacted]";

/** eve's failure message as the row may keep it: every credential-shaped run replaced, the rest word for word. */
export function redactCredentials(message: string): string {
  return message.replace(CREDENTIAL_PATTERN, REDACTED);
}

type TurnFailedData = Extract<MessageStreamEvent, { readonly type: "turn.failed" }>["data"];

/**
 * Why eve failed the turn, as the row keeps it: eve's own code, the sorted
 * key names of its details so the next reader knows what eve offers, the
 * fixed words above where the details carry them, and eve's `message`
 * redacted and cut, which is where a bare `MODEL_CALL_FAILED` gets its
 * diagnosis, the host's own refusal word included. eve's `step.failed`
 * carries the same code, message, and details as the `turn.failed` it
 * precedes, so nothing is kept from it.
 */
function failureDetailOf(data: TurnFailedData): string {
  const words = [data.code];
  const keys = Object.keys(data.details ?? {})
    .sort()
    .join(",");
  if (keys) words.push(`[${keys.slice(0, FAILURE_DETAIL_BOUNDS.KEYS_CHARS)}]`);
  const fixed = Option.getOrUndefined(readFailureDetailWords(data.details));
  for (const field of FAILURE_DETAIL_FIELDS) {
    const value = fixed?.[field];
    if (value !== undefined) words.push(String(value));
  }
  // Redacted before the cut, so a cut never leaves the head of a credential standing.
  const message = redactCredentials(data.message)
    .slice(0, FAILURE_DETAIL_BOUNDS.MESSAGE_CHARS)
    .trim();
  if (message) words.push(message);
  return words.join(" ");
}

function withTurn(
  state: RelayState,
  eveTurnId: string,
  next: (turn: RelayTurnState) => RelayTurnState,
): RelayState {
  const turn = state.turns[eveTurnId];
  if (!turn) return state;
  return { ...state, turns: { ...state.turns, [eveTurnId]: next(turn) } };
}

/** Whether a step already holds a part eve re-emitted: the same call, or the same words at the same place. */
function samePart(held: RelayPart, part: RelayPart): boolean {
  switch (held.kind) {
    case "tool":
      return part.kind === "tool" && held.callId === part.callId;
    case "reasoning":
      return part.kind === "reasoning" && held.text === part.text;
    case "text":
      return part.kind === "text" && held.text === part.text;
  }
}

/** A part added to its step once: a replayed event finds its part already there and adds nothing. */
function withPart(turn: RelayTurnState, stepIndex: number, part: RelayPart): RelayTurnState {
  const key = String(stepIndex);
  const step = turn.steps[key] ?? { parts: [] };
  if (step.parts.some((held) => samePart(held, part))) return turn;
  return { ...turn, steps: { ...turn.steps, [key]: { parts: [...step.parts, part] } } };
}

/** The turn's usage: every step's, summed once each. */
function usageOf(turn: RelayTurnState): BrainRunUsage | undefined {
  return Object.values(turn.usageBySteps).reduce<BrainRunUsage | undefined>(
    (total, usage) => addModelUsage(total, usage),
    undefined,
  );
}

function withSettlement(
  turn: RelayTurnState,
  callId: string,
  settlement: ToolCallSettlement,
): RelayTurnState {
  const steps = Object.fromEntries(
    Object.entries(turn.steps).map(([key, step]) => [
      key,
      {
        parts: step.parts.map((part) =>
          part.kind === "tool" && part.callId === callId ? { ...part, settlement } : part,
        ),
      },
    ]),
  );
  return { ...turn, steps };
}

/** The steps in index order, so a message is told in the order the model produced it whatever order the events arrived. */
function orderedSteps(turn: RelayTurnState): readonly RelayStep[] {
  return Object.entries(turn.steps)
    .sort(([left], [right]) => Number(left) - Number(right))
    .map(([, step]) => step);
}

function settlementOf(
  status: string,
  isError: boolean | undefined,
  output: UnparsedWireValue,
  errorText: string | undefined,
): ToolCallSettlement {
  if (status === EVE_ACTION_COMPLETED && isError !== true) {
    return toolCallSettlementOf(JSON.stringify(output), statusWordOf(output));
  }
  return {
    state: TOOL_CALL_SETTLEMENT.OUTPUT_ERROR,
    output,
    errorText: errorText ?? (isWireString(output) ? output : JSON.stringify(output)),
    status: ACTION_RESULT_STATUS.REJECTED,
  };
}

export class StreamRelay {
  readonly #seams: StreamRelaySeams;

  constructor(seams: StreamRelaySeams) {
    this.#seams = seams;
  }

  /** Reads one event of the session's stream and tells the writer what it amounts to. */
  handle(event: MessageStreamEvent, standing: RelayStanding): RelayEffect<void> {
    switch (event.type) {
      case "turn.started":
        return this.#turnStarted(event.data.turnId, event.meta.deliveryIds ?? [], standing);
      case "message.received":
        return Effect.andThen(
          this.#joined(event.data.turnId, event.meta.deliveryIds ?? [], standing),
          this.#received(event.data.turnId, event.data.message, event.meta.id, standing),
        );
      case "step.started":
        return this.#stepStarted(event.data.turnId, event.data.stepIndex, standing);
      case "actions.requested": {
        const { turnId, stepIndex, actions } = event.data;
        return Effect.gen({ self: this }, function* () {
          for (const action of actions) {
            const call = requestedCallOf(action);
            if (!call) continue;
            yield* this.#toolCall(
              turnId,
              stepIndex,
              call.callId,
              call.name,
              unparsedWire(action.input),
              standing,
            );
          }
        });
      }
      case "action.result": {
        const result = event.data.result;
        if (result.kind !== TOOL_RESULT_KIND) return Effect.void;
        // Note that a look's image went to the model once and is not kept, because it is no record of the plan.
        const output = unparsedWire(result.output);
        const kept =
          result.toolName === LOOK_AT_BOARD_TOOL.name ? storedLookOutput(output) : output;
        return this.#toolResult(
          event.data.turnId,
          result.callId,
          result.toolName,
          settlementOf(event.data.status, result.isError, kept, event.data.error?.message),
          standing,
        );
      }
      case "reasoning.completed":
        return this.#reasoning(
          event.data.turnId,
          event.data.stepIndex,
          event.data.reasoning,
          standing,
        );
      case "message.appended": {
        const { turnId, stepIndex, messageDelta } = event.data;
        return this.#drafted(turnId, stepIndex, event.meta.id, standing, (draft) => ({
          ...draft,
          forming: draft.forming + messageDelta,
        }));
      }
      case "message.completed": {
        const { turnId, stepIndex, message } = event.data;
        if (message === null) return Effect.void;
        const kept = Effect.sync(() =>
          standing.state.update((state) =>
            withTurn(state, turnId, (turn) =>
              withPart(turn, stepIndex, { kind: "text", text: message }),
            ),
          ),
        );
        if (message.length === 0) return kept;
        // The finished message is the step's words whole, its last sentence included.
        return Effect.andThen(
          kept,
          this.#drafted(turnId, stepIndex, event.meta.id, standing, (draft) => ({
            ...draft,
            completed: joinedWords(draft.completed, message),
            forming: "",
          })),
        );
      }
      case "step.completed": {
        const { turnId, stepIndex, usage } = event.data;
        if (!usage) return Effect.void;
        return Effect.sync(() =>
          standing.state.update((state) =>
            withTurn(state, turnId, (turn) => ({
              ...turn,
              usageBySteps: {
                ...turn.usageBySteps,
                [String(stepIndex)]: addModelUsage(undefined, {
                  ...(usage.inputTokens !== undefined
                    ? { inputTokens: usage.inputTokens }
                    : undefined),
                  ...(usage.outputTokens !== undefined
                    ? { outputTokens: usage.outputTokens }
                    : undefined),
                  ...(usage.cacheReadTokens !== undefined
                    ? { cachedInputTokens: usage.cacheReadTokens }
                    : undefined),
                }),
              },
            })),
          ),
        );
      }
      case "turn.completed":
        return this.#turnEnded(event.data.turnId, BRAIN_REQUEST_STATUS.SUCCEEDED, standing);
      case "turn.failed":
        return this.#turnEnded(
          event.data.turnId,
          BRAIN_REQUEST_STATUS.FAILED,
          standing,
          failureDetailOf(event.data),
        );
      case "turn.cancelled":
        return this.#turnEnded(event.data.turnId, BRAIN_REQUEST_STATUS.CANCELLED, standing);
      default:
        return Effect.void;
    }
  }

  #turnStarted(
    eveTurnId: string,
    deliveryIds: readonly string[],
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      // A start eve emits again finds its turn already under way and leaves what it accumulated standing.
      const state = standing.state.get();
      if (state.turns[eveTurnId]) return;
      const kind = standing.turn;
      if (kind === undefined) {
        this.#seams.report(
          `Turn ${eveTurnId} of session ${standing.sessionId} named no kind of turn and is not recorded.`,
        );
        return;
      }
      standing.state.update((state) => ({
        ...state,
        turns: {
          ...state.turns,
          [eveTurnId]: {
            kind,
            sequence: 0,
            steps: {},
            usageBySteps: {},
            deliveries: [...deliveryIds],
          },
        },
      }));
      const { origin, trigger } = BRAIN_HOST_TURN_KIND[kind];
      // The turn row is queued ahead of its start with what it will run under,
      // which is how the row comes to name eve's resolved model; the start
      // then only moves it to running. eve's own turn id rides on the row from
      // here, because the store's id is a digest of it that nothing reverses,
      // and a Stop on the row is scoped to eve's turn by reading it back. A
      // start the record does not come to hold, refused or failed, keeps
      // nothing in relay state, so the start eve emits again queues the row
      // again rather than finding a turn under way.
      const turnId = hostTurnId(standing.sessionId, eveTurnId);
      const queued = yield* this.#seams.writer.enqueueTurn(standing.target, {
        turnId,
        eveTurnId,
        origin: TURN_ORIGIN_OF_HOST_TURN[kind],
        ...(standing.model !== undefined ? { model: standing.model } : undefined),
        ...(standing.reasoningEffort !== undefined
          ? { reasoningEffort: standing.reasoningEffort }
          : undefined),
        ...(standing.promptHash !== undefined ? { promptHash: standing.promptHash } : undefined),
        ...(standing.toolSetHash !== undefined ? { toolSetHash: standing.toolSetHash } : undefined),
      });
      if (Result.isFailure(queued)) {
        this.#seams.report(
          `The store refused to queue turn ${eveTurnId}: ${queued.failure.refusal}.`,
        );
        standing.state.update((state) => this.#without(state, eveTurnId));
        return;
      }
      // eve folds the asks that waited into one turn and stamps their deliveries on its events,
      // so the start is where each ask learns the turn it ran in; a start emitted again names
      // the same deliveries and binds nothing new. The Stop is honoured over every ask bound to
      // the turn, not only the rows this start bound: the ask that opened the session was bound
      // at its dispatch with no delivery, and a follow-up's stamp may land after its binding.
      // A failed stop drops the turn from relay state with the rest of this block, so the start
      // eve emits again reaches the stamp and carries it; a start that finds its turn under way
      // never comes this far and carries nothing twice.
      yield* this.#bound(standing, deliveryIds, eveTurnId, turnId);
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        origin,
        trigger,
        at: this.#seams.now(),
      });
      if (!written) standing.state.update((state) => this.#without(state, eveTurnId));
    }).pipe(
      // What the store refused it said above; what it could not do at all — a
      // failed write, a defect — leaves the turn nowhere in relay state, so
      // the start eve emits again opens it from the beginning, and the failure
      // is eve's to see.
      Effect.tapCause(() =>
        Effect.sync(() => standing.state.update((state) => this.#without(state, eveTurnId))),
      ),
    );
  }

  /** Binds the deliveries to the turn and carries any Stop they took, where the conversation takes asks at all. */
  #bound(
    standing: RelayStanding,
    deliveryIds: readonly string[],
    eveTurnId: string,
    turnId: string,
  ): RelayEffect<void> {
    const asks = this.#seams.asks;
    if (asks === undefined) return Effect.void;
    return Effect.gen(function* () {
      yield* asks.binding.bindDeliveries(standing.target, deliveryIds, turnId);
      const stopped = yield* asks.binding.stoppedOn(standing.target, turnId);
      if (stopped.length > 0) {
        yield* asks.stopTurn(standing.target, standing.sessionId, eveTurnId, turnId);
      }
    });
  }

  #without(state: RelayState, eveTurnId: string): RelayState {
    const { [eveTurnId]: _dropped, ...rest } = state.turns;
    return { ...state, turns: rest };
  }

  /**
   * Binds to the turn each delivery that joined it under way and carries the
   * Stop an ask took while it waited, as the start does for the deliveries
   * eve folded into the turn. A message that steers a turn (`channel.ts`)
   * rides on every later event of the turn with its own delivery beside the
   * start's, so the binding runs where a received line first names one, and
   * a delivery the turn already holds binds nothing again.
   */
  #joined(
    eveTurnId: string,
    deliveryIds: readonly string[],
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      const bound = new Set(turn.deliveries ?? []);
      const joining = deliveryIds.filter((id) => !bound.has(id));
      if (joining.length === 0) return;
      yield* this.#bound(standing, joining, eveTurnId, hostTurnId(standing.sessionId, eveTurnId));
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) => ({
          ...held,
          deliveries: [...(held.deliveries ?? []), ...joining],
        })),
      );
    });
  }

  #received(
    eveTurnId: string,
    text: string,
    eventId: string | undefined,
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      // A line eve delivers again adds nothing; the lines read before this one number its row.
      const read = turn.received ?? { count: 0, eventId: "" };
      if (eventId !== undefined && eventId <= read.eventId) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) => ({
          ...held,
          received: { count: read.count + 1, eventId: eventId ?? read.eventId },
        })),
      );
      const { trigger, receivedLine } = BRAIN_HOST_TURN_KIND[turn.kind];
      if (receivedLine === RECEIVED_LINE.TRANSCRIPT) {
        // The developer's line is the transcript's, under the ask's own id; a row
        // written before the ask learned this turn is taken into it here, moved to
        // a fresh place ahead of the journal the first step is about to open, and
        // one written after lands attached by the writer's own read of the ask.
        const attached = yield* this.#seams.writer.attachAskLines(
          standing.target,
          hostTurnId(standing.sessionId, eveTurnId),
        );
        if (Result.isFailure(attached)) {
          this.#seams.report(
            `The store refused to tie turn ${eveTurnId}'s line to it: ${attached.failure.refusal}.`,
          );
        }
        return;
      }
      // A line the developer sent to a running coding agent already stands in the conversation,
      // awaiting this turn: the receipt takes it into the turn rather than writing it again, and
      // the turn's own received-line count still moves, so a later line's row keeps its id.
      const taken = yield* this.#seams.writer.takeAwaitingLine(standing.target, {
        text,
        turnId: hostTurnId(standing.sessionId, eveTurnId),
      });
      if (Result.isSuccess(taken) && Option.isSome(taken.success)) return;
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
        message: userMessage(
          receivedMessageId(standing.sessionId, eveTurnId, read.count),
          text,
          userMetadataOf(
            trigger,
            turn.kind === BRAIN_HOST_TURN.SPOKEN ? BRAIN_REQUEST_ORIGIN.SPOKEN : undefined,
          ),
        ),
      });
      // The hook cannot stop the turn eve already opened, so an ask the store
      // refused is remembered on the turn: its answer is not written, and the
      // turn ends failed for persistence rather than settling a reply to nothing.
      if (written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (turn) => ({ ...turn, askRefused: true })),
      );
    });
  }

  /** A step opens once: a start eve re-emits finds its step held and tells nothing again. */
  #stepStarted(eveTurnId: string, stepIndex: number, standing: RelayStanding): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      const key = String(stepIndex);
      if (turn.steps[key] !== undefined) return;
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.STEP_STARTED,
        step: stepOf(stepIndex),
      });
      if (!written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) => ({
          ...held,
          steps: { ...held.steps, [key]: held.steps[key] ?? { parts: [] } },
        })),
      );
    });
  }

  #toolCall(
    eveTurnId: string,
    stepIndex: number,
    callId: string,
    name: string,
    input: UnparsedWireValue,
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      if (
        Object.values(turn.steps).some((step) =>
          step.parts.some((part) => part.kind === "tool" && part.callId === callId),
        )
      ) {
        return;
      }
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
        callId,
        name,
        input,
      });
      if (!written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (turn) =>
          withPart(turn, stepIndex, { kind: "tool", callId, name, input }),
        ),
      );
    });
  }

  #toolResult(
    eveTurnId: string,
    callId: string,
    name: string,
    settlement: ToolCallSettlement,
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      // A result eve emits again finds its call already settled and does nothing more.
      if (
        Object.values(turn.steps).some((step) =>
          step.parts.some(
            (part) =>
              part.kind === "tool" && part.callId === callId && part.settlement !== undefined,
          ),
        )
      ) {
        return;
      }
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
        callId,
        name,
        settlement,
      });
      // What the relay keeps is what the writer took: a refused write leaves the
      // call unsettled here too, so the result eve emits again is told again.
      if (!written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) => withSettlement(held, callId, settlement)),
      );
    });
  }

  /**
   * Reads one of eve's text events into its step's draft and, where another
   * sentence finished, tells the writer the step's words through it. A draft
   * the writer refused keeps its count, so the next sentence tells the words
   * again; an event eve delivers again finds its id read and adds nothing.
   * Note that an event without an id, from a session older than eve's stamping
   * of one, is read as it comes, since nothing could tell it from another.
   */
  #drafted(
    eveTurnId: string,
    stepIndex: number,
    eventId: string | undefined,
    standing: RelayStanding,
    grow: (draft: RelayDraft) => RelayDraft,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      const key = String(stepIndex);
      const held = turn.drafts?.[key] ?? EMPTY_DRAFT;
      if (eventId !== undefined && eventId <= held.eventId) return;
      const draft = { ...grow(held), eventId: eventId ?? held.eventId };
      const withDraft = (next: RelayDraft) =>
        standing.state.update((state) =>
          withTurn(state, eveTurnId, (current) => ({
            ...current,
            drafts: { ...current.drafts, [key]: next },
          })),
        );
      withDraft(draft);
      const text = finishedSentencesOf(joinedWords(draft.completed, draft.forming));
      if (text.length <= draft.told) return;
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TEXT_DRAFTED,
        step: stepOf(stepIndex),
        text,
      });
      if (written) withDraft({ ...draft, told: text.length });
    });
  }

  #reasoning(
    eveTurnId: string,
    stepIndex: number,
    text: string,
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      const held = turn.steps[String(stepIndex)]?.parts ?? [];
      if (held.some((part) => part.kind === "reasoning" && part.text === text)) return;
      const ordinal = held.filter((part) => part.kind === "reasoning").length;
      const id = reasoningItemId(standing.sessionId, eveTurnId, stepIndex, ordinal);
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
        summary: text,
        item: { id, summary: text },
      });
      if (!written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (turn) =>
          withPart(turn, stepIndex, { kind: "reasoning", id, text }),
        ),
      );
    });
  }

  #turnEnded(
    eveTurnId: string,
    ended: BrainRequestStatus,
    standing: RelayStanding,
    failureDetail?: string,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      let status = ended;
      let failure: BrainRequestFailure | undefined =
        ended === BRAIN_REQUEST_STATUS.FAILED ? BRAIN_REQUEST_FAILURE.MODEL : undefined;
      if (status === BRAIN_REQUEST_STATUS.SUCCEEDED && turn.askRefused) {
        status = BRAIN_REQUEST_STATUS.FAILED;
        failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
      }
      if (status === BRAIN_REQUEST_STATUS.SUCCEEDED) {
        const builder = new AssistantMessageBuilder();
        for (const step of orderedSteps(turn)) {
          builder.stepStart();
          for (const part of orderedParts(step)) {
            switch (part.kind) {
              case "reasoning":
                builder.reasoning({ itemId: part.id, summary: part.text, item: { id: part.id } });
                break;
              case "tool":
                builder.toolCall(
                  {
                    callId: part.callId,
                    name: part.name,
                    argumentsJson: JSON.stringify(part.input),
                  },
                  part.input,
                );
                if (part.settlement) builder.toolResult(part.callId, part.settlement);
                break;
              case "text":
                builder.text(part.text);
                break;
            }
          }
        }
        const answered = yield* this.#tell(eveTurnId, standing, {
          kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
          message: builder.finish(answerMessageId(standing.sessionId, eveTurnId)),
        });
        // An answer the store refused is a turn the record cannot complete: it
        // ends failed for persistence rather than sealed without its words.
        if (!answered) {
          status = BRAIN_REQUEST_STATUS.FAILED;
          failure = BRAIN_REQUEST_FAILURE.PERSISTENCE;
        }
      }
      const usage = usageOf(turn);
      const sealed = yield* this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TURN_ENDED,
        status,
        ...(failure !== undefined ? { failure } : undefined),
        ...(failureDetail !== undefined ? { failureDetail } : undefined),
        ...(usage !== undefined ? { usage } : undefined),
        responseIds: [],
        at: this.#seams.now(),
      });
      // A turn end the store refused leaves the turn standing in relay state:
      // its row is still running, and the boundary eve re-emits is the retry
      // that settles it, which a dropped turn would answer with nothing.
      if (!sealed) return;
      standing.state.update((state) => this.#without(state, eveTurnId));
    });
  }

  /** Stamps one event with the conversation, the turn's store id, and the next sequence number, and hands it to the writer; answers whether the writer took it. */
  #tell(eveTurnId: string, standing: RelayStanding, body: BrainRunEventBody): RelayEffect<boolean> {
    return Effect.gen({ self: this }, function* () {
      let sequence = 0;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (turn) => {
          sequence = turn.sequence + 1;
          return { ...turn, sequence };
        }),
      );
      const event: BrainRunEvent = {
        ...body,
        conversationId: sessionKey(standing.target.conversationId),
        turnId: hostTurnId(standing.sessionId, eveTurnId),
        sequence,
      };
      const written = yield* this.#seams.writer.consume(standing.target, event);
      if (Result.isFailure(written)) {
        this.#seams.report(
          `The store refused a ${event.kind} event of turn ${event.turnId}: ${written.failure.refusal}.`,
        );
      }
      return Result.isSuccess(written);
    });
  }
}
