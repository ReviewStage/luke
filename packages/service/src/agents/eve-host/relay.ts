import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  answerMessageId,
  hostTurnId,
  reasoningItemId,
  receivedMessageId,
} from "@luke/database/models/ids";
import type { ConversationTarget, StoreWriter } from "@luke/database/models/writer";
import { CONNECTION_TOOL } from "@luke/features/agent-tools";
import { redactCredentials } from "@luke/features/credential-redaction";
import { failureKind, reportUnexpected } from "@luke/runtime/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { MessageStreamEvent } from "eve/client";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  addModelUsage,
  finishedSentencesOf,
  isRecord,
  isWireString,
  RUN_EVENT,
  RUN_STATUS,
  type RunEvent,
  type RunEventBody,
  type RunModelUsage,
  type RunStatus,
  type RunUsage,
  sessionKey,
  TOOL_CALL_SETTLEMENT,
  type ToolCallSettlement,
  TURN_FAILURE,
  TURN_ORIGIN,
  type TurnFailure,
  type TurnOrigin,
  toolCallSettlementOf,
  type UnparsedWireValue,
  unparsedWire,
  userMessage,
  userMetadataOf,
} from "../../core.js";
import { isRemoteToolName, storedRemoteCall } from "../../integrations/connection-tools.js";
import { LOOK_AT_PICTURE_TOOL, storedPictureLookOutput } from "../../tasks/picture-look.js";
import { type ReceivedMessage, receivedMessage } from "../attached-files.js";
import { BROWSER_TOOL, storedBrowserOutput } from "../browser/browser-tool.js";
import { EVE_HOST_TURN, EVE_HOST_TURN_KIND, RELAY_TURN, type RelayTurn } from "./bounds.js";
import { keptPictures } from "./relay-pictures.js";

/**
 * The relay from eve's stream into the brain's own: every event eve records
 * for a session is read here, after eve has written it, and told again as
 * the `RunEvent` the store writer consumes, so the writer stays the sole
 * consumer and the only thing that writes a message row. Each line a turn
 * receives is told apart as it arrives (`#received`): a line typed to a
 * coding agent is written ahead of its turn as a row awaiting one and taken
 * into the turn that receives it, and any other is written here. Everything
 * below from a turn's start to its answer is the same for both
 * hosts. eve numbers a turn
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
 * finished sentence each time another finishes, never at every token. A
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
  readonly kind: RelayTurn;
  readonly sequence: number;
  readonly steps: Readonly<Record<string, RelayStep>>;
  /** Each step's usage under its index, so a step eve replays reports its usage once. */
  readonly usageBySteps: Readonly<Record<string, RunUsage>>;
  /** The model each step ran on under its index, the agent's row as it stood at the step's start; absent in state an earlier build kept. */
  readonly modelBySteps?: Readonly<Record<string, string>>;
  /** Each step's words under its index while they form; absent in state an earlier build kept. */
  readonly drafts?: Readonly<Record<string, RelayDraft>>;
  /** Whether the store refused the ask that opened the turn: a turn with no ask on record settles no answer. */
  readonly askRefused?: true;
  /** How many developer lines the turn has received, and eve's id for the last one read, so a line eve delivers again adds nothing; absent in state an earlier build kept. */
  readonly received?: { readonly count: number; readonly eventId: string };
  /** The instant the writer last took a write that grew the turn's journal; absent before the first, and in state an earlier build kept. */
  readonly journaledAt?: number;
  /** The events that grow the journal told inside the interval since it was last written, in order, to land with its next write (`JOURNAL_WRITE_INTERVAL_MS`). */
  readonly held?: readonly RunEvent[];
}

/** What one session's relay keeps: the turns still under way, by eve's own turn id. */
export interface RelayState {
  readonly turns: Readonly<Record<string, RelayTurnState>>;
  /** Whether the hook has said that it drops the session's events, the session not admitted, which it says once a session. */
  readonly unadmittedSaid?: true;
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
  /** The coding agent whose conversation the session records into, which the relay's log lines name; nothing where the caller holds none. */
  readonly agentId?: string;
  /** The kind of turn the request that opened the current turn named; nothing when it named none. */
  readonly turn: RelayTurn | undefined;
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
 * on. The relay runs nothing: `eveHost`'s `relay` composes this into the
 * effect it already answers, and a test runs it on its own database.
 */
type RelayEffect<Value> = Effect.Effect<Value, QueryError | Schema.SchemaError, DatabaseServices>;

interface StreamRelaySeams {
  /** The writes the relay makes. */
  readonly writer: Pick<StoreWriter, "consumeAll" | "enqueueTurn" | "takeAwaitingLine">;
  readonly now: () => number;
  /** Where a write the writer refused is said, under the event's ids; the relay never throws into eve's turn. */
  readonly report: (message: string) => Effect.Effect<void>;
}

/** The task's turn origin for each kind of turn a request opens, as the queued row records it. */
const TURN_ORIGIN_OF_HOST_TURN = {
  [EVE_HOST_TURN.TYPED]: TURN_ORIGIN.TYPED,
  [RELAY_TURN.CHILD]: TURN_ORIGIN.CHILD,
} as const satisfies Record<RelayTurn, TurnOrigin>;

/**
 * The run seams of a turn under way by its kind. Note that a turn an
 * earlier build opened as spoken, a kind this build no longer names, reads
 * as typed, because eve's durable state may still hold one and every such
 * turn was an ask too.
 */
function kindOfTurn(turn: RelayTurnState): (typeof EVE_HOST_TURN_KIND)[RelayTurn] {
  return Object.hasOwn(EVE_HOST_TURN_KIND, turn.kind)
    ? EVE_HOST_TURN_KIND[turn.kind]
    : EVE_HOST_TURN_KIND[EVE_HOST_TURN.TYPED];
}

const TOOL_CALL_KIND = "tool-call";
/** eve's own kind of action for a call to a declared subagent, named by the tool eve lowers the subagent into, which is the name its result carries. */
const SUBAGENT_CALL_KIND = "subagent-call";
/** eve's own kind of action for a load of one of the session's skills, which the model calls as `load_skill` and the record names so. */
const LOAD_SKILL_KIND = "load-skill";
const LOAD_SKILL_TOOL = "load_skill";

const TOOL_RESULT_KIND = "tool-result";
/** The result of a skill's load: the skill's body, or why it did not load. */
const LOAD_SKILL_RESULT_KIND = "load-skill-result";
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
    case LOAD_SKILL_KIND:
      return { callId: action.callId, name: LOAD_SKILL_TOOL };
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
const FAILURE_DETAIL_BOUNDS = { MESSAGE_CHARS: 200, KEYS_CHARS: 120 } as const;

/** The kind an unexpected failure of the relay's own writes is reported under. */
const RELAY_STORE_FAILURE = "relay_store_failure";

type TurnFailedData = Extract<MessageStreamEvent, { readonly type: "turn.failed" }>["data"];

/** What eve says of a failure, a turn's or a whole session's, which carry the same three fields. */
export type EveFailure = Pick<TurnFailedData, "code" | "details" | "message">;

/**
 * Why eve failed the turn or its session, as the row keeps it: eve's own code, the sorted
 * key names of its details so the next reader knows what eve offers, the
 * fixed words above where the details carry them, and eve's `message`
 * redacted and cut, which is where a bare `MODEL_CALL_FAILED` gets its
 * diagnosis, the host's own refusal word included. eve's `step.failed`
 * carries the same code, message, and details as the `turn.failed` it
 * precedes, so nothing is kept from it.
 */
export function failureDetailOf(data: EveFailure): string {
  const words = [data.code];
  const keys = Object.keys(data.details ?? {})
    .sort()
    .join(",");
  // eve's keys are its own names, but are redacted too, since the detail is logged and reported as well as kept.
  if (keys) words.push(`[${redactCredentials(keys).slice(0, FAILURE_DETAIL_BOUNDS.KEYS_CHARS)}]`);
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

/**
 * How often a running turn's journal is written for what only grows it: a
 * step's boundary, its reasoning, or a call's answer told less than this
 * after the journal was last written is held in the turn's relay state,
 * which eve keeps durably with the event, and lands in order with the
 * journal's next write. Every write rewrites the journal's parts whole, so a
 * turn that told each of these at once rewrote its parts once for each. A
 * finished sentence is not held; it lands at once with whatever was held.
 *
 * Nothing waits on a timer, which would end with eve's step and the function
 * instance under it: what is held lands with the next event of the turn's
 * stream past the interval, whatever its kind (`foldedQuietly` relays it),
 * and at once with a finished sentence, ahead of a call's start, which is
 * never held so the call stands in the record before it runs (the calls one
 * request asks for land together), ahead of a developer's line taken
 * into the turn, at a step's end, and with the turn's answer and its end. A
 * held event lives in eve's state, so a step eve resumes lands it; only a
 * session lost for good leaves it unwritten, and the turn's abandonment
 * settles the journal as it last landed, never missing a call it made.
 */
export const JOURNAL_WRITE_INTERVAL_MS = 250;

/** The events held while the journal was written within the interval: each only grows it. */
const HELD_EVENTS: ReadonlySet<RunEvent["kind"]> = new Set([
  RUN_EVENT.STEP_STARTED,
  RUN_EVENT.REASONING_COMPLETED,
  RUN_EVENT.TOOL_CALL_SETTLED,
]);

/** The events a write of the journal carries, which start the interval again. */
const JOURNAL_EVENTS: ReadonlySet<RunEvent["kind"]> = new Set([
  ...HELD_EVENTS,
  RUN_EVENT.TEXT_DRAFTED,
  RUN_EVENT.TOOL_CALL_STARTED,
]);

/** Whether the turn's journal was written less than the interval ago. */
function journaledWithin(turn: RelayTurnState, now: number): boolean {
  return turn.journaledAt !== undefined && now - turn.journaledAt < JOURNAL_WRITE_INTERVAL_MS;
}

/** The steps whose finished words the writer has not yet taken, by the step's key, with those words. */
function untoldDrafts(
  turn: RelayTurnState,
): readonly { readonly key: string; readonly draft: RelayDraft; readonly text: string }[] {
  return Object.entries(turn.drafts ?? {}).flatMap(([key, draft]) => {
    const text = finishedSentencesOf(joinedWords(draft.completed, draft.forming));
    return text.length > draft.told ? [{ key, draft, text }] : [];
  });
}

/** Whether the turn holds anything the journal was not yet told: a held event, or finished words. */
function holdsUnwritten(turn: RelayTurnState): boolean {
  return (turn.held?.length ?? 0) > 0 || untoldDrafts(turn).length > 0;
}

const readTurnOfEvent = Schema.decodeUnknownOption(Schema.Struct({ turnId: Schema.String }));

/** The turn an event of eve's stream belongs to, where it names one. */
function turnIdOf(event: MessageStreamEvent): string | undefined {
  return Option.getOrUndefined(Option.map(readTurnOfEvent(event.data), (data) => data.turnId));
}

/** A step's draft as one of eve's text events grows it, and the step's finished words through it. */
interface GrownDraft {
  readonly key: string;
  readonly draft: RelayDraft;
  readonly text: string;
}

/**
 * The draft an event grows and the finished sentences it then holds;
 * nothing for a turn the relay holds none of or an event the draft already
 * read. Note that an event without an id, from a session older than eve's
 * stamping of one, is read as it comes, since nothing could tell it from
 * another.
 */
function grownDraft(
  state: RelayState,
  eveTurnId: string,
  stepIndex: number,
  eventId: string | undefined,
  grow: (draft: RelayDraft) => RelayDraft,
): GrownDraft | undefined {
  const turn = state.turns[eveTurnId];
  if (!turn) return undefined;
  const key = String(stepIndex);
  const held = turn.drafts?.[key] ?? EMPTY_DRAFT;
  if (eventId !== undefined && eventId <= held.eventId) return undefined;
  const draft = { ...grow(held), eventId: eventId ?? held.eventId };
  return { key, draft, text: finishedSentencesOf(joinedWords(draft.completed, draft.forming)) };
}

function keepDraft(store: RelayStateStore, eveTurnId: string, key: string, draft: RelayDraft) {
  store.update((state) =>
    withTurn(state, eveTurnId, (current) => ({
      ...current,
      drafts: { ...current.drafts, [key]: draft },
    })),
  );
}

/** The events that end a turn, whose own write carries whatever the turn held. */
const TURN_END_EVENT = {
  COMPLETED: "turn.completed",
  FAILED: "turn.failed",
  CANCELLED: "turn.cancelled",
} as const;

const TURN_END_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set(
  Object.values(TURN_END_EVENT),
);

/** One call a request of eve's asks for, as the record names it. */
interface RequestedCall {
  readonly callId: string;
  readonly name: string;
  readonly input: UnparsedWireValue;
}

/**
 * The turn's state with a held event the writer refused taken back out:
 * a step's boundary that holds nothing yet, a reasoning part, or a call's
 * answer, so the relay keeps only what the writer took.
 */
function withoutRefused(turn: RelayTurnState, event: RunEvent): RelayTurnState {
  switch (event.kind) {
    case RUN_EVENT.STEP_STARTED: {
      const key = String(event.step - 1);
      if ((turn.steps[key]?.parts.length ?? 0) > 0) return turn;
      const { [key]: _step, ...steps } = turn.steps;
      return { ...turn, steps };
    }
    case RUN_EVENT.REASONING_COMPLETED:
      return mapParts(turn, (part) =>
        part.kind === "reasoning" && part.id === event.item.id ? [] : [part],
      );
    case RUN_EVENT.TOOL_CALL_SETTLED:
      return mapParts(turn, (part) => {
        if (part.kind !== "tool" || part.callId !== event.callId) return [part];
        const { settlement: _settlement, ...unsettled } = part;
        return [unsettled];
      });
    default:
      return turn;
  }
}

function mapParts(
  turn: RelayTurnState,
  map: (part: RelayPart) => readonly RelayPart[],
): RelayTurnState {
  const steps = Object.fromEntries(
    Object.entries(turn.steps).map(([key, step]) => [key, { parts: step.parts.flatMap(map) }]),
  );
  return { ...turn, steps };
}

/** The kinds of event `StreamRelay.handle` reads; it passes over every other kind eve emits. */
const RELAYED_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set([
  "turn.started",
  "message.received",
  "step.started",
  "actions.requested",
  "action.result",
  "reasoning.completed",
  "message.appended",
  "message.completed",
  "step.completed",
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

/**
 * Folds an event the store need hear nothing of into the session's relay
 * state, and answers whether it did, so the hook relays only the rest and
 * admits the session, which costs the store its reads, only for them. An
 * event of a kind the relay passes over is folded as nothing: eve streams a
 * step's reasoning and a call's input a fragment at a time, and those
 * fragments outnumber every other event. A fragment of the step's words is
 * folded into its draft where it finishes no sentence the writer was not
 * already told; one that does is the relay's, which grows the draft as this
 * would and tells the writer. Any event of a turn holding what the journal
 * was not yet told (`JOURNAL_WRITE_INTERVAL_MS`) is relayed once the
 * interval has passed, so what waits lands with the stream's next event
 * rather than its next write. Note
 * that folding needs no admission because it touches only the session's own
 * state: a turn is held there only once an admitted relay opened it, and
 * what is folded reaches the store only through a later event the hook
 * admits. `now` is the host's clock; without it nothing waits on the
 * interval.
 */
export function foldedQuietly(
  event: MessageStreamEvent,
  state: RelayStateStore,
  now?: number,
): boolean {
  const eveTurnId = turnIdOf(event);
  const turn = eveTurnId === undefined ? undefined : state.get().turns[eveTurnId];
  const waiting = turn !== undefined && now !== undefined && journaledWithin(turn, now);
  if (turn !== undefined && holdsUnwritten(turn) && !waiting) return false;
  if (!RELAYED_EVENTS.has(event.type)) return true;
  if (event.type !== "message.appended") return false;
  const { turnId, stepIndex, messageDelta } = event.data;
  const grown = grownDraft(state.get(), turnId, stepIndex, event.meta.id, (draft) => ({
    ...draft,
    forming: draft.forming + messageDelta,
  }));
  if (grown === undefined) return true;
  if (grown.text.length > grown.draft.told) return false;
  keepDraft(state, turnId, grown.key, grown.draft);
  return true;
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
function usageOf(turn: RelayTurnState): RunUsage | undefined {
  return Object.values(turn.usageBySteps).reduce<RunUsage | undefined>(
    (total, usage) => addModelUsage(total, usage),
    undefined,
  );
}

/**
 * The turn's usage by the model each step ran on, in the order the models
 * were first met. A step whose model the state did not keep, because the
 * turn began under a build that kept none or a session that named none,
 * leaves the whole breakdown out, so the row prices every step at the
 * model it started on rather than guessing one for the step.
 */
function usageByModelOf(turn: RelayTurnState): RunModelUsage[] {
  const byModel = new Map<string, RunUsage>();
  for (const [step, usage] of Object.entries(turn.usageBySteps)) {
    const model = turn.modelBySteps?.[step];
    if (model === undefined) return [];
    byModel.set(model, addModelUsage(byModel.get(model), usage));
  }
  return [...byModel].map(([model, usage]) => ({ model, ...usage }));
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

/** The name a call the turn holds is stored under, or nothing for a call it does not hold. */
function heldCallName(state: RelayState, eveTurnId: string, callId: string): string | undefined {
  const turn = state.turns[eveTurnId];
  if (!turn) return undefined;
  for (const step of Object.values(turn.steps)) {
    for (const part of step.parts) {
      if (part.kind === "tool" && part.callId === callId) return part.name;
    }
  }
  return undefined;
}

/**
 * A look's result as the conversation keeps it, a look at one of the
 * plan's pictures without the image, and a browser call's
 * without the model's copy of each screenshot; nothing for any other call.
 * Note that a look's image went to the model once and is not kept, because
 * it is no record of the plan, and that a browser call's screenshots are
 * named by the full-size copy the tool already kept beside the transcript
 * (`browser-tool.ts`, the cloud browser's line in `AGENTS.md`).
 */
function storedLook(toolName: string, output: UnparsedWireValue): UnparsedWireValue | undefined {
  switch (toolName) {
    case LOOK_AT_PICTURE_TOOL.name:
      return storedPictureLookOutput(output);
    case BROWSER_TOOL.name:
      return storedBrowserOutput(output);
    default:
      return undefined;
  }
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

  /**
   * Reads one event of the session's stream and tells the writer what it
   * amounts to, first landing what the turn's journal holds where it is due:
   * past the interval, at a step's end, or ahead of a developer's line the
   * turn takes, whose place among the steps is read from the journal.
   */
  handle(event: MessageStreamEvent, standing: RelayStanding): RelayEffect<void> {
    const eveTurnId = turnIdOf(event);
    const read = Effect.suspend(() => this.#read(event, standing));
    const handled =
      eveTurnId === undefined
        ? read
        : Effect.andThen(this.#landDue(eveTurnId, event.type, standing), read);
    const ids = {
      userId: standing.target.userId,
      conversationId: standing.target.conversationId,
      sessionId: standing.sessionId,
      ...(standing.agentId !== undefined ? { agentId: standing.agentId } : undefined),
      ...(eveTurnId !== undefined
        ? { turnId: hostTurnId(standing.sessionId, eveTurnId) }
        : undefined),
    };
    return handled.pipe(
      // Note that what the store could not do at all is still eve's to retry, so it is said here
      // and reported, because the turn otherwise stands running until the sweep's bound.
      Effect.tapError((failure) =>
        Effect.logError(`a ${event.type} event was not relayed: ${failureKind(failure)}`).pipe(
          Effect.andThen(
            reportUnexpected(RELAY_STORE_FAILURE, { ...ids, error: failureKind(failure) }),
          ),
          Effect.annotateLogs({ reason: RELAY_STORE_FAILURE }),
        ),
      ),
      Effect.annotateLogs(ids),
    );
  }

  #landDue(
    eveTurnId: string,
    type: MessageStreamEvent["type"],
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.suspend(() => {
      const turn = standing.state.get().turns[eveTurnId];
      if (turn === undefined || !holdsUnwritten(turn)) return Effect.void;
      // The turn's end lands what it holds in its own write (`#tell`), ahead of its answer or its end.
      if (TURN_END_EVENTS.has(type)) return Effect.void;
      const boundary = type === "step.completed" || type === "message.received";
      if (!boundary && journaledWithin(turn, this.#seams.now())) return Effect.void;
      return Effect.asVoid(this.#land(eveTurnId, standing, []));
    });
  }

  #read(event: MessageStreamEvent, standing: RelayStanding): RelayEffect<void> {
    switch (event.type) {
      case "turn.started":
        return this.#turnStarted(event.data.turnId, standing);
      case "message.received":
        return this.#received(
          event.data.turnId,
          receivedMessage(event.data),
          event.meta.id,
          standing,
        );
      case "step.started":
        return this.#stepStarted(event.data.turnId, event.data.stepIndex, standing);
      case "actions.requested": {
        const { turnId, stepIndex, actions } = event.data;
        return Effect.suspend(() => {
          const requested: RequestedCall[] = [];
          const unstored: string[] = [];
          for (const action of actions) {
            const call = requestedCallOf(action);
            if (!call) continue;
            const input = unparsedWire(action.input);
            const parentCallId = action.kind === TOOL_CALL_KIND ? action.parentCallId : undefined;
            const stored =
              parentCallId === undefined
                ? { name: call.name, input }
                : this.#nestedCall(
                    turnId,
                    call.name,
                    input,
                    parentCallId,
                    standing,
                    requested,
                    unstored,
                  );
            if (!stored) continue;
            requested.push({ callId: call.callId, name: stored.name, input: stored.input });
          }
          return Effect.andThen(
            Effect.forEach(unstored, this.#seams.report, { discard: true }),
            this.#toolCalls(turnId, stepIndex, requested, standing),
          );
        });
      }
      case "action.result": {
        const result = event.data.result;
        if (result.kind === LOAD_SKILL_RESULT_KIND) {
          return this.#toolResult(
            event.data.turnId,
            result.callId,
            LOAD_SKILL_TOOL,
            settlementOf(
              event.data.status,
              result.isError,
              unparsedWire(result.output),
              event.data.error?.message,
            ),
            standing,
          );
        }
        if (result.kind !== TOOL_RESULT_KIND) return Effect.void;
        // A nested call the record left out leaves its result out with it.
        const held = heldCallName(standing.state.get(), event.data.turnId, result.callId);
        if (held === undefined && isRemoteToolName(result.toolName)) return Effect.void;
        // Note that a look's image is not kept (`storedLook`), and that any other picture a tool
        // answered is kept beside the conversation and named by id, because the record carries
        // every byte it holds into each read of the transcript.
        const output = unparsedWire(result.output);
        const looked = storedLook(result.toolName, output);
        const kept =
          looked === undefined ? keptPictures(standing.target, output) : Effect.succeed(looked);
        return Effect.flatMap(kept, (stored) =>
          this.#toolResult(
            event.data.turnId,
            result.callId,
            held ?? result.toolName,
            settlementOf(event.data.status, result.isError, stored, event.data.error?.message),
            standing,
          ),
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
                  ...(usage.cacheWriteTokens !== undefined
                    ? { cacheWriteTokens: usage.cacheWriteTokens }
                    : undefined),
                }),
              },
            })),
          ),
        );
      }
      case "turn.completed":
        return this.#turnEnded(event.data.turnId, RUN_STATUS.SUCCEEDED, standing);
      case "turn.failed":
        return this.#turnEnded(
          event.data.turnId,
          RUN_STATUS.FAILED,
          standing,
          failureDetailOf(event.data),
        );
      case "turn.cancelled":
        return this.#turnEnded(event.data.turnId, RUN_STATUS.CANCELLED, standing);
      default:
        return Effect.void;
    }
  }

  #turnStarted(eveTurnId: string, standing: RelayStanding): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      // A start eve emits again finds its turn already under way and leaves what it accumulated standing.
      const state = standing.state.get();
      if (state.turns[eveTurnId]) return;
      const kind = standing.turn;
      if (kind === undefined) {
        yield* this.#seams.report(
          `Turn ${eveTurnId} of session ${standing.sessionId} named no kind of turn and is not recorded.`,
        );
        return;
      }
      standing.state.update((state) => ({
        ...state,
        turns: {
          ...state.turns,
          [eveTurnId]: { kind, sequence: 0, steps: {}, usageBySteps: {} },
        },
      }));
      const { origin, trigger } = EVE_HOST_TURN_KIND[kind];
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
        yield* this.#seams.report(
          `The store refused to queue turn ${eveTurnId}: ${queued.failure.refusal}.`,
        );
        standing.state.update((state) => this.#without(state, eveTurnId));
        return;
      }
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: RUN_EVENT.TURN_STARTED,
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

  #without(state: RelayState, eveTurnId: string): RelayState {
    const { [eveTurnId]: _dropped, ...rest } = state.turns;
    return { ...state, turns: rest };
  }

  /**
   * One line the turn received: first taken as the developer's typed lines
   * awaiting a turn (`takeAwaitingLine`), and otherwise written here as the
   * turn's user row.
   */
  #received(
    eveTurnId: string,
    received: ReceivedMessage,
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
      const turnId = hostTurnId(standing.sessionId, eveTurnId);
      // The lines the developer sent to a running coding agent already stand in the conversation,
      // awaiting this turn, one or several eve coalesced into this one message: the receipt takes
      // them into the turn rather than writing them again, and the turn's own received-line count
      // still moves, so a later line's row keeps its id.
      const taken = yield* this.#seams.writer.takeAwaitingLine(standing.target, {
        text: received.text,
        turnId,
      });
      if (Result.isSuccess(taken) && taken.success.length > 0) return;
      // A message written here keeps its words as its first part and the files it carried after them.
      const message = userMessage(
        receivedMessageId(standing.sessionId, eveTurnId, read.count),
        received.words,
        userMetadataOf(kindOfTurn(turn).trigger),
      );
      const written = yield* this.#tell(eveTurnId, standing, {
        kind: RUN_EVENT.MESSAGE_COMPLETED,
        message: { ...message, parts: [...message.parts, ...received.files] },
      });
      // The hook cannot stop the turn eve already opened, so an ask the store
      // refused is remembered on the turn: its answer is not written, and the
      // turn ends failed for persistence rather than settling a reply to nothing.
      if (written) return;
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (current) => ({ ...current, askRefused: true })),
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
        kind: RUN_EVENT.STEP_STARTED,
        step: stepOf(stepIndex),
      });
      if (!written) return;
      // The row the host reads the step's model from is read again for this
      // event, so what it names now is what the step runs on.
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) => ({
          ...held,
          steps: { ...held.steps, [key]: held.steps[key] ?? { parts: [] } },
          ...(standing.model !== undefined
            ? { modelBySteps: { ...held.modelBySteps, [key]: standing.model } }
            : undefined),
        })),
      );
    });
  }

  /**
   * A call eve nested under another, as the record keeps it: a Linear
   * tool's run under the `connection_execute` this turn holds, stored under
   * its fixed name and envelope (`../connection-tools.ts`), so both the
   * wrapper and the call Linear answered stand in the transcript. A nested
   * call under anything else, or of no Linear tool, has no name the record
   * holds and is left out, its wrapper standing for it, and why is added to
   * `unstored` for the caller to report.
   */
  #nestedCall(
    eveTurnId: string,
    name: string,
    input: UnparsedWireValue,
    parentCallId: string,
    standing: RelayStanding,
    requested: readonly RequestedCall[],
    unstored: string[],
  ): { readonly name: string; readonly input: UnparsedWireValue } | undefined {
    const parent =
      heldCallName(standing.state.get(), eveTurnId, parentCallId) ??
      requested.find((call) => call.callId === parentCallId)?.name;
    const stored =
      parent === CONNECTION_TOOL.EXECUTE ? storedRemoteCall(name, input, parentCallId) : undefined;
    if (stored === undefined && standing.state.get().turns[eveTurnId] !== undefined) {
      unstored.push(
        `A nested call of turn ${eveTurnId} under ${parent ?? "no held call"} has no stored name and is not recorded.`,
      );
    }
    return stored;
  }

  /**
   * The calls one request of eve's asks for, told together in one write and
   * never held, so each stands in the record before any of them runs; a call
   * the turn already holds, as in a request eve emits again, is told no
   * more. What the relay keeps is what the writer took: a call it refused is
   * left out here too, so the request eve emits again tells it again.
   */
  #toolCalls(
    eveTurnId: string,
    stepIndex: number,
    requested: readonly RequestedCall[],
    standing: RelayStanding,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (!turn) return;
      const calls = requested.filter(
        (call, index) =>
          heldCallName(standing.state.get(), eveTurnId, call.callId) === undefined &&
          requested.findIndex((other) => other.callId === call.callId) === index,
      );
      if (calls.length === 0) return;
      const taken = yield* this.#land(
        eveTurnId,
        standing,
        calls.map((call) => ({ kind: RUN_EVENT.TOOL_CALL_STARTED, ...call })),
      );
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (held) =>
          calls.reduce(
            (next, call, index) =>
              taken[index] === true ? withPart(next, stepIndex, { kind: "tool", ...call }) : next,
            held,
          ),
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
        kind: RUN_EVENT.TOOL_CALL_SETTLED,
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
   * again; an event eve delivers again finds its id read and adds nothing
   * (`grownDraft`).
   */
  #drafted(
    eveTurnId: string,
    stepIndex: number,
    eventId: string | undefined,
    standing: RelayStanding,
    grow: (draft: RelayDraft) => RelayDraft,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const grown = grownDraft(standing.state.get(), eveTurnId, stepIndex, eventId, grow);
      if (grown === undefined) return;
      const { key, draft, text } = grown;
      keepDraft(standing.state, eveTurnId, key, draft);
      if (text.length <= draft.told) return;
      // A finished sentence lands at once and carries with it whatever the turn held; the draft is
      // what it tells (`untoldDrafts`).
      yield* this.#land(eveTurnId, standing, []);
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
        kind: RUN_EVENT.REASONING_COMPLETED,
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
    ended: RunStatus,
    standing: RelayStanding,
    failureDetail?: string,
  ): RelayEffect<void> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      // Note that a failure eve tells of a turn the relay holds nothing of is said rather than dropped, at
      // info, because it is most often eve's replay of an end already sealed rather than a turn never started here.
      if (!turn) {
        if (ended === RUN_STATUS.FAILED) {
          yield* Effect.logInfo(
            `A failed end of a turn the relay holds nothing of, sealed already or never started here, is not relayed: ${failureDetail ?? "no detail"}`,
          );
        }
        return;
      }
      let status = ended;
      let failure: TurnFailure | undefined =
        ended === RUN_STATUS.FAILED ? TURN_FAILURE.MODEL : undefined;
      if (status === RUN_STATUS.SUCCEEDED && turn.askRefused) {
        status = RUN_STATUS.FAILED;
        failure = TURN_FAILURE.PERSISTENCE;
      }
      if (status === RUN_STATUS.SUCCEEDED) {
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
          kind: RUN_EVENT.MESSAGE_COMPLETED,
          message: builder.finish(answerMessageId(standing.sessionId, eveTurnId)),
        });
        // An answer the store refused is a turn the record cannot complete: it
        // ends failed for persistence rather than sealed without its words.
        if (!answered) {
          status = RUN_STATUS.FAILED;
          failure = TURN_FAILURE.PERSISTENCE;
        }
      }
      const usage = usageOf(turn);
      const usageByModel = usageByModelOf(turn);
      const sealed = yield* this.#tell(eveTurnId, standing, {
        kind: RUN_EVENT.TURN_ENDED,
        status,
        ...(failure !== undefined ? { failure } : undefined),
        ...(failureDetail !== undefined ? { failureDetail } : undefined),
        ...(usage !== undefined ? { usage } : undefined),
        ...(usageByModel.length > 0 ? { usageByModel } : undefined),
        responseIds: [],
        at: this.#seams.now(),
      });
      // A turn end the store refused leaves the turn standing in relay state:
      // its row is still running, and the boundary eve re-emits is the retry
      // that settles it, which a dropped turn would answer with nothing.
      if (!sealed) return;
      standing.state.update((state) => this.#without(state, eveTurnId));
      if (status === RUN_STATUS.FAILED) {
        yield* Effect.logError(`a turn failed: ${failureDetail ?? "no detail"}`).pipe(
          Effect.annotateLogs({ failure: failure ?? TURN_FAILURE.MODEL }),
        );
      }
    });
  }

  /** Stamps one event with the conversation, the turn's store id, and the next sequence number. */
  #stamped(eveTurnId: string, standing: RelayStanding, body: RunEventBody): RunEvent {
    let sequence = 0;
    standing.state.update((state) =>
      withTurn(state, eveTurnId, (turn) => {
        sequence = turn.sequence + 1;
        return { ...turn, sequence };
      }),
    );
    return {
      ...body,
      conversationId: sessionKey(standing.target.conversationId),
      turnId: hostTurnId(standing.sessionId, eveTurnId),
      sequence,
    };
  }

  /**
   * Tells the writer one event and answers whether it took it: an event that
   * only grows the journal, told inside the interval since the journal was
   * last written, is held in the turn's state and answered as taken; any
   * other lands now, with whatever the turn held ahead of it.
   */
  #tell(eveTurnId: string, standing: RelayStanding, body: RunEventBody): RelayEffect<boolean> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      if (
        turn !== undefined &&
        HELD_EVENTS.has(body.kind) &&
        journaledWithin(turn, this.#seams.now())
      ) {
        const event = this.#stamped(eveTurnId, standing, body);
        standing.state.update((state) =>
          withTurn(state, eveTurnId, (held) => ({ ...held, held: [...(held.held ?? []), event] })),
        );
        return true;
      }
      const [taken] = yield* this.#land(eveTurnId, standing, [body]);
      return taken === true;
    });
  }

  /**
   * Hands the writer, as one write, what the turn held — its held events,
   * then each step's finished words it was not yet told — and the events
   * given after them, and answers whether it took each event given. A held
   * event the writer refused is taken back out of the turn's state, as one
   * told at once would never have been kept, so eve's next telling of it
   * tells it again.
   */
  #land(
    eveTurnId: string,
    standing: RelayStanding,
    bodies: readonly RunEventBody[],
  ): RelayEffect<readonly boolean[]> {
    return Effect.gen({ self: this }, function* () {
      const turn = standing.state.get().turns[eveTurnId];
      const held = turn?.held ?? [];
      const drafts = turn === undefined ? [] : untoldDrafts(turn);
      const events = [
        ...held,
        ...drafts.map(({ key, text }) =>
          this.#stamped(eveTurnId, standing, {
            kind: RUN_EVENT.TEXT_DRAFTED,
            step: stepOf(Number(key)),
            text,
          }),
        ),
        ...bodies.map((body) => this.#stamped(eveTurnId, standing, body)),
      ];
      if (events.length === 0) return [];
      const results = yield* this.#seams.writer.consumeAll(standing.target, events);
      const taken = events.map((_event, index) => {
        const result = results[index];
        return result !== undefined && Result.isSuccess(result);
      });
      for (const [index, event] of events.entries()) {
        const result = results[index];
        if (result === undefined || Result.isSuccess(result)) continue;
        yield* this.#seams.report(
          `The store refused a ${event.kind} event of turn ${event.turnId}: ${result.failure.refusal}.`,
        );
      }
      const journaled = events.some(
        (event, index) => taken[index] === true && JOURNAL_EVENTS.has(event.kind),
      );
      const now = this.#seams.now();
      standing.state.update((state) =>
        withTurn(state, eveTurnId, (current) => {
          const { held: _landed, ...rest } = current;
          let next: RelayTurnState = journaled ? { ...rest, journaledAt: now } : rest;
          for (const [index, event] of held.entries()) {
            if (taken[index] !== true) next = withoutRefused(next, event);
          }
          for (const [index, { key, draft, text }] of drafts.entries()) {
            if (taken[held.length + index] !== true) continue;
            const kept = next.drafts?.[key] ?? draft;
            next = { ...next, drafts: { ...next.drafts, [key]: { ...kept, told: text.length } } };
          }
          return next;
        }),
      );
      return taken.slice(held.length + drafts.length);
    });
  }
}
