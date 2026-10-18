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
import { useAct } from "../act";
import type { ViewedMarks } from "./changes-list";
import { noteOf, type WriteNote } from "./pull-request-writes";

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
 * are folded into the last of them, sent once the one out is answered, and
 * a file's mark is taken from GitHub's answer only once its last press is.
 * Where GitHub would not take a press, the mark goes back to what GitHub
 * last said and the line under the bar says why, as any other change's does
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

/** A file's marks still to settle: the mark its last press asks for, and the doors told once it settles. */
interface Pressing {
  readonly wanted: boolean;
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
  const [states, setStates] = useState<ReadonlyMap<string, FileViewedState> | undefined>();
  const [pressed, setPressed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  const latest = useRef({ read });
  latest.current = { read };
  // Note that the presses still to settle, and how far each file's marks have settled, are held in refs, because an answer reads them as they are when it lands.
  const pressing = useRef(new Map<string, Pressing>());
  const settled = useRef({ count: 0, at: new Map<string, number>() });

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

  // Sends the file's last press, and once GitHub answers, the next where one came meanwhile, else settles the file.
  const send = useCallback(
    (path: string, wanted: boolean) => {
      const action = wanted
        ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
        : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED;
      void act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, { agentId, request: { action, path } })
        .catch(
          (): CodingAgentPullRequestWriteAnswerView => ({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          const now = pressing.current.get(path);
          if (now === undefined) return;
          if (took(answer) && now.wanted !== wanted) return send(path, now.wanted);
          pressing.current.delete(path);
          settled.current.count += 1;
          settled.current.at.set(path, settled.current.count);
          if (took(answer)) {
            const state = wanted ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED;
            setStates((was) => (was === undefined ? was : new Map(was).set(path, state)));
          } else {
            setNote(noteOf(answer));
          }
          setPressed((was) => {
            const next = new Map(was);
            next.delete(path);
            return next;
          });
          for (const tell of now.told) tell(took(answer));
        });
    },
    [act, agentId],
  );

  const toggle = useCallback(
    (path: string) => {
      const settles = Promise.withResolvers<boolean>();
      const wanted = !viewed(path);
      const out = pressing.current.get(path);
      pressing.current.set(path, { wanted, told: [...(out?.told ?? []), settles.resolve] });
      setPressed((was) => new Map(was).set(path, wanted));
      setNote(undefined);
      if (out === undefined) send(path, wanted);
      return settles.promise;
    },
    [viewed, send],
  );

  const dismiss = useCallback(() => setNote(undefined), []);
  const marks = useMemo(
    () => (states === undefined ? undefined : { viewed, toggle }),
    [states, viewed, toggle],
  );
  return { marks, note, dismiss };
}
