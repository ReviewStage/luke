import {
  TRANSCRIPT_SPEAKER,
  TranscriptLedger,
  type TranscriptSpeaker,
  UTTERANCE_GAP_MS,
  UTTERANCE_SETTLE_MARGIN_MS,
} from "@sidecar/live";
import { CONVERSATION_ENTRY_KIND, streamingConversationEntry } from "@sidecar/session";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";

const ENTRY_KIND_OF = {
  [TRANSCRIPT_SPEAKER.USER]: CONVERSATION_ENTRY_KIND.ASK,
  [TRANSCRIPT_SPEAKER.ASSISTANT]: CONVERSATION_ENTRY_KIND.REPLY,
} as const satisfies Record<TranscriptSpeaker, string>;

export interface LiveCaptionsOptions {
  onRows(rows: readonly LiveCaptionRow[]): void;
  now?: () => number;
}

/**
 * Both speakers' words as the transcript deltas carry them, grouped by the
 * ledger the host keeps too, so the captions and the record agree on what
 * an utterance is. Each fragment is appended verbatim, overlap between the
 * speakers is allowed, and a row's id is stable from the moment it opens, so
 * a late fragment grows a row in place rather than moving it. A row settles
 * once no fragment has joined it for the gap plus the margin, measured on
 * this window's clock rather than the session's, since a fragment's arrival
 * is what the drawing follows.
 */
export class LiveCaptions {
  readonly #options: LiveCaptionsOptions;
  readonly #ledger = new TranscriptLedger();
  readonly #lastArrivalByRow = new Map<number, number>();

  constructor(options: LiveCaptionsOptions) {
    this.#options = options;
  }

  append(speaker: TranscriptSpeaker, delta: string, startMs: number, endMs: number): void {
    const utterance = this.#ledger.append({ speaker, text: delta, startMs, endMs });
    if (!utterance) return;
    this.#lastArrivalByRow.set(utterance.rowId, this.#now());
    this.#options.onRows(this.rows());
  }

  /** Re-reads which rows have settled since the last fragment; called on a clock the caller owns. */
  tick(): void {
    this.#options.onRows(this.rows());
  }

  rows(): readonly LiveCaptionRow[] {
    const now = this.#now();
    const rows: LiveCaptionRow[] = [];
    for (const utterance of this.#ledger.captionLines()) {
      const entry = streamingConversationEntry(ENTRY_KIND_OF[utterance.speaker], utterance.text);
      if (!entry) continue;
      const arrivedAt = this.#lastArrivalByRow.get(utterance.rowId) ?? now;
      rows.push({
        rowId: utterance.rowId,
        entry,
        settled: now - arrivedAt >= UTTERANCE_GAP_MS + UTTERANCE_SETTLE_MARGIN_MS,
      });
    }
    return rows;
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }
}
