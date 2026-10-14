import { INTEGRATION_CALL_FAILURE } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { useCallback } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "./act";
import { useGitHubConnection } from "./github-connect";
import type { IntegrationStatuses } from "./integration-statuses";

/**
 * integration-grant.ts -- begins the account's grant of one integration, however the provider is granted.
 *
 * A provider granted through Vercel Connect begins a browser sign-in there:
 * the host opens it, the provider stands pending, and the window reads it
 * again on its return (`integration-statuses.ts`). GitHub is granted by the
 * account's own GitHub (`INTEGRATION_GRANT_OF`), so its grant is the connect
 * Settings › Connected accounts runs, begun in place (`github-connect.tsx`),
 * which links GitHub to an account made with Google too, and is read again
 * on the window's return in the same way.
 */

/** How a grant begun went, as the surface that began it says. */
export const GRANT_OUTCOME = {
  /** A Connect sign-in is under way in the browser. */
  BEGUN: "begun",
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

/** Begins a grant: GitHub's through the account's GitHub connect, any other's through Vercel Connect. */
export function useIntegrationGrant(statuses: IntegrationStatuses): IntegrationGrant {
  const { act } = useAct();
  const { connect } = useGitHubConnection();
  const { signInBegun } = statuses;

  const begin = useCallback(
    async (provider: IntegrationProvider): Promise<GrantOutcome> => {
      if (grantedBySignIn(provider)) {
        connect();
        signInBegun(provider);
        return GRANT_OUTCOME.BEGUN;
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
    [act, connect, signInBegun],
  );

  return { begin };
}
