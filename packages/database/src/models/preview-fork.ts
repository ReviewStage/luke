/**
 * preview-fork.ts -- a Preview's database, a branch of production's, cut down to the team's workspaces and settled.
 *
 * Neon branches a Preview's database off production the first time its Git
 * branch deploys, with every row production held at that instant. That copy
 * carries two things a Preview must not keep. Every account's words are one:
 * the Preview is for the team testing its own change, so it keeps the
 * workspaces the deployment names, the accounts that are members of them, and
 * those accounts' own first workspaces, and nothing else. What was in flight is
 * the other: a turn still running, a coding agent at work, an open call, a
 * command queued for a Mac, a sandbox queued to stop, an automation due. Each
 * names a live thing in production (an eve session, a Vercel Sandbox, a Mac
 * that still polls), the Preview can finish none of them, and no cron runs on a
 * Preview to settle them, so without this they stand running for good, and a
 * Mac signed in to the Preview would take a command queued in production and
 * run it again.
 *
 * So the Preview build runs this once, after its migrations: it keeps the
 * team's workspaces and accounts and deletes every other one, whose rows go
 * with them by their foreign keys; it removes the credentials the copy holds,
 * none of which the Preview's own secrets open; it settles and switches off
 * what was in flight; and it writes `preview_fork`'s one row last. Every step
 * is idempotent and the row comes last, so a build cut short is finished by
 * the next, and a branch that already holds the row is left as it stands.
 * Production's own table stays empty, so a branch reset onto production is
 * made the Preview's own again on its next build.
 *
 * Whether to run at all, and against which database, is the caller's
 * (`packages/service/src/maintenance/preview-database.ts`): nothing here
 * reads the environment, and run against production this would delete every
 * account outside the workspaces named.
 */

import { AUTOMATION_RUN_REASON, AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import { TURN_STATUS } from "@luke/wire";
import { eq, inArray, isNotNull, isNull, notInArray, or } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, type Schema } from "effect";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { accountProviderKey } from "../schemas/account-provider-key.js";
import {
  account,
  member,
  oauthAccessToken,
  oauthRefreshToken,
  organization,
  session,
  user,
  verification,
} from "../schemas/auth.js";
import { automation, automationRun } from "../schemas/automation.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { githubConnectIntent } from "../schemas/github-connect-intent.js";
import { githubInstallIntent } from "../schemas/github-install-intent.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import { personalWorkspace } from "../schemas/personal-workspace.js";
import { previewFork } from "../schemas/preview-fork.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";
import { sessionSandboxCleanup } from "../schemas/session-sandbox.js";
import { turns } from "../schemas/storage.js";
import { voiceSessions } from "../schemas/voice.js";
import { VOICE_CLOSE_REASON } from "../voice-vocabulary.js";
import { settleEndedSessionTurn } from "./abandoned-turns.js";
import { closeAvatarSessionsOfEndedCalls } from "./voice-avatar-sessions.js";
import type { StoreWriter } from "./writer.js";

/** The key of `preview_fork`'s one row. */
const PREVIEW_FORK_ROW = "prepared";

/** What one run did: made the copy the Preview's own, found it already made so, or found none of the workspaces named. */
export const PREVIEW_FORK_OUTCOME = {
  PREPARED: "prepared",
  ALREADY_PREPARED: "already-prepared",
  NO_WORKSPACE: "no-workspace",
} as const;

/** How many of each kind a run kept, removed, or settled: counts alone, never a name or an id. */
export interface PreviewForkCounts {
  readonly keptWorkspaces: number;
  readonly keptAccounts: number;
  readonly removedWorkspaces: number;
  readonly removedAccounts: number;
  readonly settledTurns: number;
  readonly archivedAgents: number;
}

export type PreviewForkOutcome =
  | ({ readonly kind: typeof PREVIEW_FORK_OUTCOME.PREPARED } & PreviewForkCounts)
  | { readonly kind: typeof PREVIEW_FORK_OUTCOME.ALREADY_PREPARED }
  | { readonly kind: typeof PREVIEW_FORK_OUTCOME.NO_WORKSPACE };

export interface PreviewForkStore {
  /** The writer whose turn end settles a turn, as the relay's own end and the sweep's do. */
  readonly writer: Pick<StoreWriter, "consume">;
}

export interface PreviewForkOptions {
  /** The slugs of the workspaces the Preview keeps, with their members. */
  readonly keepWorkspaceSlugs: readonly string[];
  readonly now: number;
}

type PreviewForkEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/**
 * Deletes every row of the table. Every table handed here holds only
 * production's credentials or names production's live things, so a Preview
 * keeps none of its rows.
 */
const emptied = (table: PgTable): PreviewForkEffect<void> =>
  Effect.asVoid(
    Database.use((db) =>
      // oxlint-disable-next-line anti-slop/enforce-delete-with-where -- Emptying the table is this run's point: every table handed here holds only production's credentials or its live things.
      db.delete(table),
    ),
  );

/** Whether this database already holds the row a finished run writes. */
const alreadyPrepared: PreviewForkEffect<boolean> = Database.use((db) =>
  db.select({ id: previewFork.id }).from(previewFork).limit(1),
).pipe(Effect.map((rows) => rows.length > 0));

/**
 * The workspaces and accounts the Preview keeps: the workspaces named, every
 * account that is a member of one, and each such account's own first
 * workspace, which every account is made and which holds its own tasks.
 */
const keptOf = (slugs: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const named = yield* db
      .select({ id: organization.id })
      .from(organization)
      .where(inArray(organization.slug, [...slugs]));
    const namedIds = named.map(({ id }) => id);
    if (namedIds.length === 0) return undefined;
    const members = yield* db
      .selectDistinct({ userId: member.userId })
      .from(member)
      .where(inArray(member.organizationId, namedIds));
    const accountIds = members.map(({ userId }) => userId);
    const personal =
      accountIds.length === 0
        ? []
        : yield* db
            .select({ organizationId: personalWorkspace.organizationId })
            .from(personalWorkspace)
            .where(inArray(personalWorkspace.userId, accountIds));
    const workspaceIds = [
      ...new Set([...namedIds, ...personal.map(({ organizationId }) => organizationId)]),
    ];
    return { workspaceIds, accountIds };
  });

/**
 * Deletes every workspace and then every account outside those kept. Each
 * workspace's tasks, agents, chats, inbox, and installations go with it, and
 * each account's conversations, keys, and usage with the account, by the
 * foreign keys every table declares; `preview-fork.test.ts` holds that no
 * table outside them is left unreached.
 */
const removeOthers = (kept: { workspaceIds: string[]; accountIds: string[] }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const workspaces = yield* db
      .delete(organization)
      .where(notInArray(organization.id, kept.workspaceIds))
      .returning({ id: organization.id });
    const accounts = yield* db
      .delete(user)
      .where(kept.accountIds.length === 0 ? undefined : notInArray(user.id, kept.accountIds))
      .returning({ id: user.id });
    return { removedWorkspaces: workspaces.length, removedAccounts: accounts.length };
  });

/**
 * Removes the credentials the copy carries. Sessions and OAuth tokens are
 * production's, and anyone reading the Preview's database could present
 * them to production, so they go; a Preview is signed in to afresh. The
 * provider tokens on `account` rows and the accounts' own provider keys are
 * sealed under production's secrets, which a Preview never holds, so they
 * open nothing here; the token columns are cleared and the keys deleted,
 * leaving the account linked and its agents on Luke's own keys until a key is
 * saved on the Preview. A sign-in or a GitHub connection begun in production
 * cannot finish here, so its one-time state goes too.
 */
const removeCredentials: PreviewForkEffect<void> = Effect.gen(function* () {
  const db = yield* Database;
  yield* emptied(oauthAccessToken);
  yield* emptied(oauthRefreshToken);
  yield* emptied(session);
  yield* emptied(verification);
  yield* db
    .update(account)
    .set({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
    })
    .where(
      or(
        isNotNull(account.accessToken),
        isNotNull(account.refreshToken),
        isNotNull(account.idToken),
      ),
    );
  yield* emptied(accountProviderKey);
  yield* emptied(githubConnectIntent);
  yield* emptied(githubInstallIntent);
});

/**
 * Settles every turn still queued or running as failed because its session
 * ended, which on a Preview it has: the eve session it ran in belongs to
 * production's deployment. The write is the one eve's own word that a
 * session ended takes, so its journal and unanswered parts settle as a
 * failed turn's do. Answers how many it settled.
 */
const settleTurns = (store: PreviewForkStore, now: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const standing = yield* db
      .select({ id: turns.id, userId: turns.userId, conversationId: turns.conversationId })
      .from(turns)
      .where(inArray(turns.status, [TURN_STATUS.QUEUED, TURN_STATUS.RUNNING]));
    let settled = 0;
    for (const turn of standing) {
      if (yield* settleEndedSessionTurn(store.writer, turn, now)) settled += 1;
    }
    return settled;
  });

/**
 * Switches off everything else that would act on production's live things.
 * Every coding agent is archived, since its session and sandbox are
 * production's and a message from the Preview must not reach them; its task,
 * conversation, and pull request stay readable. Open calls are closed, rows
 * only, since their sessions are production's to end. Automations are
 * paused and their queued runs skipped as paused, so no sweep fires them.
 * Commands queued for a Mac, the record of a Mac listening, the sandboxes
 * queued for deletion, and the terminals' sandbox leases all name
 * production's live things and go. Answers how many agents it archived.
 */
const switchOffInFlight = (now: number) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const at = new Date(now);
    const archived = yield* db
      .update(codingAgent)
      .set({ archivedAt: at })
      .where(isNull(codingAgent.archivedAt))
      .returning({ id: codingAgent.id });
    yield* db
      .update(voiceSessions)
      .set({ closedAt: at, closeReason: VOICE_CLOSE_REASON.CONNECTION_LOST })
      .where(isNull(voiceSessions.closedAt));
    yield* closeAvatarSessionsOfEndedCalls();
    yield* db
      .update(automation)
      .set({ enabled: false, nextRunAt: null })
      .where(or(eq(automation.enabled, true), isNotNull(automation.nextRunAt)));
    yield* db
      .update(automationRun)
      .set({
        status: AUTOMATION_RUN_STATUS.SKIPPED,
        reason: AUTOMATION_RUN_REASON.PAUSED,
        settledAt: at,
      })
      .where(eq(automationRun.status, AUTOMATION_RUN_STATUS.QUEUED));
    yield* emptied(macCommand);
    yield* emptied(macCommandListener);
    yield* emptied(sessionSandboxCleanup);
    yield* emptied(sandboxTerminalLease);
    return archived.length;
  });

/**
 * Makes a Preview's copy of production's database its own, once: keeps the
 * workspaces named and their members, removes every other account and the
 * copy's credentials, and settles and switches off what was in flight, then
 * writes the row that marks it done. Answers what it did, with counts alone.
 * A database already holding the row is left as it stands, and one where no
 * workspace is named by a slug given is left untouched, since cutting it down
 * to nothing would leave the team no account to test with.
 */
export const preparePreviewFork = /* @__PURE__ */ Effect.fn("web/preparePreviewFork")(function* (
  store: PreviewForkStore,
  options: PreviewForkOptions,
): Effect.fn.Return<PreviewForkOutcome, QueryError | Schema.SchemaError, DatabaseServices> {
  if (yield* alreadyPrepared) return { kind: PREVIEW_FORK_OUTCOME.ALREADY_PREPARED };
  const kept = yield* keptOf(options.keepWorkspaceSlugs);
  if (kept === undefined) return { kind: PREVIEW_FORK_OUTCOME.NO_WORKSPACE };

  const removed = yield* removeOthers(kept);
  yield* removeCredentials;
  const settledTurns = yield* settleTurns(store, options.now);
  const archivedAgents = yield* switchOffInFlight(options.now);
  const db = yield* Database;
  yield* db
    .insert(previewFork)
    .values({ id: PREVIEW_FORK_ROW, preparedAt: new Date(options.now) })
    .onConflictDoNothing({ target: previewFork.id });

  return {
    kind: PREVIEW_FORK_OUTCOME.PREPARED,
    keptWorkspaces: kept.workspaceIds.length,
    keptAccounts: kept.accountIds.length,
    ...removed,
    settledTurns,
    archivedAgents,
  };
});
