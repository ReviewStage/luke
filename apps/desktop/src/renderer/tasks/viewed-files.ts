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
 * GitHub unticks it. A press is drawn at once and kept where GitHub took it;
 * where GitHub would not, the mark goes back and the line under the bar says
 * why, as any other change's does (`pull-request-writes.tsx`). Until the
 * marks are read there are none to show or set.
 */

/** The member's viewed marks: the marks, once read, what the last read or press left to say, and the door that lets it go. */
export interface ViewedFiles {
  /** The marks and the door that sets one; none until they are read. */
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

/**
 * The member's marks on the agent's pull request's files, read anew each
 * time `reading` counts another answer of the changes read, and
 * marked or unmarked a file at a time, several at once.
 */
export function useViewedFiles(
  agentId: string,
  read: (agentId: string) => Promise<CodingAgentPullRequestViewedAnswerView>,
  /** How many answers the changes read has landed with, a pull request named in the latest; none while none is. */
  reading: number | undefined,
): ViewedFiles {
  const { act } = useAct();
  const [states, setStates] = useState<ReadonlyMap<string, FileViewedState> | undefined>();
  // The marks pressed and not yet answered, drawn as pressed.
  const [pressed, setPressed] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [note, setNote] = useState<WriteNote | undefined>(undefined);
  const latest = useRef({ read });
  latest.current = { read };

  useEffect(() => {
    if (reading === undefined) return undefined;
    let standing = true;
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
        if ("failure" in answer || answer.outcome !== PULL_REQUEST_WRITE_OUTCOME.DONE) return;
        setStates(new Map(answer.files.map((file) => [file.path, file.state])));
      });
    return () => {
      standing = false;
    };
  }, [agentId, reading]);

  const viewed = useCallback(
    (path: string) => pressed.get(path) ?? states?.get(path) === FILE_VIEWED_STATE.VIEWED,
    [pressed, states],
  );

  const toggle = useCallback(
    (path: string) => {
      const next = !viewed(path);
      setPressed((was) => new Map(was).set(path, next));
      setNote(undefined);
      const action = next
        ? PULL_REQUEST_ACTION.MARK_FILE_VIEWED
        : PULL_REQUEST_ACTION.UNMARK_FILE_VIEWED;
      void act(ACT_KIND.CODING_AGENTS_PULL_REQUEST_ACTION, {
        agentId,
        request: { action, path },
      })
        .catch(
          (): CodingAgentPullRequestWriteAnswerView => ({
            failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
          }),
        )
        .then((answer) => {
          const took = !("failure" in answer) && answer.outcome === PULL_REQUEST_WRITE_OUTCOME.DONE;
          if (took) {
            const state = next ? FILE_VIEWED_STATE.VIEWED : FILE_VIEWED_STATE.UNVIEWED;
            setStates((was) => new Map(was).set(path, state));
          } else {
            setNote(noteOf(answer));
          }
          // Note that the press is let go only where it is still the latest for its file.
          setPressed((was) => {
            if (was.get(path) !== next) return was;
            const after = new Map(was);
            after.delete(path);
            return after;
          });
        });
    },
    [act, agentId, viewed],
  );

  const dismiss = useCallback(() => setNote(undefined), []);
  const marks = useMemo(
    () => (states === undefined ? undefined : { viewed, toggle }),
    [states, viewed, toggle],
  );
  return { marks, note, dismiss };
}
