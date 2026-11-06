import {
  AGENT_CALL_FAILURE,
  type AgentPullRequestViewedAnswerView,
  type AgentPullRequestWriteAnswerView,
  PULL_REQUEST_PART,
} from "@repo/features/agent-view";
import {
  FILE_VIEWED_STATE,
  type FileViewedState,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@repo/features/pull-request-write-wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pullRequestPartRetryMutation, pullRequestViewedQuery } from "../live-reads.js";
import type { ViewedMarks } from "./changes-list.js";
import { pullRequestAsked } from "./pull-request-number.js";
import type { PullRequestSource } from "./pull-request-source.js";
import { noteOf, type WriteNote } from "./pull-request-writes.js";

export interface ViewedFiles {
  readonly marks: ViewedMarks | undefined;
  readonly note: WriteNote | undefined;
  readonly dismiss: () => void;
}

const UNANSWERED: AgentPullRequestViewedAnswerView = { failure: AGENT_CALL_FAILURE.UNANSWERED };

function readNote(answer: AgentPullRequestViewedAnswerView): WriteNote | undefined {
  if (!("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE)
    return undefined;
  return noteOf(answer);
}

function took(answer: AgentPullRequestWriteAnswerView): boolean {
  return !("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE;
}

interface Pressing {
  readonly wanted: boolean;
  readonly presses: number;
  readonly told: ReadonlyArray<(stood: boolean) => void>;
}

export function useViewedFiles(
  agentId: string,
  source: Pick<PullRequestSource, "number" | "write">,
  reading: number | undefined,
): ViewedFiles {
  const { number, write } = source;
  const held = useQuery(
    pullRequestViewedQuery(reading === undefined ? undefined : pullRequestAsked(agentId, number)),
  );
  const { mutate: retryViewed } = useMutation(pullRequestPartRetryMutation());
  const [states, setStates] = useState<ReadonlyMap<string, FileViewedState> | undefined>();
  const [pressed, setPressed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  const pressing = useRef(new Map<string, Pressing>());
  const settled = useRef({ count: 0, at: new Map<string, number>() });
  const takenAt = useRef(0);
  const sentAt = useRef(new Map<string, number>()).current;

  const readFor = useRef(reading);
  useEffect(() => {
    const was = readFor.current;
    readFor.current = reading;
    if (was !== undefined && reading !== undefined && was !== reading) {
      retryViewed({ part: PULL_REQUEST_PART.VIEWED, ...pullRequestAsked(agentId, number) });
    }
  }, [reading, retryViewed, agentId, number]);

  const answer: AgentPullRequestViewedAnswerView | undefined =
    held.data ?? (held.isError ? UNANSWERED : undefined);
  useEffect(() => {
    if (answer === undefined) return;
    const asked = takenAt.current;
    takenAt.current = settled.current.count;
    setNote(readNote(answer));
    if ("failure" in answer || answer.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) {
      setStates(undefined);
      return;
    }
    const since = (path: string) =>
      (settled.current.at.get(path) ?? 0) > asked || pressing.current.has(path);
    setStates((was) => {
      const next = new Map(answer.files.map((file) => [file.path, file.state]));
      for (const [path, state] of was ?? []) if (since(path)) next.set(path, state);
      return next;
    });
  }, [answer]);

  const viewed = useCallback(
    (path: string) => pressed.get(path) ?? states?.get(path) === FILE_VIEWED_STATE.VIEWED,
    [pressed, states],
  );

  const send = useCallback(
    (path: string, wanted: boolean, confirmed: boolean) => {
      const action = wanted
        ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
        : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED;
      sentAt.set(path, pressing.current.get(path)?.presses ?? 0);
      void write({ action, path })
        .catch(
          (): AgentPullRequestWriteAnswerView => ({
            failure: AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          const now = pressing.current.get(path);
          if (now === undefined) return;
          const sent = sentAt.get(path) ?? 0;
          const word = took(answer) ? wanted : confirmed;
          if (took(answer)) {
            const state = wanted ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED;
            setStates((was) => (was === undefined ? was : new Map(was).set(path, state)));
          }
          if (now.wanted !== word && (now.presses > sent || now.wanted !== wanted)) {
            return send(path, now.wanted, word);
          }
          pressing.current.delete(path);
          settled.current.count += 1;
          settled.current.at.set(path, settled.current.count);
          const stood = now.wanted === word;
          if (!stood) setNote(noteOf(answer));
          setPressed((was) => {
            const next = new Map(was);
            next.delete(path);
            return next;
          });
          for (const tell of now.told) tell(stood);
        });
    },
    [write],
  );

  const toggle = useCallback(
    (path: string) => {
      const settles = Promise.withResolvers<boolean>();
      const wanted = !viewed(path);
      const out = pressing.current.get(path);
      pressing.current.set(path, {
        wanted,
        presses: (out?.presses ?? 0) + 1,
        told: [...(out?.told ?? []), settles.resolve],
      });
      setPressed((was) => new Map(was).set(path, wanted));
      setNote(undefined);
      if (out === undefined) send(path, wanted, states?.get(path) === FILE_VIEWED_STATE.VIEWED);
      return settles.promise;
    },
    [viewed, send, states],
  );

  const dismiss = useCallback(() => setNote(undefined), []);
  const marks = useMemo(
    () => (states === undefined ? undefined : { viewed, toggle }),
    [states, viewed, toggle],
  );
  return { marks, note, dismiss };
}
