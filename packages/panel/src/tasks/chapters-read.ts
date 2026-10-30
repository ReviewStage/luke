import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import { useCallback, useRef, useState } from "react";
import { useAgentRead } from "./agent-changes-tab.js";
import type { PullRequestSource } from "./pull-request-source.js";

/**
 * chapters-read.ts -- a pull request's chapters as its Pull request tab holds them: the read, this window's own Generate, and the count the Chapters tab wears.
 *
 * The tab holds them, rather than the Chapters view, so its row counts the
 * chapters while the view, a chunk of its own (`agent-chapters-tab.tsx`),
 * is loaded only the first time it is shown.
 */

/** A read that threw rather than answered, drawn as any other failed read. */
const UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

/** The pull request as the tab's own read of it holds it: its number, and its head now where the read says it. */
export interface ChaptersHeld {
  readonly number: number;
  readonly head: string | undefined;
}

/** A pull request's chapters as the Pull request tab holds them: the read, its door, and this window's own Generate. */
export interface ChaptersRead {
  readonly answer: PullRequestChaptersAnswerView | undefined;
  /** The head the tab's own read of the pull request holds, where it holds one. */
  readonly head: string | undefined;
  readonly out: boolean;
  readonly ask: () => void;
  /** Generates them for the head now; the view stands as generating until it answers. */
  readonly generate: () => void;
  /** When this window's own Generate was pressed, while it is out. */
  readonly generating: number | undefined;
}

/**
 * The agent's pull request's chapters, read as the Chapters view is first
 * shown, again the moment the agent ends, since its last push is when the
 * head settles (`useAgentRead`), and again after a Generate. A read names the
 * number the tab's own read of the pull request found, so the service
 * answers from what it keeps rather than asking GitHub for the pull request
 * again, and is asked only once that read has found one; a Generate reads
 * the whole tab again once it lands, so its files catch up with the head
 * the chapters were told for. A Generate's own
 * answer is drawn as soon as it lands and stands until the read asked after
 * it does, so the chapters made never give way to what was there before.
 */
export function useChaptersRead(
  agentId: string,
  source: PullRequestSource,
  shown: boolean,
  held: ChaptersHeld | undefined,
  /** Reads the tab again, the chapters and their files among them, which a Generate does once it lands, since it tells them for the head GitHub holds then. */
  refresh: () => void,
): ChaptersRead {
  const read = useAgentRead(
    agentId,
    shown,
    source.ended,
    () => (held === undefined ? Promise.resolve(UNANSWERED) : source.readChapters(held.number)),
    UNANSWERED,
  );
  const [generated, setGenerated] = useState<
    { readonly of: unknown; readonly answer: PullRequestChaptersAnswerView } | undefined
  >(undefined);
  const [generating, setGenerating] = useState<number | undefined>(undefined);
  const latest = useRef({ source, read, refresh });
  latest.current = { source, read, refresh };
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
        setGenerated({ of: latest.current.read.answer, answer });
        latest.current.refresh();
      });
  }, []);
  const answer =
    generated !== undefined && generated.of === read.answer ? generated.answer : read.answer;
  return { answer, head: held?.head, out: read.out, ask: read.ask, generate, generating };
}

/** How many chapters the Chapters tab counts: those ready, stale or not; none before then. */
export function chaptersCount(read: ChaptersRead): number | undefined {
  const { answer } = read;
  if (answer === undefined || "failure" in answer || answer.pullRequest === null) return undefined;
  const { chapters } = answer.pullRequest;
  return chapters.status === PULL_REQUEST_CHAPTERS_STATE.READY
    ? chapters.chapters.length
    : undefined;
}
