/**
 * reader-topics.ts -- the topics a live read of what the account reaches across its workspaces is woken on: its own, and each of its workspaces'.
 */

import { memberWorkspaceIds } from "@repo/database/models/workspace-store";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { Effect } from "effect";

/**
 * The reader's topic for each workspace it is a member of, looked up as a
 * read is asked for. Note that a membership made or ended moves the rows of
 * a read that takes these and notifies the reader's own topic, which such a
 * read takes too, so the read it wakes answers, and the next request looks
 * the memberships up again.
 */
function readerWorkspaceTopics(userId: string) {
  return Effect.map(memberWorkspaceIds(userId), (workspaceIds) =>
    workspaceIds.map((workspaceId): SyncTopic => [TOPIC.WORKSPACE, workspaceId]),
  );
}

/** The reader's own topic and its workspaces', which a read of what the account reaches across its workspaces is woken on. */
export function readerAndWorkspaceTopics(userId: string) {
  return Effect.map(readerWorkspaceTopics(userId), (workspaces): readonly SyncTopic[] => [
    [TOPIC.ACCOUNT, userId],
    ...workspaces,
  ]);
}
