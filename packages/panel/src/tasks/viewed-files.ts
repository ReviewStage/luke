import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentPullRequestViewedAnswerView,
  type CodingAgentPullRequestWriteAnswerView,
} from "@luke/features/coding-agent-view";
import {
  FILE_VIEWED_STATE,
  type FileViewedState,
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
} from "@luke/features/pull-request-write-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAct } from "../act.js";
import type { ViewedMarks } from "./changes-list.js";
import { pullRequestAsked, usePullRequestNumber } from "./pull-request-number.js";
import { noteOf, type WriteNote } from "./pull-request-writes.js";

/**
 * viewed-files.ts -- which of an agent's pull request's files the member marked viewed, as GitHub keeps the mark for them alone, read and set from Files changed.
 *
 * The marks are GitHub's own, the ones its Viewed box sets, so they are read
 * and written by the service on the member's own GitHub sign-in and never on
 * the Luke GitHub App (`pull-request-write-wire.ts`): the read
 * (`CODING_AGENTS_PULL_REQUEST_VIEWED`) each time the changes are read, so
 * the two describe the same push, and a mark or an unmark as one of the
 * pull request's changes (`CODING_AGENTS_PULL_REQUEST_ACTION`). A file marked
 * viewed and changed since (GitHub's dismissed) reads as not viewed, as
 * GitHub unticks it.
 *
 * A press is drawn at once. Each file's marks go to GitHub one at a time,
 * so GitHub settles them in the order pressed: presses made while one is out
 * are folded into the last of them, which is sent once the one out is
 * answered, taken or refused, wherever it still differs from what GitHub
 * holds. Every mark GitHub takes is its word on the file at once, so where
 * GitHub would not take the last press, the mark goes back to what GitHub
 * holds and the line under the bar says why, as any other change's does
 * (`pull-request-writes.tsx`). A read never undoes a mark settled or pressed
 * since it was asked; a read that does not answer takes the marks away
 * rather than leave ones it can no longer vouch for, until one answers.
 */

/** The member's viewed marks: the marks, once read, what the last read or press left to say, and the door that lets it go. */
export interface ViewedFiles {
  /** The marks and the door that sets one; none until they are read, or since a read did not answer. */
  readonly marks: ViewedMarks | undefined;
  readonly note: WriteNote | undefined;
  readonly dismiss: () => void;
}

/** What a read of the marks leaves to say, as a change's answer would. */
function readNote(answer: CodingAgentPullRequestViewedAnswerView): WriteNote | undefined {
  if (!("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE)
    return undefined;
  return noteOf(answer);
}

/** Whether a change's answer is GitHub having made it. */
function took(answer: CodingAgentPullRequestWriteAnswerView): boolean {
  return !("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE;
}

/** A file's marks still to settle: the mark its last press asks for, how many presses there were, and the doors told once it settles. */
interface Pressing {
  readonly wanted: boolean;
  readonly presses: number;
  readonly told: ReadonlyArray<(stood: boolean) => void>;
}

/**
 * The member's marks on the agent's pull request's files, read anew each
 * time `reading` counts another answer of the changes read, and marked or
 * unmarked a file at a time, several files at once.
 */
export function useViewedFiles(
  agentId: string,
  read: (agentId: string) => Promise<CodingAgentPullRequestViewedAnswerView>,
  /** How many answers the changes read has landed with, a pull request named in the latest; none while none is. */
  reading: number | undefined,
): ViewedFiles {
  const { act } = useAct();
  const number = usePullRequestNumber();
  const [states, setStates] = useState<ReadonlyMap<string, FileViewedState> | undefined>();
  const [pressed, setPressed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  const latest = useRef({ read });
  latest.current = { read };
  // Note that the presses still to settle, and how far each file's marks have settled, are held in refs, because an answer reads them as they are when it lands.
  const pressing = useRef(new Map<string, Pressing>());
  const settled = useRef({ count: 0, at: new Map<string, number>() });
  // How many of a file's presses there had been when its mark out now was sent.
  const sentAt = useRef(new Map<string, number>()).current;

  useEffect(() => {
    if (reading === undefined) return undefined;
    let standing = true;
    const asked = settled.current.count;
    latest.current
      .read(agentId)
      .catch(
        (): CodingAgentPullRequestViewedAnswerView => ({
          failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
        }),
      )
      .then((answer) => {
        if (!standing) return;
        setNote(readNote(answer));
        if ("failure" in answer || answer.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) {
          return setStates(undefined);
        }
        // A file settled or pressed since the read was asked keeps the mark it has now.
        const since = (path: string) =>
          (settled.current.at.get(path) ?? 0) > asked || pressing.current.has(path);
        setStates((was) => {
          const next = new Map(answer.files.map((file) => [file.path, file.state]));
          for (const [path, state] of was ?? []) if (since(path)) next.set(path, state);
          return next;
        });
      });
    return () => {
      standing = false;
    };
  }, [agentId, reading]);

  const viewed = useCallback(
    (path: string) => pressed.get(path) ?? states?.get(path) === FILE_VIEWED_STATE.VIEWED,
    [pressed, states],
  );

  // Sends one mark for the file, GitHub's last word on it being `confirmed`, and once GitHub answers, sends the last press where it still differs from GitHub's word, else settles the file.
  const send = useCallback(
    (path: string, wanted: boolean, confirmed: boolean) => {
      const action = wanted
        ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
        : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED;
      sentAt.set(path, pressing.current.get(path)?.presses ?? 0);
      void act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, {
        ...pullRequestAsked(agentId, number),
        request: { action, path },
      })
        .catch(
          (): CodingAgentPullRequestWriteAnswerView => ({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          const now = pressing.current.get(path);
          if (now === undefined) return;
          const sent = sentAt.get(path) ?? 0;
          // Every mark GitHub took is GitHub's word at once, so a later refusal shows what GitHub holds.
          const word = took(answer) ? wanted : confirmed;
          if (took(answer)) {
            const state = wanted ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED;
            setStates((was) => (was === undefined ? was : new Map(was).set(path, state)));
          }
          // A press made since this one was sent is sent, where GitHub does not yet hold what it asks, whatever became of this one.
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
    [act, agentId, number],
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
