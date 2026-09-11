import type { MessageStreamEvent } from "eve/client";
import {
  ACTION_RESULT_STATUS,
  AssistantMessageBuilder,
  addModelUsage,
  BRAIN_REQUEST_FAILURE,
  BRAIN_REQUEST_ORIGIN,
  BRAIN_REQUEST_STATUS,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  type BrainRequestFailure,
  type BrainRequestStatus,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainRunUsage,
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
import type { AskDeliveryBinding } from "../store/asks.js";
import type { ConversationTarget } from "../store/index.js";
import type { StoreWriter } from "./announce.js";
import { BRAIN_HOST_TURN, BRAIN_HOST_TURN_KIND, type BrainHostTurn } from "./bounds.js";
import { answerMessageId, hostTurnId, reasoningItemId, receivedMessageId } from "./ids.js";

/**
 * The relay from eve's stream into the brain's own: every event eve records
 * for a session is read here, after eve has written it, and told again as
 * the `BrainRunEvent` the store writer consumes, so the writer stays the sole
 * consumer and the only thing that writes a message row. eve numbers a turn
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
 * its words — and replaces the journal whole.
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

interface RelayTurnState {
  readonly kind: BrainHostTurn;
  readonly sequence: number;
  readonly steps: Readonly<Record<string, RelayStep>>;
  /** Each step's usage under its index, so a step eve replays reports its usage once. */
  readonly usageBySteps: Readonly<Record<string, BrainRunUsage>>;
  /** Whether the store refused the ask that opened the turn: a turn with no ask on record settles no answer. */
  readonly askRefused?: true;
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
  /** The content address of the prompt the session runs under, as the turn row records it; nothing before the session composed one. */
  readonly promptHash?: string;
  /** The content address of the tool set this turn is offered, as the turn row records it. */
  readonly toolSetHash?: string;
  readonly state: RelayStateStore;
}

export interface StreamRelaySeams {
  readonly writer: Pick<StoreWriter, "consume" | "enqueueTurn">;
  /** Names the turn each ask delivered into it ran in, once eve's start names the deliveries. */
  readonly asks: AskDeliveryBinding;
  /** Puts a turn's briefing on offer, once its announce call is on the journal; answers whether the offer landed. */
  readonly offer: (target: ConversationTarget, turnId: string) => Promise<boolean>;
  readonly now: () => number;
  /** Where a write the writer refused is said; the relay never throws into eve's turn. */
  readonly report: (message: string) => void;
}

/** The plan's turn origin for each kind of turn a request opens, as the queued row records it. */
const TURN_ORIGIN_OF_HOST_TURN = {
  [BRAIN_HOST_TURN.TYPED]: TURN_ORIGIN.TYPED,
  [BRAIN_HOST_TURN.SPOKEN]: TURN_ORIGIN.SPOKEN,
  [BRAIN_HOST_TURN.OBSERVATION]: TURN_ORIGIN.ROSTER_DIFF,
  [BRAIN_HOST_TURN.HOLD_RELEASE]: TURN_ORIGIN.HOLD_RELEASE,
} as const satisfies Record<BrainHostTurn, TurnOrigin>;

const TOOL_CALL_KIND = "tool-call";
const TOOL_RESULT_KIND = "tool-result";
const EVE_ACTION_COMPLETED = "completed";

/** The status word a tool's own output carries, when it is a record with one. */
function statusWordOf(output: UnparsedWireValue): string | undefined {
  return isRecord(output) && isWireString(output.status) ? output.status : undefined;
}

function withTurn(
  state: RelayState,
  eveTurnId: string,
  next: (turn: RelayTurnState) => RelayTurnState,
): RelayState {
  const turn = state.turns[eveTurnId];
  if (!turn) return state;
  return { turns: { ...state.turns, [eveTurnId]: next(turn) } };
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
  async handle(event: MessageStreamEvent, standing: RelayStanding): Promise<void> {
    switch (event.type) {
      case "turn.started":
        return this.#turnStarted(event.data.turnId, event.meta.deliveryIds ?? [], standing);
      case "message.received":
        return this.#received(event.data.turnId, event.data.message, standing);
      case "step.started":
        return this.#stepStarted(event.data.turnId, event.data.stepIndex, standing);
      case "actions.requested":
        for (const action of event.data.actions) {
          if (action.kind !== TOOL_CALL_KIND) continue;
          await this.#toolCall(
            event.data.turnId,
            event.data.stepIndex,
            action.callId,
            action.toolName,
            unparsedWire(action.input),
            standing,
          );
        }
        return;
      case "action.result": {
        const result = event.data.result;
        if (result.kind !== TOOL_RESULT_KIND) return;
        return this.#toolResult(
          event.data.turnId,
          result.callId,
          result.toolName,
          settlementOf(
            event.data.status,
            result.isError,
            unparsedWire(result.output),
            event.data.error?.message,
          ),
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
      case "message.completed":
        if (event.data.message === null) return;
        standing.state.update((state) =>
          withTurn(state, event.data.turnId, (turn) =>
            withPart(turn, event.data.stepIndex, { kind: "text", text: event.data.message ?? "" }),
          ),
        );
        return;
      case "step.completed": {
        const usage = event.data.usage;
        if (!usage) return;
        standing.state.update((state) =>
          withTurn(state, event.data.turnId, (turn) => ({
            ...turn,
            usageBySteps: {
              ...turn.usageBySteps,
              [String(event.data.stepIndex)]: addModelUsage(undefined, {
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
        );
        return;
      }
      case "turn.completed":
        return this.#turnEnded(event.data.turnId, BRAIN_REQUEST_STATUS.SUCCEEDED, standing);
      case "turn.failed":
        return this.#turnEnded(event.data.turnId, BRAIN_REQUEST_STATUS.FAILED, standing);
      case "turn.cancelled":
        return this.#turnEnded(event.data.turnId, BRAIN_REQUEST_STATUS.CANCELLED, standing);
      default:
        return;
    }
  }

  async #turnStarted(
    eveTurnId: string,
    deliveryIds: readonly string[],
    standing: RelayStanding,
  ): Promise<void> {
    // A start eve emits again finds its turn already under way and leaves what it accumulated standing.
    if (standing.state.get().turns[eveTurnId]) return;
    const kind = standing.turn;
    if (kind === undefined) {
      this.#seams.report(
        `Turn ${eveTurnId} of session ${standing.sessionId} named no kind of turn and is not recorded.`,
      );
      return;
    }
    standing.state.update((state) => ({
      turns: { ...state.turns, [eveTurnId]: { kind, sequence: 0, steps: {}, usageBySteps: {} } },
    }));
    const { origin, trigger } = BRAIN_HOST_TURN_KIND[kind];
    // The turn row is queued ahead of its start with what it will run under,
    // which is how the row comes to name eve's resolved model; the start
    // then only moves it to running. A start the record does not come to
    // hold, refused or thrown, keeps nothing in relay state, so the start eve
    // emits again queues the row again rather than finding a turn under way.
    try {
      const turnId = hostTurnId(standing.sessionId, eveTurnId);
      const queued = await this.#seams.writer.enqueueTurn(standing.target, {
        turnId,
        origin: TURN_ORIGIN_OF_HOST_TURN[kind],
        ...(standing.model !== undefined ? { model: standing.model } : undefined),
        ...(standing.promptHash !== undefined ? { promptHash: standing.promptHash } : undefined),
        ...(standing.toolSetHash !== undefined ? { toolSetHash: standing.toolSetHash } : undefined),
      });
      if (!queued.ok) {
        this.#seams.report(`The store refused to queue turn ${eveTurnId}: ${queued.refusal}.`);
        standing.state.update((state) => this.#without(state, eveTurnId));
        return;
      }
      // eve folds the asks that waited into one turn and stamps their deliveries on its events,
      // so the start is where each ask learns the turn it ran in; a start emitted again names
      // the same deliveries and binds nothing new.
      await this.#seams.asks.bindDeliveries(standing.target, deliveryIds, turnId);
      const written = await this.#tell(eveTurnId, standing, {
        kind: BRAIN_RUN_EVENT.TURN_STARTED,
        origin,
        trigger,
        at: this.#seams.now(),
      });
      if (!written) standing.state.update((state) => this.#without(state, eveTurnId));
    } catch (error) {
      standing.state.update((state) => this.#without(state, eveTurnId));
      throw error;
    }
  }

  #without(state: RelayState, eveTurnId: string): RelayState {
    const { [eveTurnId]: _dropped, ...rest } = state.turns;
    return { turns: rest };
  }

  async #received(eveTurnId: string, text: string, standing: RelayStanding): Promise<void> {
    const turn = standing.state.get().turns[eveTurnId];
    if (!turn) return;
    const { trigger } = BRAIN_HOST_TURN_KIND[turn.kind];
    const written = await this.#tell(eveTurnId, standing, {
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: userMessage(
        receivedMessageId(standing.sessionId, eveTurnId),
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
  }

  /** A step opens once: a start eve re-emits finds its step held and tells nothing again. */
  async #stepStarted(eveTurnId: string, stepIndex: number, standing: RelayStanding): Promise<void> {
    const turn = standing.state.get().turns[eveTurnId];
    if (!turn) return;
    const key = String(stepIndex);
    if (turn.steps[key] !== undefined) return;
    const written = await this.#tell(eveTurnId, standing, {
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
  }

  async #toolCall(
    eveTurnId: string,
    stepIndex: number,
    callId: string,
    name: string,
    input: UnparsedWireValue,
    standing: RelayStanding,
  ): Promise<void> {
    const turn = standing.state.get().turns[eveTurnId];
    if (!turn) return;
    if (
      Object.values(turn.steps).some((step) =>
        step.parts.some((part) => part.kind === "tool" && part.callId === callId),
      )
    ) {
      return;
    }
    const written = await this.#tell(eveTurnId, standing, {
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
  }

  async #toolResult(
    eveTurnId: string,
    callId: string,
    name: string,
    settlement: ToolCallSettlement,
    standing: RelayStanding,
  ): Promise<void> {
    const turn = standing.state.get().turns[eveTurnId];
    if (!turn) return;
    // A result eve emits again finds its call already settled and does nothing more, offer included.
    if (
      Object.values(turn.steps).some((step) =>
        step.parts.some(
          (part) => part.kind === "tool" && part.callId === callId && part.settlement !== undefined,
        ),
      )
    ) {
      return;
    }
    const written = await this.#tell(eveTurnId, standing, {
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
    // A briefing is on offer the moment its call is settled on the record:
    // the relay has just written the part the words ride on, so the offer
    // cannot race the journal the way a lookup from inside the tool would.
    if (
      name === BRAIN_TOOL.ANNOUNCE &&
      settlement.state === TOOL_CALL_SETTLEMENT.OUTPUT_AVAILABLE &&
      settlement.status === ACTION_RESULT_STATUS.ACCEPTED
    ) {
      const offered = await this.#seams.offer(
        standing.target,
        hostTurnId(standing.sessionId, eveTurnId),
      );
      if (!offered) {
        this.#seams.report(`The briefing of turn ${eveTurnId} could not be put on offer.`);
      }
    }
  }

  async #reasoning(
    eveTurnId: string,
    stepIndex: number,
    text: string,
    standing: RelayStanding,
  ): Promise<void> {
    const turn = standing.state.get().turns[eveTurnId];
    if (!turn) return;
    const held = turn.steps[String(stepIndex)]?.parts ?? [];
    if (held.some((part) => part.kind === "reasoning" && part.text === text)) return;
    const ordinal = held.filter((part) => part.kind === "reasoning").length;
    const id = reasoningItemId(standing.sessionId, eveTurnId, stepIndex, ordinal);
    const written = await this.#tell(eveTurnId, standing, {
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
  }

  async #turnEnded(
    eveTurnId: string,
    ended: BrainRequestStatus,
    standing: RelayStanding,
  ): Promise<void> {
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
                { callId: part.callId, name: part.name, argumentsJson: JSON.stringify(part.input) },
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
      const answered = await this.#tell(eveTurnId, standing, {
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
    const sealed = await this.#tell(eveTurnId, standing, {
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status,
      ...(failure !== undefined ? { failure } : undefined),
      ...(usage !== undefined ? { usage } : undefined),
      responseIds: [],
      at: this.#seams.now(),
    });
    // A turn end the store refused leaves the turn standing in relay state:
    // its row is still running, and the boundary eve re-emits is the retry
    // that settles it, which a dropped turn would answer with nothing.
    if (!sealed) return;
    standing.state.update((state) => this.#without(state, eveTurnId));
  }

  /** Stamps one event with the conversation, the turn's store id, and the next sequence number, and hands it to the writer; answers whether the writer took it. */
  async #tell(
    eveTurnId: string,
    standing: RelayStanding,
    body: BrainRunEventBody,
  ): Promise<boolean> {
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
    const written = await this.#seams.writer.consume(standing.target, event);
    if (!written.ok) {
      this.#seams.report(
        `The store refused a ${event.kind} event of turn ${event.turnId}: ${written.refusal}.`,
      );
    }
    return written.ok;
  }
}
