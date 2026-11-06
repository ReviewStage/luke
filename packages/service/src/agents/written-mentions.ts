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

export const workspaceStepOf = (
  userId: string,
  workspaceId: string,
): Effect.Effect<string, StoreFailure, DatabaseServices> =>
  Effect.map(
    workspaceOf(userId, workspaceId),
    (found) => Option.getOrUndefined(found)?.slug ?? workspaceId,
  );

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

interface LinkedTask {
  readonly id: string;
  readonly number?: number | undefined;
}

export function writtenTaskMention(task: LinkedTask, name: string, workspace: string): string {
  return mentionMarkdownLink(
    name,
    linkOf({ kind: LINK_PLACE.TASK, planId: taskLinkStep(task) }, workspace),
  );
}

export function writtenMention(mention: Mention, name: string, workspace: string): string {
  return mentionMarkdown(mention, name, { workspace, repository: null });
}
