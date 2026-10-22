/**
 * operator-notice.ts -- an event of one of a member's agents noted for the member's operator, without ever failing the path it rides on.
 *
 * A pull request merged or closed and a new ask in the member's inbox are
 * written as they are seen, beside the write they ride on
 * (`coder-host/published.ts`, `coder-host/inbox.ts`); a turn's end is
 * written by the store's own writer as it settles
 * (`@luke/database/models/writer`). The store writes nothing where the
 * member has no standing operator, and nothing for an operator's own events
 * (`@luke/database/models/operator-notices`). A write that fails is logged
 * by its kind alone and the path goes on.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { writeOperatorNotice } from "@luke/database/models/operator-notices";
import type { OperatorNoticeKind } from "@luke/database/storage-vocabulary";
import { causeKind } from "@luke/runtime/effect";
import { DateTime, Effect } from "effect";

/** The event of the kind given noted now for the agent's member's operator; a failure logged, never answered. */
export function noticedForOperator(
  agentId: string,
  kind: OperatorNoticeKind,
): Effect.Effect<void, never, DatabaseServices> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    writeOperatorNotice({ agentId }, kind, at),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("an operator's notice was not written", {
        kind,
        failure: causeKind(cause),
      }),
    ),
  );
}
