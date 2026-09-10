import { CONVERSATION_ENTRY_KIND } from "@sidecar/session";
import type { LiveCaptionRow } from "@sidecar/voice/orchestrator";

/**
 * Whether Luke has spoken and then gone quiet, read from the caption rows the
 * live call groups from the transcript ledger: a row of his settles once no
 * fragment has joined it for the utterance gap plus the settle margin, and
 * the guide forbids reading silence from a missing event, so the rows'
 * settling and the remote track's own level are the whole of the evidence.
 * Nothing said yet is not quiet: a greeting that has not begun is waited for.
 */
export function lukeOutputQuiet(rows: readonly LiveCaptionRow[], speaking: boolean): boolean {
  if (speaking) return false;
  const spoken = rows.filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.REPLY);
  return spoken.length > 0 && spoken.every((row) => row.settled);
}

/** Luke's latest words, for the caption forced on into a silent output. */
export function lukeCaption(rows: readonly LiveCaptionRow[]): string | undefined {
  const spoken = rows.filter((row) => row.entry.kind === CONVERSATION_ENTRY_KIND.REPLY);
  return spoken[spoken.length - 1]?.entry.words;
}
