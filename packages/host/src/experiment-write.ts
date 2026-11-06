import type { Experiment } from "@repo/settings";
import type { SettingsUpdateResult } from "@repo/settings/wire";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { Effect, Semaphore } from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { AccountPreferencesClient } from "./account-preferences-client.js";
import type { SettingsStore } from "./settings-store.js";

export const EXPERIMENT_UNANSWERED = "The service did not answer. Try again.";

export const EXPERIMENT_ACCOUNT_CHANGED = "The account changed before that switch landed.";

export interface ExperimentWriter {
  readonly write: (
    accountEmail: string,
    experiment: Experiment,
    on: boolean,
  ) => Effect.Effect<SettingsUpdateResult, PlatformError>;
  readonly writesSent: () => number;
}

export function experimentWriter(input: {
  readonly client: Pick<AccountPreferencesClient, "writeExperiments">;
  readonly store: SettingsStore;
  readonly readAccountKey: () => Effect.Effect<string | undefined>;
  readonly confirmAccount: () => Effect.Effect<void>;
}): ExperimentWriter {
  const { client, store, readAccountKey, confirmAccount } = input;
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
          yield* confirmAccount();
          if ((yield* readAccountKey()) !== accountEmail) {
            return yield* refused(EXPERIMENT_ACCOUNT_CHANGED);
          }
          sent += 1;
          const answer = yield* client.writeExperiments({ [experiment]: on });
          if (!answer) return yield* refused(EXPERIMENT_UNANSWERED);
          yield* store.cacheExperiments(accountEmail, answer.experiments);
          if ((yield* readAccountKey()) !== accountEmail) {
            return yield* refused(EXPERIMENT_ACCOUNT_CHANGED);
          }
          return { status: ACTION_RESULT_STATUS.ACCEPTED, settings: yield* store.snapshot() };
        }),
      ),
  };
}
