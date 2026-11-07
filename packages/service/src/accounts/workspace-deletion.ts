/**
 * workspace-deletion.ts -- what a workspace's deletion does of its own around Better Auth's `deleteOrganization`, which its hooks run (`deletion-hooks.ts`).
 *
 * Better Auth deletes the workspace's row, every row of the workspace
 * cascading with it, its agents among them. An agent's conversation names
 * the account that ran it rather than the workspace, so it outlasts the
 * agent: before the delete the conversations of every agent of the
 * workspace are read, and after it they are stamped deleted, as a deleted
 * task's are, so the purge takes them seven days on and queues their
 * sandboxes (`soft-delete.ts`). Nothing is stamped before the delete,
 * because a delete refused after that would leave a standing workspace's
 * agents with their transcripts gone.
 */

import { stampConversationsDeleted } from "@repo/database/models/soft-delete";
import { workspaceConversationIds } from "@repo/database/models/workspace-store";
import { Effect } from "effect";

/** What the deletion read before Better Auth deleted the workspace, which it settles after. */
export interface WorkspaceDeletionPending {
  readonly conversationIds: readonly string[];
}

/** What the deletion reads before Better Auth deletes the workspace; a store that cannot be read refuses the delete. */
export const beforeWorkspaceDeletion = /* @__PURE__ */ Effect.fn("web/beforeWorkspaceDeletion")(
  function* (organizationId: string) {
    const conversationIds = yield* workspaceConversationIds(organizationId);
    return { conversationIds } satisfies WorkspaceDeletionPending;
  },
);

/** What the deletion settles once Better Auth has deleted the workspace, a failure logged since the workspace is already gone. */
export const afterWorkspaceDeletion = /* @__PURE__ */ Effect.fn("web/afterWorkspaceDeletion")(
  function* (pending: WorkspaceDeletionPending) {
    yield* stampConversationsDeleted(pending.conversationIds).pipe(
      Effect.catch((failure) =>
        Effect.logError(
          "The workspace's deletion left its agents' conversations standing",
          failure,
        ),
      ),
    );
  },
);
