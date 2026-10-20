import {
  ISSUE_CALL_FAILURE,
  type IssueCallFailure,
  type IssueChangeParams,
  type IssueCreateParams,
  type IssueFollow,
  type IssueView,
} from "@luke/features/issue-view";
import type { Issue } from "@luke/features/issue-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAct } from "../act.js";
import { appBridge } from "../app-bridge.js";

/**
 * use-issues.ts -- the Issues pages' list and one issue: one workspace's issues, read when the pages open and followed while they stand, one issue read as its page opens, and the writes that file and change them.
 *
 * Nothing is held past the page. The list is followed while it stands: the
 * host pushes it each time it moves (over Neon Realtime), so what a teammate
 * filed or moved shows without a press, and nothing is read on a clock here.
 * A write answers the issue as the service then holds it, which takes its
 * place in the list at once, or leaves it where it was archived; the
 * followed list carries whatever else moved. A push or a read that fails
 * keeps the list it would have replaced; only a first read that fails is
 * said as one. A failure is kept to be said rather than thrown, since every
 * caller does the same with one: says it, and offers to try again.
 */

/** What a change names: any of an issue's fields, and whether it is archived. */
export type IssueChange = IssueChangeParams["change"];

/** One issue as its page draws it: read, failed, or not yet read. */
export type IssueRead = IssueView | undefined;

/** The list as the page draws it: read, failed, or not yet read. */
export type IssuesRead =
  | { readonly issues: readonly Issue[] }
  | { readonly failure: IssueCallFailure }
  | undefined;

const UNANSWERED = { failure: ISSUE_CALL_FAILURE.UNANSWERED } as const;

/** One issue put in the place of the one it replaces, or first where it is new, or taken out where it was archived; the rest as they stood. */
function replaced(read: IssuesRead, issue: Issue): IssuesRead {
  if (read === undefined || "failure" in read) return read;
  if (issue.archivedAt !== null) {
    return { issues: read.issues.filter((each) => each.id !== issue.id) };
  }
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

/** The list taken over the one held: a failure keeps a list of the same workspace already drawn. */
function taken(
  was: HeldRead | undefined,
  workspaceId: string,
  read: IssuesRead,
): HeldRead | undefined {
  return read !== undefined &&
    "failure" in read &&
    was?.workspaceId === workspaceId &&
    was.read !== undefined &&
    "issues" in was.read
    ? was
    : { workspaceId, read };
}

/**
 * The workspace's issues followed for as long as the page stands: the host
 * is asked to follow them and to let them go when it stops, and each push
 * of them is handed to `take`.
 */
function useFollowedIssues(
  workspaceId: string | undefined,
  take: (read: IssuesRead, workspaceId: string) => void,
): void {
  const { act } = useAct();
  // Note that the newest `take` is called, so a page need not hold it still for the follow to stand.
  const taker = useRef(take);
  taker.current = take;
  useEffect(() => {
    if (workspaceId === undefined) return;
    const followed: IssueFollow = { workspaceId };
    const unsubscribe = appBridge().onIssues((changed) => {
      if (changed.workspaceId === workspaceId) taker.current(changed.view, workspaceId);
    });
    act(ACT_KIND.ISSUES_FOLLOW, followed).catch(() => undefined);
    return () => {
      unsubscribe();
      act(ACT_KIND.ISSUES_UNFOLLOW, followed).catch(() => undefined);
    };
  }, [act, workspaceId]);
}

/** One workspace's issues, none asked for while no workspace is listed, with the write that files one. */
export function useIssues(workspaceId: string | undefined) {
  const { act } = useAct();
  const [held, setHeld] = useState<HeldRead | undefined>(undefined);
  // Note that every read and every write moves the generation on, so only
  // the newest read is taken: one asked before a write, or for another
  // workspace, answers nothing over what came after it.
  const generation = useRef(0);
  const reload = useCallback(() => {
    generation.current += 1;
    if (workspaceId === undefined) return;
    const asked = generation.current;
    const answered = (read: IssuesRead) => {
      if (asked === generation.current) setHeld((was) => taken(was, workspaceId, read));
    };
    act(ACT_KIND.ISSUES_LIST, { workspaceId }).then(answered, () => answered(UNANSWERED));
  }, [act, workspaceId]);
  useEffect(reload, [reload]);
  // Note that a list the host pushed is the newest word of it, so it is taken whatever read is out.
  useFollowedIssues(workspaceId, (read, listed) => {
    generation.current += 1;
    setHeld((was) => taken(was, listed, read));
  });
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
  /** One write out: its answer landed in the list, which the followed list then carries on from. */
  const written = useCallback(
    (asked: Promise<IssueView>): Promise<IssueView> => {
      generation.current += 1;
      const settled = (answer: IssueView): IssueView => {
        landIssue(answer);
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
  const change = useCallback(
    (params: IssueChangeParams) => written(act(ACT_KIND.ISSUES_CHANGE, params)),
    [act, written],
  );
  const read = held?.workspaceId === workspaceId ? held?.read : undefined;
  return { read, reload, create, change };
}

/**
 * One issue, read once as its page opens, and its change: sent through the
 * list's own, so the list takes the answer too, and the answer drawn here
 * in its place where the service kept it. Its page draws the followed
 * list's copy where that is newer, which is what keeps it live.
 */
export function useIssue(
  issueId: string,
  changeListed: (params: IssueChangeParams) => Promise<IssueView>,
) {
  const { act } = useAct();
  const [held, setHeld] = useState<{ readonly issueId: string; readonly read: IssueRead }>();
  // Note that a read for another issue, or one answered after a change landed, draws nothing over it.
  const generation = useRef(0);
  const reload = useCallback(() => {
    generation.current += 1;
    const asked = generation.current;
    const taken = (read: IssueView) => {
      if (asked === generation.current) setHeld({ issueId, read });
    };
    act(ACT_KIND.ISSUES_READ, { issueId }).then(taken, () => taken(UNANSWERED));
  }, [act, issueId]);
  useEffect(reload, [reload]);
  // Note that only the newest change's answer is drawn, so an older one answered after it puts back nothing it changed.
  const change = useCallback(
    (params: IssueChange) => {
      generation.current += 1;
      const asked = generation.current;
      return changeListed({ issueId, change: params }).then((answer) => {
        if ("issue" in answer && asked === generation.current) setHeld({ issueId, read: answer });
        return answer;
      });
    },
    [changeListed, issueId],
  );
  const read = held?.issueId === issueId ? held.read : undefined;
  return { read, reload, change };
}
