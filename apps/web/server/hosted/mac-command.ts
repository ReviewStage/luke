import {
  claimMacCommands,
  macCommandsWaiting,
  markMacListening,
} from "@sidecar/database/models/mac-command-store";
import type { PlanStoreEffect } from "@sidecar/database/models/plan-store";
import type { MacCommand } from "@sidecar/hosted/mac-command-wire";
import { Clock, Duration, Effect, Schedule } from "effect";

/**
 * mac-command.ts -- the Mac's side of a shell command queued for the account: a signed-in Mac holds the read, and takes every waiting command claimed for it.
 *
 * The one brake is a Settings switch on the Mac (`Let agents run commands on
 * this Mac`), which stops the Mac listening. A Mac may take a command only
 * within the claim window of its queueing, so a row left behind is never run
 * later. The Mac's side is `GET /api/mac-commands`, held open while nothing
 * waits and answered with every waiting command claimed for it, and `POST`,
 * its result (`../mac-commands-app.ts`).
 */

const MAC_COMMAND_SERVICE = {
  /** How long the Mac's read is held while nothing waits for it. */
  HOLD: Duration.seconds(20),
  /** How often a held read looks again. */
  POLL: Duration.millis(500),
  /**
   * How long a command may wait for a Mac to take it; one not taken by then
   * is never run. A listening Mac takes one within a poll.
   */
  CLAIM_WINDOW: Duration.seconds(30),
} as const;

/**
 * The Mac's held read: it is counted listening as the read arrives, and
 * answered with every waiting command claimed for it as soon as one waits,
 * or with none once the hold ends.
 */
export function macCommandsFor(userId: string): PlanStoreEffect<readonly MacCommand[]> {
  const queuedSince = Effect.map(
    Clock.currentTimeMillis,
    (now) => new Date(now - Duration.toMillis(MAC_COMMAND_SERVICE.CLAIM_WINDOW)),
  );
  return markMacListening(userId).pipe(
    Effect.andThen(
      Effect.flatMap(queuedSince, (since) => macCommandsWaiting(userId, since)).pipe(
        Effect.repeat({ schedule: Schedule.spaced(MAC_COMMAND_SERVICE.POLL), until: (any) => any }),
        Effect.timeoutOption(MAC_COMMAND_SERVICE.HOLD),
      ),
    ),
    Effect.andThen(Effect.flatMap(queuedSince, (since) => claimMacCommands(userId, since))),
  );
}
