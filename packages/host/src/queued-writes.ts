import { WRITE_UNTAKEN, type WriteUntaken } from "@repo/features/keyed-write";
import type { Refused, Written } from "@repo/sync";
import { hostMintedId } from "@repo/wire/host-ids";

export interface WriteAnswers<Answer> {
  readonly kept: Answer;
  readonly refused: Answer;
}

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

export function callKey(key: string | undefined, call: number): string | undefined {
  return key === undefined ? undefined : hostMintedId([key, String(call)]);
}

export interface OfflineRefused {
  readonly raise: () => void;
  readonly clear: () => void;
}

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
