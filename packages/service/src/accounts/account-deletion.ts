/**
 * account-deletion.ts -- what an account's deletion does of its own around Better Auth's `deleteUser`, which its hooks run (`account-deletion-hooks.ts`).
 *
 * Better Auth deletes the account's sessions, sign-in accounts, and user row,
 * every dependent row cascading, and before it the workspaces the account is
 * the only member of (`auth/auth-policy.ts`'s `accountDeletion`). What it
 * knows nothing of is done here. Before the delete, once Better Auth has
 * found the session fresh: every session the account's standing agents'
 * conversations run in is retired while those conversations still stand
 * (`retire-sessions.ts`), a session not retired logged and the delete going
 * on; the analytics person is asked to be erased, since nothing after the
 * delete would still name it; and what the delete leaves to settle is read,
 * the integration grants among it, since an added account's subject is no id
 * the account still names after it. After the delete: the deleted
 * workspaces' agents' conversations are stamped deleted and the account's
 * sandboxes queued (`account-store.ts`), a settling that fails logged since
 * the account is already gone, and every grant is revoked at Vercel Connect,
 * as a Disconnect revokes one, a revoke that fails logged by its word.
 */

import {
  type AccountDeletionReach,
  readAccountDeletionReach,
  settleAccountDeletion,
} from "@repo/database/models/account-store";
import { standingSessionsOf } from "@repo/database/models/recorded-session";
import { Effect, Redacted } from "effect";
import type { HttpClient } from "effect/http";
import { retireSessions, retiringReach } from "../agents/retire-sessions.js";
import { HostedEnvironment } from "../environment.js";
import { revokeIntegrationGrants } from "../integrations/integration-connect.js";
import {
  type IntegrationConnectionRow,
  readIntegrationConnections,
} from "../integrations/integration-store.js";
import { forgetPosthogPersonEffect } from "../providers/posthog.js";

/**
 * Without both halves of the analytics configuration there is no person to
 * erase and nothing to erase it with, so the erasure is simply skipped.
 */
const forgetAnalytics = /* @__PURE__ */ Effect.fn("web/forgetAnalytics")(function* (
  userId: string,
): Effect.fn.Return<void, never, HostedEnvironment | HttpClient.HttpClient> {
  const environment = yield* HostedEnvironment;
  if (!environment.posthogPersonalApiKey || !environment.posthogProjectId) return;
  const personalApiKey = Redacted.value(environment.posthogPersonalApiKey);
  const projectId = environment.posthogProjectId;
  const host = environment.posthogApiHost;
  yield* forgetPosthogPersonEffect(userId, {
    personalApiKey,
    projectId,
    ...(host ? { host } : undefined),
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() =>
        process.stderr.write(`Analytics erasure did not complete: ${error.message}\n`),
      ),
    ),
  );
});

/** What the deletion read before Better Auth deleted the account, which it settles after. */
export interface AccountDeletionPending {
  readonly reach: AccountDeletionReach;
  readonly grants: readonly IntegrationConnectionRow[];
}

/** What the deletion does before Better Auth deletes the account, answering what it settles after; a store that cannot be read refuses the delete. */
export const beforeAccountDeletion = /* @__PURE__ */ Effect.fn("web/beforeAccountDeletion")(
  function* (userId: string) {
    const retiring = yield* retiringReach(userId);
    yield* retireSessions(retiring, yield* standingSessionsOf(userId));
    yield* forgetAnalytics(userId);
    const grants = yield* readIntegrationConnections(userId);
    const reach = yield* readAccountDeletionReach(userId);
    return { reach, grants } satisfies AccountDeletionPending;
  },
);

/** What the deletion settles once Better Auth has deleted the account. */
export const afterAccountDeletion = /* @__PURE__ */ Effect.fn("web/afterAccountDeletion")(
  function* (userId: string, pending: AccountDeletionPending) {
    yield* settleAccountDeletion(pending.reach).pipe(
      Effect.catch((failure) =>
        Effect.logError(
          "The account's deletion left its conversations or sandboxes unsettled",
          failure,
        ),
      ),
    );
    yield* revokeIntegrationGrants(userId, pending.grants);
  },
);
