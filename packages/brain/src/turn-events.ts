import {
  CONTEXT_INPUT_KIND,
  RUNTIME_EVENT,
  type RuntimeEvent,
  type RuntimeRun,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";
import type { UserMessageMetadata } from "@sidecar/wire";
import { valueFromJsonText } from "@sidecar/wire";
import type { BrainRequestFailure, BrainRequestRecord, BrainRequestStatus } from "./requests.js";
import {
  BRAIN_RUN_EVENT,
  type BrainRunEvent,
  type BrainRunEventBody,
  type BrainTurnOrigin,
  type SlowStepKind,
  type TurnCompaction,
  toolCallSettlementOf,
} from "./run-events.js";
import type { BrainTurnTrigger, RunControl } from "./turn.js";
import { AssistantMessageBuilder, userMessage } from "./ui-messages.js";

export interface TurnEventsOptions {
  readonly conversationId: SessionKey;
  readonly turnId: string;
  readonly fire: (event: BrainRunEvent) => void;
  /** Mints the id of each message the turn completes. */
  readonly createMessageId: () => string;
  readonly now: () => number;
  /** Where the runs a turn carries are looked up by id when their records end, so their ends join the turn's sequence. */
  readonly registry?: Map<string, TurnEvents>;
}

/**
 * The one teller of a turn's events. It stamps the conversation, the turn,
 * and the next sequence number on each event and fires it at once, so the
 * order a listener hears is the order the turn told, and it holds the
 * model's answer as the message the turn completes, gathered from the
 * runtime's events part by part until the turn's checkpoint puts it on record.
 */
export class TurnEvents {
  readonly conversationId: SessionKey;
  readonly turnId: string;
  readonly #options: TurnEventsOptions;
  readonly #message = new AssistantMessageBuilder();
  #sequence = 0;
  #steps = 0;
  #opened = false;

  constructor(options: TurnEventsOptions) {
    this.conversationId = options.conversationId;
    this.turnId = options.turnId;
    this.#options = options;
  }

  /** Whether the turn's start was told, so its end is told only for a turn that started. */
  get opened(): boolean {
    return this.#opened;
  }

  /** Names a run whose record ends inside this turn, so that end is numbered in the turn's sequence. */
  adopt(runId: string): void {
    this.#options.registry?.set(runId, this);
  }

  started(origin: BrainTurnOrigin, trigger: BrainTurnTrigger): void {
    this.#opened = true;
    this.#emit({ kind: BRAIN_RUN_EVENT.TURN_STARTED, origin, trigger, at: this.#options.now() });
  }

  /**
   * Words handed to the turn — its opening, or an ask steered in — are a user
   * message, complete as handed over, saying what the vocabulary lets it say
   * about itself.
   */
  words(text: string, metadata: UserMessageMetadata): void {
    this.#emit({
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: userMessage(this.#options.createMessageId(), text, metadata),
    });
  }

  /** The run under way, its steer telling each message the run takes as words of the turn's own kind. */
  relaying(run: RuntimeRun, metadata: UserMessageMetadata): RuntimeRun {
    return {
      runId: run.runId,
      done: run.done,
      cancel: (reason) => run.cancel(reason),
      steer: (input) => {
        const taken = run.steer(input);
        if (taken && input.kind === CONTEXT_INPUT_KIND.USER_TEXT) this.words(input.text, metadata);
        return taken;
      },
    };
  }

  /**
   * What the runtime reports that the record hears: each inference as a step
   * opening, each reasoning item, each call before and after it runs, and the
   * words. The step is told first, so a listener ordering by step rather than
   * arrival — which eve's stream needs, since a step's reasoning reaches it
   * after the step's results — has the boundary before anything it bounds.
   */
  heard(event: RuntimeEvent): void {
    switch (event.kind) {
      case RUNTIME_EVENT.ANSWERED:
        this.#steps += 1;
        this.#message.stepStart();
        this.#emit({ kind: BRAIN_RUN_EVENT.STEP_STARTED, step: this.#steps });
        return;
      case RUNTIME_EVENT.REASONING:
        this.#message.reasoning(event.reasoning);
        this.#emit({
          kind: BRAIN_RUN_EVENT.REASONING_COMPLETED,
          summary: event.reasoning.summary,
          item: event.reasoning.item,
        });
        return;
      case RUNTIME_EVENT.TEXT:
        this.#message.text(event.text);
        return;
      case RUNTIME_EVENT.TOOL_CALL: {
        const input = valueFromJsonText(event.invocation.argumentsJson);
        this.#message.toolCall(event.invocation, input);
        this.#emit({
          kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
          callId: event.invocation.callId,
          name: event.invocation.name,
          input,
        });
        return;
      }
      case RUNTIME_EVENT.TOOL_RESULT: {
        const settlement = toolCallSettlementOf(event.result.outputJson, event.result.status);
        this.#message.toolResult(event.invocation.callId, settlement);
        this.#emit({
          kind: BRAIN_RUN_EVENT.TOOL_CALL_SETTLED,
          callId: event.invocation.callId,
          name: event.invocation.name,
          settlement,
        });
        return;
      }
      default:
        return;
    }
  }

  /** The final answer's words where the runtime's end carried ones its events had not. */
  finalText(text: string): void {
    this.#message.text(text);
  }

  compacted(compaction: TurnCompaction): void {
    this.#emit({ kind: BRAIN_RUN_EVENT.COMPACTION_COMPLETED, compaction });
  }

  /** The model's answer as one message, told once the checkpoint carrying it has landed. */
  answered(): void {
    this.#emit({
      kind: BRAIN_RUN_EVENT.MESSAGE_COMPLETED,
      message: this.#message.finish(this.#options.createMessageId()),
    });
  }

  slowStep(runId: string, step: SlowStepKind): void {
    this.#emit({ kind: BRAIN_RUN_EVENT.SLOW_STEP, runId, step });
  }

  actionsSettled(runId: string): void {
    this.#emit({ kind: BRAIN_RUN_EVENT.ACTIONS_SETTLED, runId });
  }

  replySentence(runId: string, sentence: string): void {
    this.#emit({ kind: BRAIN_RUN_EVENT.REPLY_SENTENCE, runId, sentence });
  }

  /**
   * The turn's end, the last event of every turn: told once every record that
   * rode to the end has ended, with the status the primary record settled on
   * where there is one, and with the run's own accounting.
   */
  ended(
    run: Pick<RunControl, "usage" | "responseIds">,
    status: BrainRequestStatus,
    failure: BrainRequestFailure | undefined,
  ): void {
    this.#emit({
      kind: BRAIN_RUN_EVENT.TURN_ENDED,
      status,
      ...(failure !== undefined ? { failure } : undefined),
      ...(run.usage !== undefined ? { usage: run.usage } : undefined),
      responseIds: [...run.responseIds],
      at: this.#options.now(),
    });
  }

  /** A record's end, exactly as the ledger settled it. */
  recordEnded(record: BrainRequestRecord): void {
    this.#emit({
      kind: BRAIN_RUN_EVENT.ENDED,
      runId: record.runId,
      status: record.status,
      ...(record.text !== undefined ? { text: record.text } : undefined),
      ...(record.failure !== undefined ? { failure: record.failure } : undefined),
      ...(record.usage !== undefined ? { usage: record.usage } : undefined),
      ...(record.responseIds !== undefined ? { responseIds: record.responseIds } : undefined),
    });
  }

  #emit(body: BrainRunEventBody): void {
    this.#sequence += 1;
    this.#options.fire({
      ...body,
      conversationId: this.conversationId,
      turnId: this.turnId,
      sequence: this.#sequence,
    });
  }
}
