import { ACCOUNT_PROVIDER } from "@sidecar/credentials/snapshot";
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

/**
 * integration-grant.ts -- begins the account's grant of one integration, however the provider is granted.
 *
 * A provider granted through Vercel Connect begins a browser sign-in there:
 * the host opens it, the provider stands pending, and the window reads it
 * again on its return (`integration-statuses.ts`). GitHub is granted by the
 * account's own sign-in to Luke with GitHub (`INTEGRATION_GRANT_OF`), so its
 * grant is that sign-in taken again, through the same act the remedy for a
 * lapsed GitHub sign-in uses (`failure-note.tsx`), and a sign-in that landed
 * is read at once, with the panel brought back from the browser.
 */

/** How a grant begun went, as the surface that began it says. */
export const GRANT_OUTCOME = {
  /** A Connect sign-in is under way in the browser. */
  BEGUN: "begun",
  /** The GitHub sign-in landed. */
  SIGNED_IN: "signed-in",
  /** The GitHub sign-in was cancelled, or landed on another account and was refused. */
  NOT_SIGNED_IN: "not-signed-in",
  /** The browser could not be opened. */
  NOT_OPENED: "not-opened",
  /** The service or the host refused to begin it. */
  REFUSED: "refused",
} as const;

type GrantOutcome = (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME];

/** What a surface begins and cancels a grant with. */
export interface IntegrationGrant {
  readonly begin: (provider: IntegrationProvider) => Promise<GrantOutcome>;
  /** Withdraws a GitHub sign-in still waiting on the browser. */
  readonly cancel: () => void;
}

/** Whether the account's own GitHub sign-in grants the provider, rather than a Connect sign-in. */
export function grantedBySignIn(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
}

export function useIntegrationGrant(statuses: IntegrationStatuses): IntegrationGrant {
  const { act, tell } = useAct();
  const { read, signInBegun } = statuses;

  const begin = useCallback(
    async (provider: IntegrationProvider): Promise<GrantOutcome> => {
      if (grantedBySignIn(provider)) {
        const signedIn = await act(ACT_KIND.ACCOUNT_SIGN_IN_AGAIN, {
          provider: ACCOUNT_PROVIDER.GITHUB,
        }).catch(() => undefined);
        if (signedIn === undefined) return GRANT_OUTCOME.REFUSED;
        tell(ACT_KIND.WINDOW_FOCUS_PANEL);
        if (!signedIn) return GRANT_OUTCOME.NOT_SIGNED_IN;
        await read();
        return GRANT_OUTCOME.SIGNED_IN;
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
    [act, tell, read, signInBegun],
  );

  const cancel = useCallback(() => tell(ACT_KIND.ACCOUNT_CANCEL_SIGN_IN), [tell]);

  return { begin, cancel };
}
