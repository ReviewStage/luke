/**
 * preview-copy.ts -- a Preview's copy of production's database, with the work production had in flight switched off.
 *
 * Neon branches a Preview's database off production with every row production
 * held at that instant, so it arrives holding production's work in flight: a
 * turn still running, a coding agent at work, an open call, a command queued
 * for a Mac, a sandbox queued to stop or held for a terminal, an automation
 * due. Each names a live thing in production (an eve session, a Vercel
 * Sandbox, a Mac that still polls) that the Preview can neither finish nor
 * reach, and no cron runs on a Preview to settle it, so without this it stands
 * running for good, and a Mac signed in to the Preview would take a command
 * queued in production and run it again.
 *
 * The Preview build runs this after its migrations, on every build: it keeps
 * no record of having run, so work started on the Preview itself is switched
 * off too by the next build of its branch, which the team chose over the
 * record that would tell the two apart. Every step is idempotent.
 *
 * Whether to run at all is the caller's
 * (`packages/service/src/maintenance/preview-database.ts`): nothing here
 * reads the environment, and run against production this would stop every
 * account's agents.
 */

import { AUTOMATION_RUN_REASON, AUTOMATION_RUN_STATUS } from "@luke/features/automation-wire";
import { TURN_STATUS } from "@luke/wire";
import { eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { Effect, type Schema } from "effect";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { automation, automationRun } from "../schemas/automation.js";
import { codingAgent } from "../schemas/coding-agent.js";
import { macCommand, macCommandListener } from "../schemas/mac-command.js";
import { sandboxTerminalLease } from "../schemas/sandbox-terminal-lease.js";
import { sessionSandboxCleanup } from "../schemas/session-sandbox.js";
import { turns } from "../schemas/storage.js";
import { voiceSessions } from "../schemas/voice.js";
import { VOICE_CLOSE_REASON } from "../voice-vocabulary.js";
import { settleEndedSessionTurn } from "./abandoned-turns.js";
import { closeAvatarSessionsOfEndedCalls } from "./voice-avatar-sessions.js";
import type { StoreWriter } from "./writer.js";

/** How many turns a run settled and agents it archived: counts alone, never a name or an id. */
export interface PreviewCopyCounts {
  readonly settledTurns: number;
  readonly archivedAgents: number;
}

export interface PreviewCopyStore {
  /** The writer whose turn end settles a turn, as the relay's own end and the sweep's do. */
  readonly writer: Pick<StoreWriter, "consume">;
}

type PreviewCopyEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/**
 * Deletes every row of the table. Every table handed here names only
 * production's live things, so a Preview keeps none of its rows.
 */
const emptied = (table: PgTable): PreviewCopyEffect<void> =>
  Effect.asVoid(
    Database.use((db) =>
      // oxlint-disable-next-line anti-slop/enforce-delete-with-where -- Emptying the table is this run's point: every table handed here names only production's live things.
      db.delete(table),
    ),
  );

/**
 * Settles every turn still queued or running as failed because its session
 * ended, which on a Preview it has: the eve session it ran in belongs to
 * production's deployment. The write is the one eve's own word that a
 * session ended takes, so its journal and unanswered parts settle as a
 * failed turn's do. Answers how many it settled.
 */
const settleTurns = (store: PreviewCopyStore, now: number) =>
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
 * Switches off everything else that names production's live things. Every
 * coding agent is archived, since its session and sandbox are production's;
 * its task, conversation, and pull request stay readable. Open calls are
 * closed, rows only, since their sessions are production's to end.
 * Automations are paused and their queued runs skipped as paused, so no sweep
 * fires them. Commands queued for a Mac, the record of a Mac listening, the
 * sandboxes queued for deletion, and the terminals' sandbox leases all go.
 * Answers how many agents it archived.
 */
const switchOff = (now: number) =>
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
 * Switches off the work in flight a Preview's copy of production holds:
 * settles every queued or running turn, archives every coding agent, closes
 * open calls, pauses automations, and empties the Mac command and sandbox
 * queues. Answers what it did, with counts alone.
 */
export const switchOffCopiedWork = /* @__PURE__ */ Effect.fn("web/switchOffCopiedWork")(function* (
  store: PreviewCopyStore,
  now: number,
): Effect.fn.Return<PreviewCopyCounts, QueryError | Schema.SchemaError, DatabaseServices> {
  const settledTurns = yield* settleTurns(store, now);
  const archivedAgents = yield* switchOff(now);
  return { settledTurns, archivedAgents };
});
