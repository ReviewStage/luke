import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@repo/features/pull-request-chapters-view";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { pullRequestChaptersQuery, pullRequestChaptersRetryMutation } from "../live-reads.js";
import type { PullRequestSource } from "./pull-request-source.js";

const UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

export interface ChaptersHeld {
  readonly number: number;
  readonly head: string | undefined;
}

export interface ChaptersRead {
  readonly answer: PullRequestChaptersAnswerView | undefined;
  readonly head: string | undefined;
  readonly retry: () => void;
  readonly generate: () => void;
  readonly generating: number | undefined;
}

export function useChaptersRead(
  agentId: string,
  source: PullRequestSource,
  shown: boolean,
  held: ChaptersHeld | undefined,
  refresh: () => void,
): ChaptersRead {
  const number = shown ? held?.number : undefined;
  const read = useQuery(
    pullRequestChaptersQuery(number === undefined ? undefined : { agentId, number }),
  );
  const { mutate: retryChapters } = useMutation(pullRequestChaptersRetryMutation());
  const retry = useCallback(() => {
    if (number !== undefined) retryChapters({ agentId, number });
  }, [retryChapters, agentId, number]);
  const readAnswer: PullRequestChaptersAnswerView | undefined = read.isError
    ? UNANSWERED
    : read.data;
  const [generated, setGenerated] = useState<
    { readonly of: unknown; readonly answer: PullRequestChaptersAnswerView } | undefined
  >(undefined);
  const [generating, setGenerating] = useState<number | undefined>(undefined);
  const latest = useRef({ source, readAnswer, refresh });
  latest.current = { source, readAnswer, refresh };
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
  return { answer, head: held?.head, retry, generate, generating };
}
