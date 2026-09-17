import {
  ACTION_RESULT_STATUS,
  type ProviderTranscriptChange,
  type ProviderTranscriptChangesResult,
  type TranscriptChangesRequest,
} from "@sidecar/session";
import { Effect } from "effect";
import type { ReportedSessions } from "./conversation.js";
import { UUID_PATTERN } from "./vocabulary.js";

/**
 * Which of the roster's chats moved since an instant, answered from what the
 * observation pass already holds: each chat's `lastActivityAt`, the
 * `updatedAt` Conductor's documented status endpoint reported for it on the
 * latest pass. Nothing leaves this read. The instant is the session's own
 * activity rather than its transcript's, so a chat may be named with no new
 * message; that is harmless, since an empty delta opens no turn and moves its
 * cursor all the same. The words are the incremental transcript read's, under
 * its own cursor, and no part of this answer.
 */

const NO_CHANGES: ProviderTranscriptChangesResult = {
  status: ACTION_RESULT_STATUS.ACCEPTED,
  changes: [],
};

/** Oldest first, then by id, so two chats moved on one instant answer in one order. */
function byInstantThenId(left: ProviderTranscriptChange, right: ProviderTranscriptChange): number {
  return (
    left.updatedAt - right.updatedAt ||
    left.providerSessionId.localeCompare(right.providerSessionId)
  );
}

export const readConductorTranscriptChanges = /* @__PURE__ */ Effect.fn(
  "providers/readConductorTranscriptChanges",
)(
  (
    reported: ReportedSessions,
    request: TranscriptChangesRequest,
  ): Effect.Effect<ProviderTranscriptChangesResult> =>
    Effect.sync(() => {
      // Only a UUID the latest roster reported is a chat this build knows an instant for; anything
      // else the caller named is dropped, and a mark equal to the instant is not a change past it.
      const known = new Map(
        reported().map((observation) => [
          observation.providerSessionId,
          observation.lastActivityAt,
        ]),
      );
      const ids = [...new Set(request.providerSessionIds)].filter(
        (id) => UUID_PATTERN.test(id) && known.has(id),
      );
      if (ids.length === 0) return NO_CHANGES;
      const changes: ProviderTranscriptChange[] = [];
      for (const providerSessionId of ids) {
        const updatedAt = known.get(providerSessionId);
        if (updatedAt === undefined) continue;
        if (request.since !== undefined && updatedAt <= request.since) continue;
        changes.push({ providerSessionId, updatedAt });
      }
      changes.sort(byInstantThenId);
      return { status: ACTION_RESULT_STATUS.ACCEPTED, changes };
    }),
);
