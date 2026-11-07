/**
 * workspace-member.ts -- who a workspace's live reads admit: a member of the workspace the read names, every other account answered as if it named none.
 */

import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import { Effect } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";

/** The reader admitted where it is a member of the workspace named; not found otherwise, so a workspace it is no member of reads as none. */
export const admitWorkspaceMember = /* @__PURE__ */ Effect.fnUntraced(function* ({
  userId,
  workspaceId,
}: {
  readonly userId: string;
  readonly workspaceId: string;
}) {
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
});
