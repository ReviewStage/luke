import { signedInAccountId } from "@repo/credentials/snapshot";
import { agentDefaultOf } from "@repo/features/account-preferences-live";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ModelChoice } from "@repo/features/models-wire";
import { useCallback } from "react";
import { APP_SLICE, useAppSlice } from "./use-app-state.js";
import { HOST_READ_STATUS, type HostReadStatus, useHostRead } from "./use-host-read.js";

/**
 * account-choices.ts -- the account's own choices as every surface draws them: its preferences row, which the host holds for the session, the models it is offered and its devices, which a surface holds while it draws one, and the default a new agent runs on, worked out from both.
 *
 * The host holds the preferences row on a live read, so a default or a
 * chapters model chosen on another device draws here within the service's
 * coalesce window, and a write draws at once. The models are a fetch the
 * host asks again as a window comes forward, as the account's keys move,
 * and every `MODEL_CATALOG_TTL`. Where the account stored no default, the
 * default drawn is the one the service answers for it
 * (`agentDefaultOf`): the fallback the models mark as paid for.
 */

/** The default a new agent runs on, as a surface draws it, with where its reads stand and Try again. */
export interface DrawnAgentDefault {
  /** The default; none until both reads it is worked out from have answered, or where the preferences could not be read. */
  readonly choice: ModelChoice | undefined;
  readonly status: HostReadStatus;
  readonly retry: () => Promise<void>;
}

/** The account signed in, by the id the host holds its reads under; none while nobody is. */
function useAccountKey(): string | undefined {
  return signedInAccountId(useAppSlice(APP_SLICE.ACCOUNT));
}

/** The account's preferences row, which the host holds for the session. */
export function useAccountPreferences() {
  return useHostRead(LIVE_READ.ACCOUNT_PREFERENCES, useAccountKey());
}

/** The models the account is offered and its devices, held while `drawing`, a surface that draws one. */
export function useOfferedModels(drawing = true) {
  const accountId = useAccountKey();
  return useHostRead(LIVE_READ.MODELS, drawing ? accountId : undefined);
}

/**
 * The default a new agent runs on: the account's stored one, or where it
 * stored none the fallback the models it is offered mark as paid for, as
 * the service answers it; Anthropic's where the models could not be read.
 * Failed where the preferences could not be read, since a stored choice
 * may stand behind them.
 */
export function useAgentDefault(): DrawnAgentDefault {
  const preferences = useAccountPreferences();
  const models = useOfferedModels();
  const read =
    models.status === HOST_READ_STATUS.FAILED
      ? { failed: true as const }
      : models.rows === undefined
        ? {}
        : { rows: models.rows };
  const choice =
    preferences.rows === undefined ? undefined : agentDefaultOf(preferences.rows.agent, read);
  const status =
    preferences.status === HOST_READ_STATUS.FAILED
      ? HOST_READ_STATUS.FAILED
      : choice === undefined
        ? HOST_READ_STATUS.LOADING
        : HOST_READ_STATUS.READY;
  const retryPreferences = preferences.retry;
  const retryModels = models.retry;
  const retry = useCallback(
    () => Promise.all([retryPreferences(), retryModels()]).then(() => undefined),
    [retryPreferences, retryModels],
  );
  return { choice, status, retry };
}
