/**
 * queued-writes.ts -- a keyed row write that went untaken, as the sync engine takes it: refused, left standing to wait while unanswered, or settled where the service took it already under its key.
 *
 * The row writes that may wait for the service (`WriteDeclaration.queue`
 * on each: a task's rename, standing, and pin, a repository's pin, a
 * section write, an agent's rename and pin, and an inbox item's read mark,
 * snooze, nod, and close, and every item marked read) ask nothing, reach
 * no outside service, and change only rows the pool holds; a nod or a
 * close on an item its agent waits on is also handed to that agent, as it
 * is when sent at once. Each is sent under its idempotency key, and reads
 * its client's untaken answer here (`@repo/features/keyed-write`).
 */

import { WRITE_UNTAKEN, type WriteUntaken } from "@repo/features/keyed-write";
import type { Refused, Written } from "@repo/sync";
import { hostMintedId } from "@repo/wire/host-ids";

/** What a write answers its caller whether the service kept it or refused it. */
export interface WriteAnswers<Answer> {
  readonly kept: Answer;
  readonly refused: Answer;
}

/**
 * A keyed write's untaken answer as the engine takes it: one the service
 * took already stands down at once as kept, one unanswered waits, and one
 * refused, or carried by no credential, is taken back.
 */
export function untaken<Change, Answer>(
  failure: WriteUntaken,
  answers: WriteAnswers<Answer>,
): Written<Change, Answer> | Refused<Answer, Change> {
  if (failure === WRITE_UNTAKEN.ALREADY_WRITTEN) {
    return { answer: answers.kept, txid: undefined, settled: true };
  }
  if (failure === WRITE_UNTAKEN.UNANSWERED) return { refused: answers.refused, unanswered: true };
  return { refused: answers.refused };
}

/**
 * The key one of a write's several calls is sent under, where the write
 * goes to the service as several (a drag's section writes): a name-based id
 * of the write's own key and the call's place, so each call sent again
 * lands once and no two share a key.
 */
export function callKey(key: string | undefined, call: number): string | undefined {
  return key === undefined ? undefined : hostMintedId([key, String(call)]);
}

/** How many changes made offline the service refused as they were sent again, since the windows last cleared the count. */
export interface OfflineRefused {
  /** One more refused. */
  readonly raise: () => void;
  /** None refused, as the windows saw them or a sign-out let them go. */
  readonly clear: () => void;
}

/** The count, none to start with, each move told through `tell` as the whole count. */
export function offlineRefusedCount(tell: (count: number) => void): OfflineRefused {
  let count = 0;
  return {
    raise: () => {
      count += 1;
      tell(count);
    },
    clear: () => {
      if (count === 0) return;
      count = 0;
      tell(count);
    },
  };
}
