import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { useCallback } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import type { IntegrationStatuses } from "./integration-statuses";
import { CONNECTED_ACCOUNTS_LINK, useOpenSettings } from "./open-settings";

/**
 * integration-grant.ts -- begins the account's grant of one integration, however the provider is granted.
 *
 * A provider granted through Vercel Connect begins a browser sign-in there:
 * the host opens it, the provider stands pending, and the window reads it
 * again on its return (`integration-statuses.ts`). GitHub is granted by the
 * account's own GitHub (`INTEGRATION_GRANT_OF`), which is connected in
 * Settings › Connected accounts, so its grant opens Settings there, as every
 * other GitHub remedy does (`open-settings.tsx`): signing in again with
 * GitHub would not link GitHub to an account made with Google.
 */

/** How a grant begun went, as the surface that began it says. */
export const GRANT_OUTCOME = {
  /** A Connect sign-in is under way in the browser. */
  BEGUN: "begun",
  /** Settings opened at Connected accounts, where GitHub is connected. */
  SETTINGS_OPENED: "settings-opened",
  /** The browser could not be opened. */
  NOT_OPENED: "not-opened",
  /** The service or the host refused to begin it. */
  REFUSED: "refused",
} as const;

type GrantOutcome = (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME];

/** What a surface begins a grant with. */
export interface IntegrationGrant {
  readonly begin: (provider: IntegrationProvider) => Promise<GrantOutcome>;
}

/** Whether the account's own GitHub sign-in grants the provider, rather than a Connect sign-in. */
export function grantedBySignIn(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
}

/** Begins a grant: GitHub's in Settings › Connected accounts, any other's through Vercel Connect. */
export function useIntegrationGrant(statuses: IntegrationStatuses): IntegrationGrant {
  const { act } = useAct();
  const openSettings = useOpenSettings();
  const { signInBegun } = statuses;

  const begin = useCallback(
    async (provider: IntegrationProvider): Promise<GrantOutcome> => {
      if (grantedBySignIn(provider)) {
        openSettings(CONNECTED_ACCOUNTS_LINK);
        return GRANT_OUTCOME.SETTINGS_OPENED;
      }
      const answer = await act(ACT_KIND.INTEGRATIONS_CONNECT, { provider }).catch(() => undefined);
      if (answer === undefined) return GRANT_OUTCOME.REFUSED;
      if ("failure" in answer) {
        return answer.failure === INTEGRATION_CALL_FAILURE.NOT_OPENED
          ? GRANT_OUTCOME.NOT_OPENED
          : GRANT_OUTCOME.REFUSED;
      }
      signInBegun(provider);
      return GRANT_OUTCOME.BEGUN;
    },
    [act, openSettings, signInBegun],
  );

  return { begin };
}
