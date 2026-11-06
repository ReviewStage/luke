import type { DatabaseServices } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { LINK_PLACE, linkOf, mentionMarkdownLink, taskLinkStep } from "@repo/features/link-grammar";
import { MENTION_KIND, type Mention, mentionMarkdown } from "@repo/features/mention-link";
import { PAGE_OWNER, type PageOwner } from "@repo/features/page-wire";
import { Effect, Option } from "effect";
import { taskWorkspace } from "../github/workspace-repository.js";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * written-mentions.ts -- the mentions a tool hands an agent ready to write: a task's, a page's, on a task or on an agent with no task, or another agent's, each `[@name](target)` under its workspace.
 *
 * An agent names a thing of ours in its messages, its Inbox items, its
 * description notes, and its pages as a mention (`@repo/features/mention-link`),
 * which the desktop draws as the thing's chip and the description keeps through
 * every correction. A tool that makes or lists such a thing answers its
 * mention whole, so the agent copies it rather than spelling an address.
 * The workspace is written by the slug its member reads it under, or by
 * its id where the member reads it no longer, as the desktop writes its
 * own links: a slug is never trusted, and the id alone finds the thing. A
 * task, and a page on one, is written by its number in the workspace
 * (`taskLinkStep`), which a reader finds by the slug and the window draws
 * as the task's chip once it finds the task among its own.
 */

/** The step a workspace's links are written under: its slug as the member reads it, or its id. */
export const workspaceStepOf = (
  userId: string,
  workspaceId: string,
): Effect.Effect<string, StoreFailure, DatabaseServices> =>
  Effect.map(
    workspaceOf(userId, workspaceId),
    (found) => Option.getOrUndefined(found)?.slug ?? workspaceId,
  );

/**
 * The step a workspace's links are written under, as `workspaceStepOf` reads
 * it, and its name, which its tasks' keys are drawn from (`workspace-key.ts`);
 * no name where the member reads the workspace no longer.
 */
export const workspaceNamingOf = (
  userId: string,
  workspaceId: string,
): Effect.Effect<
  { readonly step: string; readonly name: string },
  StoreFailure,
  DatabaseServices
> =>
  Effect.map(workspaceOf(userId, workspaceId), (found) => {
    const workspace = Option.getOrUndefined(found);
    return { step: workspace?.slug ?? workspaceId, name: workspace?.name ?? "" };
  });

/** The step a task's links are written under, its workspace's as the member reads the task; nothing for a task the member cannot read. */
const taskStepOf = (
  userId: string,
  taskId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> =>
  Effect.flatMap(taskWorkspace(userId, taskId), (workspace) =>
    Option.match(workspace, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (workspaceId) => Effect.map(workspaceStepOf(userId, workspaceId), Option.some),
    }),
  );

/** The step a page's links are written under: its task's, or, for a page of a coding agent on no task, that agent's workspace's; nothing where the member reads neither. */
export const pageStepOf = (
  userId: string,
  owner: PageOwner,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> => {
  if (owner.kind === PAGE_OWNER.TASK) return taskStepOf(userId, owner.taskId);
  return Effect.flatMap(readAgent(userId, owner.agentId), (agent) =>
    Option.match(agent, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: ({ organizationId }) =>
        Effect.map(workspaceStepOf(userId, organizationId), Option.some),
    }),
  );
};

/**
 * A page's mention as an agent writes it, its title as its name: under its
 * task, by the task's number (`taskLinkStep`), or under the coding agent on
 * no task that showed it; nothing where the member reads neither.
 */
export const writtenPageMention = (
  userId: string,
  owner: PageOwner,
  pageId: string,
  title: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> => {
  if (owner.kind === PAGE_OWNER.AGENT) {
    return Effect.map(
      pageStepOf(userId, owner),
      Option.map((step) =>
        writtenMention({ kind: MENTION_KIND.PAGE, agentId: owner.agentId, pageId }, title, step),
      ),
    );
  }
  return Effect.flatMap(readTaskHeader(userId, owner.taskId), (header) =>
    Option.match(header, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: ({ workspaceId, number }) =>
        Effect.map(workspaceStepOf(userId, workspaceId), (step) => {
          const planId = taskLinkStep({ id: owner.taskId, number });
          const link = linkOf({ kind: LINK_PLACE.PAGE, planId, pageId }, step);
          return Option.some(mentionMarkdownLink(title, link));
        }),
    }),
  );
};

/** A task as its link names it: its id, and its number in its workspace where one is known. */
interface LinkedTask {
  readonly id: string;
  readonly number?: number | undefined;
}

/** A task's mention as an agent writes it, named and by its link under the workspace's step, which names it by its number (`taskLinkStep`). */
export function writtenTaskMention(task: LinkedTask, name: string, workspace: string): string {
  return mentionMarkdownLink(
    name,
    linkOf({ kind: LINK_PLACE.TASK, planId: taskLinkStep(task) }, workspace),
  );
}

/** The mention as an agent writes it, named and under the workspace's step; a thing of ours names no repository. */
export function writtenMention(mention: Mention, name: string, workspace: string): string {
  return mentionMarkdown(mention, name, { workspace, repository: null });
}
