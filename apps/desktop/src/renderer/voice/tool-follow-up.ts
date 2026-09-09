import { isRecord, text, type WireRecord } from "@sidecar/wire";

/**
 * The tool calls one armed reply asked for, and how far answering them has
 * got. Named by the response that asked, because a cancelled reply's calls
 * keep arriving after the turn that replaced it has opened.
 */
interface ToolBatch {
  responseId: string;
  callIds: Set<string>;
  outputCallIds: Set<string>;
  epoch: number;
  responseDone: boolean;
  followUpStarted: boolean;
}

function batchFor(responseId: string, epoch: number): ToolBatch {
  return {
    responseId,
    callIds: new Set<string>(),
    outputCallIds: new Set<string>(),
    epoch,
    responseDone: false,
    followUpStarted: false,
  };
}

export interface ToolFollowUpOptions {
  /** The turn now under way, as the boundary a late answer is checked against. */
  epoch(): number;
  connected(): boolean;
  /** Opens the reply that voices the outcomes, keeping the words already said. */
  openFollowUp(): void;
}

/**
 * The bookkeeping behind a reply that has more to say once its tool calls are
 * answered: which calls one response asked for, which of them have reached the
 * wire, and whether the follow-up voicing their outcomes is still owed.
 *
 * Everything here is keyed by the response that asked and the turn it asked
 * in, because both can be superseded while an answer is still being written.
 * A cancelled reply's late call must not be answered with the new turn's
 * arming, and a follow-up must not open out of a turn the developer has
 * already taken or a silence already declared.
 */
export class ToolFollowUp {
  readonly #options: ToolFollowUpOptions;
  #batch: ToolBatch | undefined;
  #callResponseIds = new Map<string, string>();

  constructor(options: ToolFollowUpOptions) {
    this.#options = options;
  }

  /**
   * Whether a follow-up is owed and not yet opened — so the audio draining is
   * a pause in the turn rather than its ending.
   */
  get holds(): boolean {
    const batch = this.#batch;
    return Boolean(batch?.responseDone && !batch.followUpStarted && batch.callIds.size > 0);
  }

  /** Adopts the reply the server just confirmed as the one whose calls count. */
  opened(responseId: string): void {
    this.#batch = batchFor(responseId, this.#options.epoch());
  }

  /**
   * Reads a raw finished output item for a function call. The parser keeps no
   * call ids off this event, and they are what the SDK's own tool bridge
   * answers by, so the batch learns them here.
   */
  observe(record: WireRecord): void {
    if (record.type !== "response.output_item.done") return;
    const item = isRecord(record.item) ? record.item : undefined;
    if (item?.type !== "function_call") return;
    const responseId = text(record.response_id);
    const callId = text(item.call_id);
    if (!responseId || !callId) return;
    this.#callResponseIds.set(callId, responseId);
    const batch = this.#batch;
    if (batch?.responseId === responseId) batch.callIds.add(callId);
  }

  /**
   * A reply's generation finishing with calls to answer. Reports whether the
   * turn now holds for the follow-up: a reply that is not the current one, or
   * that the server named nothing, resumes nothing and ends as any other.
   */
  done(input: {
    responseId: string | undefined;
    callIds: readonly string[];
    fresh: boolean;
  }): boolean {
    if (!input.fresh || !input.responseId) return false;
    const batch =
      this.#batch?.responseId === input.responseId
        ? this.#batch
        : batchFor(input.responseId, this.#options.epoch());
    this.#batch = batch;
    batch.responseDone = true;
    for (const callId of input.callIds) {
      batch.callIds.add(callId);
      this.#callResponseIds.set(callId, batch.responseId);
    }
    return true;
  }

  /**
   * Whether this call is the current turn's to answer. A cancelled reply's
   * late call — the developer already talked over it — is not, and is refused
   * rather than acted on out of a turn nobody is in.
   */
  current(callId: string): boolean {
    const batch = this.#batchOf(callId);
    return Boolean(batch && batch.epoch === this.#options.epoch() && batch.callIds.has(callId));
  }

  /** The SDK reporting that one call's output reached the wire. */
  outputSent(callId: string): void {
    const batch = this.#batchOf(callId);
    if (!batch?.callIds.has(callId)) return;
    batch.outputCallIds.add(callId);
    this.startIfReady();
  }

  /**
   * Opens the follow-up once every call the reply asked for has been answered
   * on the wire, and only into the turn that asked: a turn the developer took
   * back, or one already declared over, is one Luke must not speak into.
   */
  startIfReady(): void {
    const batch = this.#batch;
    if (
      !batch?.responseDone ||
      batch.followUpStarted ||
      batch.epoch !== this.#options.epoch() ||
      !this.#options.connected() ||
      [...batch.callIds].some((callId) => !batch.outputCallIds.has(callId))
    ) {
      return;
    }
    batch.followUpStarted = true;
    this.#options.openFollowUp();
  }

  /** Spends whatever the turn just crossed left outstanding. */
  reset(): void {
    this.#batch = undefined;
    this.#callResponseIds.clear();
  }

  /** The batch this call belongs to, when it is the one still standing. */
  #batchOf(callId: string): ToolBatch | undefined {
    const responseId = this.#callResponseIds.get(callId);
    return responseId === this.#batch?.responseId ? this.#batch : undefined;
  }
}
