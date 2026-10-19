// experiment-write.ts -- an experiment turned on or off: written to the service, which holds the choice, one write at a time, then kept here as the service answered it.
import type { Experiment } from "@luke/settings";
import type { SettingsUpdateResult } from "@luke/settings/wire";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import { Effect, Semaphore } from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { AccountPreferencesClient } from "./account-preferences-client.js";
import type { SettingsStore } from "./settings-store.js";

/** Why an experiment's switch did not move: the service did not answer the write. */
export const EXPERIMENT_UNANSWERED = "Luke's service could not be reached. Try again.";

/** Why an experiment's switch did not move: the account it was pressed for signed out before the service answered. */
export const EXPERIMENT_ACCOUNT_CHANGED = "The account changed before that switch landed.";

/** The concern's one way to write an experiment, and how many writes it has sent. */
export interface ExperimentWriter {
  /**
   * Writes one experiment's switch for the account named and answers the
   * settings as they then stand: accepted once the service holds it and the
   * account is still the one signed in, refused otherwise.
   */
  readonly write: (
    accountEmail: string,
    experiment: Experiment,
    on: boolean,
  ) => Effect.Effect<SettingsUpdateResult, PlatformError>;
  /** How many writes have gone to the service, so a read begun before one can tell it is stale. */
  readonly writesSent: () => number;
}

/**
 * The writer. The service is written first because the choice is the
 * account's on it: a write it did not answer is the row's refusal, and the
 * switch stays where it stood rather than claiming a choice no other Mac
 * will see. Note that writes take turns on one permit, because the service
 * merges each patch as it arrives: two presses in flight at once could
 * otherwise land in the other order and leave the switch where the first
 * press put it.
 */
export function experimentWriter(input: {
  readonly client: Pick<AccountPreferencesClient, "writeExperiments">;
  readonly store: SettingsStore;
  /** Who is signed in now, as the account's session names them; nothing while no one is. */
  readonly readAccountKey: () => Effect.Effect<string | undefined>;
}): ExperimentWriter {
  const { client, store, readAccountKey } = input;
  const turns = Semaphore.makeUnsafe(1);
  let sent = 0;
  const refused = (reason: string) =>
    Effect.map(store.snapshot(), (settings) => ({
      status: ACTION_RESULT_STATUS.REJECTED,
      settings,
      reason,
    }));
  return {
    writesSent: () => sent,
    write: (accountEmail, experiment, on) =>
      turns.withPermits(1)(
        Effect.gen(function* () {
          sent += 1;
          const answer = yield* client.writeExperiments({ [experiment]: on });
          if (!answer) return yield* refused(EXPERIMENT_UNANSWERED);
          yield* store.cacheExperiments(accountEmail, answer.experiments);
          // An answer for an account that has since signed out moved no switch this window draws.
          if ((yield* readAccountKey()) !== accountEmail) {
            return yield* refused(EXPERIMENT_ACCOUNT_CHANGED);
          }
          return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* store.snapshot() };
        }),
      ),
  };
}
