import { LIVE_READ } from "@repo/features/live-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@repo/features/pull-request-chapters-view";
import { useCallback, useRef, useState } from "react";
import { HOST_READ_STATUS, useHostRead } from "../use-host-read.js";
import type { PullRequestSource } from "./pull-request-source.js";

/**
 * chapters-read.ts -- a pull request's chapters as its Pull request tab holds them: the read the host holds and this window's own Generate.
 *
 * The tab holds them, rather than the Chapters view, so its row says where
 * the chapters stand while the view, a chunk of its own (`agent-chapters-tab.tsx`),
 * is loaded only the first time it is shown.
 */

/** A read that did not answer before it ever had, drawn as any other failed read. */
const UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

/** The pull request as the tab's own read of it holds it: its number, and its head now where the read says it. */
export interface ChaptersHeld {
  readonly number: number;
  readonly head: string | undefined;
}

/** A pull request's chapters as the Pull request tab holds them: the read, its Try again, and this window's own Generate. */
export interface ChaptersRead {
  readonly answer: PullRequestChaptersAnswerView | undefined;
  /** The head the tab's own read of the pull request holds, where it holds one. */
  readonly head: string | undefined;
  /** Reads them again at once, where the read failed before it ever answered. */
  readonly retry: () => void;
  /** Generates them for the head now; the view stands as generating until it answers. */
  readonly generate: () => void;
  /** When this window's own Generate was pressed, while it is out. */
  readonly generating: number | undefined;
}

/**
 * The agent's pull request's chapters, held while the Pull request tab is
 * shown once its own read of the pull request has found one, by the number
 * it found, so their tab says where they stand. The host follows them over
 * the service's live read (`useHostRead`), so any member's claim, finish,
 * or failure draws on every open view within a moment, with no Refresh. A
 * Generate reads the whole tab again once it lands, so its files catch up
 * with the head the chapters were told for. A Generate's own answer is
 * drawn as soon as it lands and stands until the held read moves, so the
 * chapters made never give way to what was there before.
 */
export function useChaptersRead(
  agentId: string,
  source: PullRequestSource,
  shown: boolean,
  held: ChaptersHeld | undefined,
  /** Reads the tab again, the chapters' files among them, which a Generate does once it lands, since it tells them for the head GitHub holds then. */
  refresh: () => void,
): ChaptersRead {
  const read = useHostRead(
    LIVE_READ.PULL_REQUEST_CHAPTERS,
    shown && held !== undefined ? { agentId, number: held.number } : undefined,
  );
  const readAnswer: PullRequestChaptersAnswerView | undefined =
    read.status === HOST_READ_STATUS.FAILED ? UNANSWERED : read.rows;
  const [generated, setGenerated] = useState<
    { readonly of: unknown; readonly answer: PullRequestChaptersAnswerView } | undefined
  >(undefined);
  const [generating, setGenerating] = useState<number | undefined>(undefined);
  const latest = useRef({ source, readAnswer, refresh });
  latest.current = { source, readAnswer, refresh };
  // Note that whether a Generate is out is a ref too, because two presses in one frame would both read the state as none.
  const out = useRef(false);
  const generate = useCallback(() => {
    if (out.current) return;
    out.current = true;
    setGenerating(Date.now());
    latest.current.source
      .generateChapters()
      .catch(() => UNANSWERED)
      .then((answer) => {
        out.current = false;
        setGenerating(undefined);
        setGenerated({ of: latest.current.readAnswer, answer });
        latest.current.refresh();
      });
  }, []);
  const answer =
    generated !== undefined && generated.of === readAnswer ? generated.answer : readAnswer;
  return { answer, head: held?.head, retry: read.retry, generate, generating };
}
