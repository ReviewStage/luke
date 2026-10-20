import type {
  TaskIssueChoice,
  TaskIssueLinkView,
  TaskIssueRelation,
} from "@luke/features/task-issue-wire";
import { TASK_CALL_FAILURE } from "@luke/features/tasks-view";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { linkNoteOf } from "./task-issue-links-model.js";

/**
 * use-task-issue-links.ts -- the issues one task links, as its page reads and changes them through the host.
 *
 * The links are read as the page opens a task, and again for another task,
 * each with where its issue stands now, which the service reads live and
 * never keeps; a link made is read again with the rest, so its state is
 * drawn too. A relation changed stands at once and is put back where the
 * service refused it, unless a newer change of the same link went out since,
 * whose answer is the one that stands; an unlink lets the row go once the
 * service answers. What did not land is said in one note, the latest, until
 * the next change; a read that did not land is asked again by `onRetry`.
 */

/** A task's links as its page holds them: none read yet, or those read. */
export interface TaskIssueLinksControl {
  /** The links, oldest first; nothing until the first read answers. */
  readonly links: readonly TaskIssueLinkView[] | undefined;
  /** Why the latest change did not land, or nothing. */
  readonly note: string | undefined;
  /** Whether a link is out, so the picker takes no second one meanwhile. */
  readonly linking: boolean;
  readonly onLink: (issue: TaskIssueChoice) => void;
  readonly onRelate: (linkId: string, relation: TaskIssueRelation) => void;
  readonly onUnlink: (linkId: string) => void;
  /** Reads the links again, as after a read that did not land. */
  readonly onRetry: () => void;
}

/** A refusal the act port answered, in its own sentence (`act.ts` rethrows one as an `Error` carrying it). */
function refusedSentence(refused: Error): string {
  return refused.message === ""
    ? linkNoteOf({ failure: TASK_CALL_FAILURE.UNANSWERED })
    : refused.message;
}

export function useTaskIssueLinks(taskId: string): TaskIssueLinksControl {
  const { act } = useAct();
  const [read, setRead] = useState<{
    readonly taskId: string;
    readonly links: readonly TaskIssueLinkView[];
  }>();
  const [note, setNote] = useState<{ readonly taskId: string; readonly words: string }>();
  const [linking, setLinking] = useState(false);
  const [asked, setAsked] = useState(0);
  // Note that each link's relation changes are counted, so the answer to one
  // a newer change overtook puts nothing back over the newer one.
  const relating = useRef(new Map<string, number>());

  // The links are read for the task, and again after a link is made.
  useEffect(() => {
    let current = true;
    // Note that an answer the hook cannot read is taken as a refusal, so a window whose port answers nothing draws no box.
    act(ACT_KIND.TASK_ISSUES_READ, { taskId })
      .then((answer) => {
        if (!current) return;
        if ("issues" in answer) setRead({ taskId, links: answer.issues });
        else setNote({ taskId, words: linkNoteOf(answer) });
      })
      .catch((refused: Error) => {
        if (current) setNote({ taskId, words: refusedSentence(refused) });
      });
    return () => {
      current = false;
    };
  }, [act, taskId, asked]);

  const say = useCallback(
    (words: string | undefined) => {
      setNote(words === undefined ? undefined : { taskId, words });
    },
    [taskId],
  );

  const replaced = useCallback(
    (change: (links: readonly TaskIssueLinkView[]) => readonly TaskIssueLinkView[]) =>
      setRead((standing) =>
        standing === undefined || standing.taskId !== taskId
          ? standing
          : { taskId, links: change(standing.links) },
      ),
    [taskId],
  );

  const onLink = (issue: TaskIssueChoice) => {
    setLinking(true);
    say(undefined);
    act(ACT_KIND.TASK_ISSUES_LINK, { taskId, issue })
      .then((answer) => {
        if ("issue" in answer) {
          replaced((links) => [...links, answer.issue]);
          setAsked((count) => count + 1);
        } else say(linkNoteOf(answer));
      })
      .catch((refused: Error) => say(refusedSentence(refused)))
      .finally(() => setLinking(false));
  };

  const onRelate = (linkId: string, relation: TaskIssueRelation) => {
    const before = read?.links.find((link) => link.id === linkId)?.relation;
    const relate = (to: TaskIssueRelation) =>
      replaced((links) =>
        links.map((link) => (link.id === linkId ? { ...link, relation: to } : link)),
      );
    const generation = (relating.current.get(linkId) ?? 0) + 1;
    relating.current.set(linkId, generation);
    const newest = () => relating.current.get(linkId) === generation;
    relate(relation);
    say(undefined);
    act(ACT_KIND.TASK_ISSUES_RELATE, { taskId, linkId, relation })
      .then((answer) => {
        if ("issue" in answer || !newest()) return;
        if (before !== undefined) relate(before);
        say(linkNoteOf(answer));
      })
      .catch((refused: Error) => {
        if (!newest()) return;
        if (before !== undefined) relate(before);
        say(refusedSentence(refused));
      });
  };

  const onUnlink = (linkId: string) => {
    say(undefined);
    act(ACT_KIND.TASK_ISSUES_UNLINK, { taskId, linkId })
      .then((answer) => {
        if ("unlinked" in answer) replaced((links) => links.filter((link) => link.id !== linkId));
        else say(linkNoteOf(answer));
      })
      .catch((refused: Error) => say(refusedSentence(refused)));
  };

  return {
    links: read?.taskId === taskId ? read.links : undefined,
    note: note?.taskId === taskId ? note.words : undefined,
    linking,
    onLink,
    onRelate,
    onUnlink,
    onRetry: () => {
      say(undefined);
      setAsked((count) => count + 1);
    },
  };
}
