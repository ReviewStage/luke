import type { BrainWakeEvent } from "../../core.js";
import { wakeInputText } from "../../core.js";
import { decodeRosterDiff } from "../roster-diff.js";
import type { HostedStore } from "../store/index.js";
import type { HostedRoster } from "./roster.js";
import type { HostedTranscriptReads } from "./transcript.js";
import { type DatedRosterDiff, wakeEventsFromDiffs } from "./wake-events.js";

/**
 * What an observation turn opens with, composed by the host and never by a
 * model: the pending roster diffs the scheduled pass left, each session they
 * named as the snapshot now holds it, and for every live cloud chat among
 * them the transcript it gained since the host last looked, read from its
 * cursor. The words are the same `[observed events]` item the desktop's
 * brain opens its observation turns with, so the prompt reads one shape
 * wherever the brain runs. The diffs are consumed and the transcript
 * bookmarks advanced only once the turn that carries them is accepted, so a
 * wake the runtime refused is looked at again, words and all.
 */

export interface ObservationTurnInput {
  readonly store: Pick<HostedStore, "roster">;
  readonly userId: string;
  readonly roster: HostedRoster;
  readonly transcripts: Pick<HostedTranscriptReads, "since" | "keep">;
  readonly now: () => number;
}

export interface ObservationTurnWords {
  /** The turn's opening words, marked as data. */
  readonly words: string;
  readonly events: readonly BrainWakeEvent[];
  /** Marks the diffs the words carried as consumed and keeps the transcript bookmarks they reached; called once the runtime has accepted the turn. */
  consume(): Promise<void>;
}

/** The pending diffs decoded and dated; a payload this build cannot read is skipped, never guessed at. */
async function pendingDatedDiffs(
  store: Pick<HostedStore, "roster">,
  userId: string,
): Promise<readonly (DatedRosterDiff & { readonly id: string })[]> {
  const pending = await store.roster.pendingDiffs(userId);
  return pending.flatMap((record) => {
    const diff = decodeRosterDiff(record.payload);
    return diff ? [{ id: record.id, diff, observedAt: record.observedAt }] : [];
  });
}

/** The words for the diffs standing now, or nothing when no diff waits and no turn should open. */
export async function observationTurnWords(
  input: ObservationTurnInput,
): Promise<ObservationTurnWords | undefined> {
  const dated = await pendingDatedDiffs(input.store, input.userId);
  if (dated.length === 0) return undefined;
  const wakes = wakeEventsFromDiffs(dated, input.roster);
  const cursors: { identity: BrainWakeEvent["identity"]; cursor: string }[] = [];
  // One chat's transcript is read once however many diffs named it, and the
  // words ride on its first wake alone, so a chat that changed twice between
  // looks is not heard saying the same thing twice.
  const readIdentities = new Set<string>();
  const events: BrainWakeEvent[] = [];
  for (const event of wakes) {
    const key = JSON.stringify([event.identity.providerId, event.identity.providerSessionId]);
    if (readIdentities.has(key)) {
      events.push(event);
      continue;
    }
    readIdentities.add(key);
    const reading = await input.transcripts.since(event.identity);
    if (reading === undefined) {
      events.push(event);
      continue;
    }
    if (reading.cursor !== undefined) {
      cursors.push({ identity: event.identity, cursor: reading.cursor });
    }
    events.push({ ...event, transcriptDelta: reading.delta });
  }
  return {
    words: wakeInputText(events, input.now()),
    events,
    // The bookmarks first, the diffs after: a failure between the two leaves
    // the diffs pending, and the wake they open again reads nothing new,
    // rather than leaving words read once and never offered again.
    consume: async () => {
      for (const { identity, cursor } of cursors) await input.transcripts.keep(identity, cursor);
      for (const record of dated) {
        await input.store.roster.consumeDiff(input.userId, record.id, input.now());
      }
    },
  };
}
