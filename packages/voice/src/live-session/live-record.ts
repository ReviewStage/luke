import type { TranscriptSpeaker } from "@sidecar/live";
import type { Effect } from "effect";

/**
 * Where what was said on a live session is written down, behind its own door
 * so the writer can change without the service noticing: the hosted record,
 * where the brain's reply is the assistant message, every spoken word is a
 * transcript segment, and each speaker's utterance is a row of its own — the
 * developer's line, and Luke's words wherever they are the voice model's own
 * rather than an append read aloud. A row is upserted as its utterance grows:
 * the service names the row by the id the ledger minted and the span the
 * ledger holds it at, and the record reads the words from the segments over
 * that span, so the writer and not the ledger is the source of the words. A
 * developer utterance the voice model delegated on is also written under its
 * delegation, and what that second write means is the record's to decide.
 */

/** One utterance as the ledger holds it now, for the record to write or grow the row of. */
export interface SpokenRowUpsert {
  /** The ledger's row, minted when the utterance opened: the message's client id for life. */
  rowId: string;
  speaker: TranscriptSpeaker;
  /** The session the words were spoken on, opaque, as the provider named it. */
  voiceSessionId: string;
  startMs: number;
  endMs: number;
}

export interface DeveloperUtteranceRecord {
  /** The ledger's row for the utterance, stable across its fragments, which a record that already holds the row tells this write apart by. */
  rowId: string;
  /** The grouped transcript of one developer utterance, exactly as the ledger concatenated it. */
  text: string;
  /** The session the words were spoken on, opaque, as the provider named it. */
  voiceSessionId: string;
  /** The delegation the utterance fed. */
  delegationId: string;
  /** The span of the session timeline the ask context that fed the brain covered. */
  askContext: { sinceMs: number; untilMs: number } | undefined;
  startMs: number;
  endMs: number;
  /** The brain run the utterance opened, when one was accepted. */
  runId?: string;
}

export interface LiveRecord {
  /** Writes or grows one speaker's row as the ledger holds it; answers whether the record took it. */
  upsertSpokenRow(row: SpokenRowUpsert): Effect.Effect<boolean>;
  /** Writes one developer utterance under the delegation it fed; answers whether the record took it. */
  writeDeveloperUtterance(record: DeveloperUtteranceRecord): Effect.Effect<boolean>;
}
