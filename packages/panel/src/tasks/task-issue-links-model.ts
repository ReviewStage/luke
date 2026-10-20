/**
 * task-issue-links-model.ts -- what a task page's Linked issues box says: each link's state in words, and why a change of its links did not land; and what a Board card's tag calls a link.
 *
 * DOM-free, so the box and its tests read the same words. A GitHub issue's
 * state is GitHub's own three, a Linear issue's the name of the workflow
 * state Linear answered, and a link the provider answered nothing for says
 * no state at all rather than one it may no longer stand in.
 */

import { ISSUE_STATE, type IssueState } from "@luke/features/github-repositories-wire";
import {
  TASK_ISSUE_LINK_REFUSAL,
  TASK_ISSUE_PROVIDER,
  type TaskIssueLinkRefusal,
  type TaskIssueStanding,
  type TaskIssueTag,
} from "@luke/features/task-issue-wire";
import { TASK_BOUNDS } from "@luke/features/task-wire";
import { TASK_CALL_FAILURE, type TaskIssueCallFailure } from "@luke/features/tasks-view";

/** A GitHub issue's state in words, as its row says it. */
const GITHUB_STATE_WORDS = {
  [ISSUE_STATE.OPEN]: "Open",
  [ISSUE_STATE.CLOSED]: "Closed",
  [ISSUE_STATE.NOT_PLANNED]: "Not planned",
} as const satisfies Record<IssueState, string>;

/** Where a linked issue stands, in words; nothing where its provider did not answer. */
export function standingWords(standing: TaskIssueStanding | undefined): string | undefined {
  if (standing === undefined) return undefined;
  return standing.provider === TASK_ISSUE_PROVIDER.GITHUB
    ? GITHUB_STATE_WORDS[standing.state]
    : standing.state;
}

/** Why a link was not made, as the service said in band. */
const REFUSAL_WORDS = {
  [TASK_ISSUE_LINK_REFUSAL.LINKED]: "This task links that issue already.",
  [TASK_ISSUE_LINK_REFUSAL.FULL]: `A task links at most ${TASK_BOUNDS.MAX_ISSUES} issues.`,
} as const satisfies Record<TaskIssueLinkRefusal, string>;

/** Why a change of a task's links found no answer, by what the host said. */
const FAILURE_WORDS = {
  [TASK_CALL_FAILURE.UNANSWERED]: "Luke didn't answer. Try again.",
  [TASK_CALL_FAILURE.NOT_FOUND]: "That issue couldn't be read, or the task is gone.",
  [TASK_CALL_FAILURE.TASK_ARCHIVED]: "This task is archived, so its issues can't change.",
  [TASK_CALL_FAILURE.LINEAR_UNAVAILABLE]: "The workspace's Linear couldn't read that issue.",
} as const satisfies Record<TaskIssueCallFailure, string>;

/** What the box says of a change that did not land: a link refused, or a call that found no answer. */
export function linkNoteOf(
  why: { readonly refused: TaskIssueLinkRefusal } | { readonly failure: TaskIssueCallFailure },
): string {
  return "refused" in why ? REFUSAL_WORDS[why.refused] : FAILURE_WORDS[why.failure];
}

/** Whether the task links as many issues as a task may, so the picker offers no more. */
export function linksFull(count: number): boolean {
  return count >= TASK_BOUNDS.MAX_ISSUES;
}

/**
 * What a Board card's tag says of a linked issue: a Linear issue's key, and
 * a GitHub issue's `#N` where it is filed in the task's own repository, or
 * its whole `owner/name#N` in another, the repository's name compared
 * whatever its case, as GitHub reads it.
 */
export function issueTagWords(tag: TaskIssueTag, repository: string | null): string {
  if (tag.provider !== TASK_ISSUE_PROVIDER.GITHUB || repository === null) return tag.key;
  const filed = tag.key.slice(0, repository.length);
  const own =
    filed.toLowerCase() === repository.toLowerCase() && tag.key.charAt(repository.length) === "#";
  return own ? tag.key.slice(repository.length) : tag.key;
}
