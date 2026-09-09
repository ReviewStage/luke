import type { ReplyKind } from "@sidecar/voice/orchestrator";

export interface CaptionStripOptions {
  /**
   * The words Luke is currently speaking, growing as they are generated, or
   * undefined once there is nothing being spoken. Each entry is one response's
   * words. `runId` names the brain run whose end the words are voicing, when
   * they are one, so a caller drawing the words can tell a reply the thread
   * already holds from one it is still owed.
   */
  onCaption(
    texts: readonly string[] | undefined,
    kind: ReplyKind | undefined,
    runId?: string,
  ): void;
  /**
   * The words a reply leaves behind at the moment it ends — finished, talked
   * over, or the call closing under it, whichever came.
   */
  onReplyEnded?(texts: readonly string[], kind: ReplyKind | undefined, runId?: string): void;
}

/**
 * The words of one reply as far as they have arrived, and whose they are.
 *
 * Owned by the call rather than by the caller so that every path which ends a
 * reply — finishing, being talked over, the call dropping — lets the words go
 * with it, and a caption can never outlive the speech it captions. The strip
 * is also where those words are handed over for Conversation, at the one moment
 * they are both final and still known.
 */
export class CaptionStrip {
  readonly #options: CaptionStripOptions;
  /**
   * One segment per output item, oldest first, each remembering which item
   * spoke it. A turn that speaks twice back-to-back — a second message item,
   * or the follow-up after a tool call — starts a new segment rather than
   * running its words onto the last one's, and an item's own final transcript
   * can still land on its own segment after the turn has moved on. Every
   * segment stays until the reply ends: the handover to Conversation is owed
   * the whole reply, and how many of them fit under the housing is the
   * surface's question to answer from the room it has, not a count to keep
   * here.
   */
  #segments: { itemId: string | undefined; text: string }[] = [];
  /**
   * Whether the words under way are a briefing or a reply, for Conversation to
   * record as such. Set only when the words were decided by the brain and
   * cleared wherever the words are, so it can never outlive the reply.
   */
  #kind: ReplyKind | undefined;
  /**
   * The brain run whose end the reply under way is voicing, when it is one.
   * Set with the kind and cleared with it, so it is exactly as long-lived as
   * the reply it names and no other reply can inherit it.
   */
  #runId: string | undefined;

  constructor(options: CaptionStripOptions) {
    this.#options = options;
  }

  /** Whether the words under way were the brain's, and so are owed a handover. */
  get kinded(): boolean {
    return this.#kind !== undefined;
  }

  /** Marks whose words the reply under way is speaking, and redraws. */
  mark(kind: ReplyKind | undefined, runId?: string): void {
    this.#kind = kind;
    this.#runId = runId;
    this.#emit();
  }

  /**
   * Grows the caption with the words just generated. The current item's words
   * grow its own segment; an item taking over from another — the reply's
   * second message, or the follow-up after a tool call — starts a segment of
   * its own, so two responses stack instead of running together.
   */
  append(itemId: string | undefined, delta: string): void {
    const last = this.#segments.at(-1);
    if (last && last.itemId === itemId) {
      last.text += delta;
    } else {
      this.#segments.push({ itemId, text: delta });
    }
    this.#emit();
  }

  /**
   * Lands an item's final transcript on the segment its deltas built — even
   * after a later item has taken the turn on, which is what keeps a settled
   * response's words whole while the next one streams under them. A transcript
   * whose item holds no segment is a cancelled reply's straggler, and writes
   * nothing.
   */
  settle(itemId: string | undefined, transcript: string): void {
    const segment = this.#segments.find((candidate) => candidate.itemId === itemId);
    if (!segment || segment.text === transcript) return;
    segment.text = transcript;
    this.#emit();
  }

  /**
   * The reply is over, however it ended: the words are handed over once and
   * then let go. This is the one moment they are both final and still known,
   * so every path that ends a reply passes through here.
   */
  end(): void {
    // The kind is of the reply, so the reply ending takes it too.
    if (this.#segments.length === 0 && this.#kind === undefined) return;
    const texts = this.#texts();
    const kind = this.#kind;
    const runId = this.#runId;
    this.#segments = [];
    this.#kind = undefined;
    this.#runId = undefined;
    // A reply that said nothing leaves no words to hand over — unless it was
    // voicing a run's end, whose ending is owed to the delivery it was granted
    // under however little of it was heard.
    if (texts || runId !== undefined) this.#options.onReplyEnded?.(texts ?? [], kind, runId);
    this.#options.onCaption(undefined, undefined);
  }

  /** Clears an undelivered briefing without admitting it to Conversation. */
  discard(): void {
    this.#segments = [];
    this.#kind = undefined;
    this.#runId = undefined;
    this.#options.onCaption(undefined, undefined);
  }

  /** What the caption currently says, or undefined with nothing to say. */
  #texts(): readonly string[] | undefined {
    if (this.#segments.length === 0) return undefined;
    return this.#segments.map((segment) => segment.text);
  }

  #emit(): void {
    this.#options.onCaption(this.#texts(), this.#kind, this.#runId);
  }
}
