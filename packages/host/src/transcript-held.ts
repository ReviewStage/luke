import type { CodingAgentNewestAnswer } from "@luke/features/coding-agent-wire";
import { Effect, Equal, Option, Ref } from "effect";

/**
 * transcript-held.ts -- the newest window of the transcripts this host followed last, held in this process alone so a transcript opened again draws at once.
 *
 * Each entry is what a follow told of one transcript, as one newest page:
 * the newest page it opened with, every page past it joined on by id, the
 * cursor to follow on from, and where the page older than it is read below.
 * A follow opened again answers it before it asks the service anything,
 * then reads on from its cursor. The entries are the most recently told
 * first, at most `HELD_TRANSCRIPTS` of them and `HELD_BYTES` in all; one
 * that grew past a share of that is let go rather than cut, since a window
 * cut from its oldest end would no longer meet its `before`. Each is held
 * for the account it was read for, and one read for another account is let
 * go as soon as it is asked for or written beside. Nothing here reaches app
 * state, a trace, or a fixture.
 */

/** How many transcripts are held at most, the least recently told let go first. */
export const HELD_TRANSCRIPTS = 8;
/** How many bytes of JSON every transcript held comes to at most. */
export const HELD_BYTES = 4 * 1024 * 1024;
/** How many bytes one transcript held may come to; one past it is let go rather than crowd the rest out. */
const HELD_BYTES_EACH = HELD_BYTES / 4;

interface Entry<Key> {
  readonly key: Key;
  readonly userId: string;
  readonly page: CodingAgentNewestAnswer;
  readonly bytes: number;
}

/** The transcripts held, most recently told first. */
export interface TranscriptHeld<Key> {
  /** The window held of a transcript for the account, which counts as its most recent use; none where none is held for that account. */
  readonly recall: (
    key: Key,
    userId: string,
  ) => Effect.Effect<Option.Option<CodingAgentNewestAnswer>>;
  /** Holds a transcript's window for the account, in place of what was held of it. */
  readonly keep: (key: Key, userId: string, page: CodingAgentNewestAnswer) => Effect.Effect<void>;
  /** Lets go of every transcript held that the predicate names. */
  readonly forget: (which: (key: Key) => boolean) => Effect.Effect<void>;
  /** Lets go of everything held, as a sign-out does. */
  readonly clear: Effect.Effect<void>;
}

const encoder = new TextEncoder();

/** The entries held, bounded to the count and the bytes, the least recent let go first. */
function bounded<Key>(entries: readonly Entry<Key>[]): readonly Entry<Key>[] {
  const kept: Entry<Key>[] = [];
  let bytes = 0;
  for (const entry of entries) {
    if (kept.length >= HELD_TRANSCRIPTS || bytes + entry.bytes > HELD_BYTES) break;
    kept.push(entry);
    bytes += entry.bytes;
  }
  return kept;
}

export function transcriptHeld<Key>(): Effect.Effect<TranscriptHeld<Key>> {
  return Effect.map(Ref.make<readonly Entry<Key>[]>([]), (entries) => ({
    recall: (key, userId) =>
      Ref.modify(entries, (held) => {
        // Note that anything held for another account is let go, so a switch of account never draws the last one's transcripts.
        if (held.some((entry) => entry.userId !== userId)) return [Option.none(), []];
        const found = held.find((entry) => Equal.equals(entry.key, key));
        if (found === undefined) return [Option.none(), held];
        return [Option.some(found.page), [found, ...held.filter((entry) => entry !== found)]];
      }),
    keep: (key, userId, page) =>
      Ref.update(entries, (held) => {
        const others = held.filter(
          (entry) => entry.userId === userId && !Equal.equals(entry.key, key),
        );
        const bytes = encoder.encode(JSON.stringify(page)).byteLength;
        if (bytes > HELD_BYTES_EACH) return others;
        return bounded([{ key, userId, page, bytes }, ...others]);
      }),
    forget: (which) => Ref.update(entries, (held) => held.filter((entry) => !which(entry.key))),
    clear: Ref.set(entries, []),
  }));
}
