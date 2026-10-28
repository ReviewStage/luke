import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@luke/features/pull-request-chapters-view";
import { PULL_REQUEST_CHAPTERS_STATE } from "@luke/features/pull-request-chapters-wire";
import { useCallback, useRef, useState } from "react";
import { useAgentRead } from "./agent-changes-tab.js";
import { agentStillWriting } from "./coding-agent-model.js";
import { usePullRequestNumber } from "./pull-request-number.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";

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

/** The pull request as the tab's own read of it holds it: its number and its head now. */
export interface ChaptersHeld {
  readonly number: number;
  readonly head: string;
}

/** A pull request's chapters as the Pull request tab holds them: the read, its door, and this window's own Generate. */
export interface ChaptersRead {
  readonly answer: PullRequestChaptersAnswerView | undefined;
  /** The head the chapters are stale against: the one this window's Generate last answered until the tab's own read moves on, else the tab's own, where it holds one, else the answer's. */
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
 * number and the head the tab's own read of the pull request holds, where it
 * holds them, so the service answers from what it keeps rather than asking
 * GitHub for the pull request again. A Generate's own
 * answer is drawn as soon as it lands and stands until the read asked after
 * it does, so the chapters made never give way to what was there before.
 */
export function useChaptersRead(
  agentId: string,
  control: CodingAgentsControl,
  shown: boolean,
  held: ChaptersHeld | undefined,
): ChaptersRead {
  const status = control.agents?.find((each) => each.id === agentId)?.status;
  const ended = !agentStillWriting(status ?? CODING_AGENT_STATUS.RUNNING);
  const number = usePullRequestNumber();
  const read = useAgentRead(
    agentId,
    shown,
    ended,
    (id: string) =>
      held === undefined
        ? control.readChapters(id, number)
        : control.readChapters(id, held.number, held.head),
    UNANSWERED,
  );
  const [generated, setGenerated] = useState<
    { readonly of: unknown; readonly answer: PullRequestChaptersAnswerView } | undefined
  >(undefined);
  const [generating, setGenerating] = useState<number | undefined>(undefined);
  // The head a Generate told the chapters for, and the tab's head it was pressed over, which it stands in for until the tab's own read moves on.
  const [generatedHead, setGeneratedHead] = useState<
    { readonly over: string | undefined; readonly head: string } | undefined
  >(undefined);
  const latest = useRef({ control, number, read, held });
  latest.current = { control, number, read, held };
  // Note that whether a Generate is out is a ref too, because two presses in one frame would both read the state as none.
  const out = useRef(false);
  const generate = useCallback(() => {
    if (out.current) return;
    out.current = true;
    setGenerating(Date.now());
    const { control, number } = latest.current;
    control
      .generateChapters(agentId, number)
      .catch(() => UNANSWERED)
      .then((answer) => {
        out.current = false;
        setGenerating(undefined);
        setGenerated({ of: latest.current.read.answer, answer });
        // Note that GitHub was asked for the head just now, so it is newer than a tab's read from before a push.
        if ("pullRequest" in answer && answer.pullRequest !== null) {
          setGeneratedHead({ over: latest.current.held?.head, head: answer.pullRequest.headSha });
        }
        latest.current.read.ask();
      });
  }, [agentId]);
  const answer =
    generated !== undefined && generated.of === read.answer ? generated.answer : read.answer;
  const head =
    generatedHead !== undefined && generatedHead.over === held?.head
      ? generatedHead.head
      : held?.head;
  return { answer, head, out: read.out, ask: read.ask, generate, generating };
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
