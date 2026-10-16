import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueCreateParams,
  type IssueView,
} from "@luke/features/issue-view";
import type { Issue } from "@luke/features/issue-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act";
import { useMinute } from "../tasks/task-time";

/**
 * use-issues.ts -- the Issues page's list: one workspace's issues, read when the page opens and each minute after, and the write that files one.
 *
 * Nothing is held past the page. The list is read again each minute it
 * stands, so what a teammate filed or moved shows without a press. A write
 * answers the issue as the service then holds it, which takes its place in
 * the list at once, and the list is read again once the write settles, so
 * what changed elsewhere while it was out is not lost to it. A refresh that
 * fails keeps the list it would have replaced; only a first read that fails
 * is said as one. A failure is kept to be said rather than thrown, since
 * every caller does the same with one: says it, and offers to try again.
 */

/** The list as the page draws it: read, failed, or not yet read. */
export type IssuesRead =
  | { readonly issues: readonly Issue[] }
  | { readonly failure: IssueCallFailure }
  | undefined;

const UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

/** One issue put in the place of the one it replaces, or first where it is new, the rest as they stood. */
function replaced(read: IssuesRead, issue: Issue): IssuesRead {
  if (read === undefined || "failure" in read) return read;
  const known = read.issues.some((each) => each.id === issue.id);
  return {
    issues: known
      ? read.issues.map((each) => (each.id === issue.id ? issue : each))
      : [issue, ...read.issues],
  };
}

/** A read held with the workspace it is of, so another workspace's list is never drawn as this one's. */
interface HeldRead {
  readonly workspaceId: string;
  readonly read: IssuesRead;
}

/** One workspace's issues, none asked for while no workspace is listed, with the write that files one. */
export function useIssues(workspaceId: string | undefined) {
  const { act } = useAct();
  const now = useMinute();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that every read and every write moves the generation on, so only
  // the newest read is taken: one asked before a write, or for another
  // workspace, answers nothing over what came after it.
  const generation = useRef(0);
  const reload = useCallback(() => {
    generation.current += 1;
    if (workspaceId === undefined) return;
    const asked = generation.current;
    const taken = (read: IssuesRead) => {
      if (asked !== generation.current) return;
      setHeld((was) =>
        read !== undefined &&
        "failure" in read &&
        was?.workspaceId === workspaceId &&
        was.read !== undefined &&
        "issues" in was.read
          ? was
          : { workspaceId, read },
      );
    };
    act(ACT_KIND.ISSUES_LIST, { workspaceId }).then(taken, () => taken(UNANSWERED));
  }, [act, workspaceId]);
  // Note that a write settles by reading the workspace listed then, through the newest reload.
  const reloadNow = useRef(reload);
  reloadNow.current = reload;
  // Note that the minute is read so the list is read again each minute the page stands.
  useEffect(() => {
    void now;
    reload();
  }, [reload, now]);
  /** A write's answer taken into the list of the workspace it is of, in its place, and into no other's. */
  const landIssue = useCallback((answer: IssueView) => {
    if (!("issue" in answer)) return;
    const { issue } = answer;
    setHeld((was) =>
      was !== undefined && was.workspaceId === issue.workspaceId
        ? { ...was, read: replaced(was.read, issue) }
        : was,
    );
  }, []);
  /** One write out: its answer landed in the list, and the list read again once it settles. */
  const written = useCallback(
    (asked: Promise<IssueView>): Promise<IssueView> => {
      generation.current += 1;
      const settled = (answer: IssueView): IssueView => {
        landIssue(answer);
        reloadNow.current();
        return answer;
      };
      return asked.then(settled, () => settled(UNANSWERED));
    },
    [landIssue],
  );
  const create = useCallback(
    (params: IssueCreateParams) => written(act(ACT_KIND.ISSUES_CREATE, params)),
    [act, written],
  );
  const read = held?.workspaceId === workspaceId ? held?.read : undefined;
  return { read, reload, create };
}
