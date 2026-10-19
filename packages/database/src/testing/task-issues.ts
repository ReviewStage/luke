import { randomUUID } from "node:crypto";
import { TASK_ISSUE_PROVIDER } from "@luke/features/task-issue-wire";
import type { NewTaskIssueLink } from "../models/task-issue-store.js";

/**
 * task-issues.ts -- an issue as a test's task links it, the way a start from Linear's picker links one.
 *
 * A test about something else that wants a task linked to an issue hands
 * `createTask` (or `startTask`) this in its `issueLinks`: a Linear issue by
 * its key, title, and page, under a fresh id of Linear's, with no
 * description unless one is given and the default relation.
 */

/** What a test names a Linear issue by: its key, `ENG-42`, title, page, and description. */
export interface TestLinearIssue {
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly description?: string;
}

/** The Linear issue as a link a new task takes. */
export function linearIssueLink(issue: TestLinearIssue): NewTaskIssueLink {
  return {
    provider: TASK_ISSUE_PROVIDER.LINEAR,
    externalId: randomUUID(),
    key: issue.identifier,
    title: issue.title,
    url: issue.url,
    description: issue.description ?? "",
  };
}
