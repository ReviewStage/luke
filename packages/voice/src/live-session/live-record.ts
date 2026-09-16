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
 * delegation cuts nothing: the service names the developer's rows the
 * delegation is about, each already written as it stands, and the record
 * gives them the delegation, which is where the ask's turn finds them.
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

/**
 * The developer's rows a delegation is about, for the record to write as
 * they stand and then give the delegation, as one turn at the record: a
 * session closing between the two would otherwise leave a row written and
 * never the delegation's, since a close waits out what the record has
 * started and nothing retries an attach.
 */
export interface SpokenAskAttach {
  /** The delegation the rows fed. */
  delegationId: string;
  /** The session the words were spoken on, opaque, as the provider named it. */
  voiceSessionId: string;
  /** The ledger's rows, oldest first, each as the ledger holds it now. */
  rows: readonly SpokenRowUpsert[];
}

export interface LiveRecord {
  /** Writes or grows one speaker's row as the ledger holds it; answers whether the record took it. */
  upsertSpokenRow(row: SpokenRowUpsert): Effect.Effect<boolean>;
  /** Writes the developer's rows a delegation is about as they stand and gives them the delegation; answers whether the record took them. */
  attachSpokenAsk(attach: SpokenAskAttach): Effect.Effect<boolean>;
}
