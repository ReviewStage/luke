import type { DatabaseServices } from "@luke/database/core/query";
import { workspaceOf } from "@luke/database/models/workspace-store";
import { type Mention, mentionMarkdown } from "@luke/features/mention-link";
import { Effect, Option } from "effect";
import { taskWorkspace } from "../github/workspace-repository.js";
import type { StoreFailure } from "../http/store-failure.js";

/**
 * written-mentions.ts -- the mentions a tool hands an agent ready to write: a task's, a page's, or another agent's, each `[@name](target)` under its workspace.
 *
 * An agent names a thing of Luke's in its messages, its Inbox items, its
 * plan notes, and its pages as a mention (`@luke/features/mention-link`),
 * which the desktop draws as the thing's chip and the plan keeps through
 * every correction. A tool that makes or lists such a thing answers its
 * mention whole, so the agent copies it rather than spelling an address.
 * The workspace is written by the slug its member reads it under, or by
 * its id where the member reads it no longer, as the desktop writes its
 * own links: a slug is never trusted, and the id alone finds the thing.
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

/** The step a task's links are written under, its workspace's as the member reads the task; nothing for a task the member cannot read. */
export const taskStepOf = (
  userId: string,
  taskId: string,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> =>
  Effect.flatMap(taskWorkspace(userId, taskId), (workspace) =>
    Option.match(workspace, {
      onNone: () => Effect.succeed(Option.none<string>()),
      onSome: (workspaceId) => Effect.map(workspaceStepOf(userId, workspaceId), Option.some),
    }),
  );

/** The mention as an agent writes it, named and under the workspace's step; a thing of Luke's names no repository. */
export function writtenMention(mention: Mention, name: string, workspace: string): string {
  return mentionMarkdown(mention, name, { workspace, repository: null });
}
