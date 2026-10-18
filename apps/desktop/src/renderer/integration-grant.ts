import { SIGN_IN } from "@luke/features/integration-sign-in";
import type { IntegrationConnectView } from "@luke/features/integration-view";
import { INTEGRATION_CALL_FAILURE } from "@luke/features/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { useAct } from "@luke/panel/act";
import { useCallback } from "react";
import { useGitHubConnection } from "./github-connect";
import type { IntegrationStatuses } from "./integration-statuses";

/**
 * integration-grant.ts -- begins the account's grant of one integration, however the provider is granted.
 *
 * A provider granted through Vercel Connect begins a browser sign-in there:
 * the host opens it, the provider stands pending, and the window reads it
 * again on its return (`integration-statuses.ts`). GitHub is granted by the
 * account's own GitHub (`INTEGRATION_GRANT_OF`), so its grant is that
 * GitHub's connect (`github-connect.tsx`), which links GitHub to an account
 * made with Google too, and is read again on the window's return in the
 * same way. Another account at a provider is begun as a new sign-in, which
 * the service names; the window waits on it under that name.
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

/** What a surface begins a grant with: a sign-in to one server (an account, or a provider with none), or to a new account at a provider. */
export interface IntegrationGrant {
  readonly begin: (server: string) => Promise<GrantOutcome>;
  readonly add: (provider: IntegrationProvider) => Promise<GrantOutcome>;
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

  /** How a Connect's answer went, the sign-in waited on under the name the service gave it, else the one asked for. */
  const outcomeOf = useCallback(
    (answer: IntegrationConnectView | undefined, server: string): GrantOutcome => {
      if (answer === undefined) return GRANT_OUTCOME.REFUSED;
      if ("failure" in answer) {
        return answer.failure === INTEGRATION_CALL_FAILURE.NOT_OPENED
          ? GRANT_OUTCOME.NOT_OPENED
          : GRANT_OUTCOME.REFUSED;
      }
      signInBegun(answer.connection ?? server);
      return GRANT_OUTCOME.BEGUN;
    },
    [signInBegun],
  );

  const add = useCallback(
    async (provider: IntegrationProvider): Promise<GrantOutcome> => {
      const answer = await act(ACT_KIND.INTEGRATIONS_CONNECT, { provider, add: true }).catch(
        () => undefined,
      );
      return outcomeOf(answer, provider);
    },
    [act, outcomeOf],
  );

  const begin = useCallback(
    async (server: string): Promise<GrantOutcome> => {
      const account = integrationConnectionOf(server);
      if (account === undefined) return GRANT_OUTCOME.REFUSED;
      const { provider } = account;
      // An added account the service no longer holds, its first sign-in having ended, is signed in afresh as a new one; one still waiting is reopened under its own name.
      const ended = statuses.signInOf(server)?.kind !== SIGN_IN.WAITING;
      if (account.place > 1 && !statuses.listed(server) && ended) return add(provider);
      if (grantedBySignIn(provider)) {
        if (!(await connect())) return GRANT_OUTCOME.NOT_OPENED;
        signInBegun(provider);
        return GRANT_OUTCOME.BEGUN;
      }
      const answer = await act(ACT_KIND.INTEGRATIONS_CONNECT, {
        provider,
        ...(server === provider ? undefined : { connection: server }),
      }).catch(() => undefined);
      return outcomeOf(answer, server);
    },
    [act, connect, signInBegun, outcomeOf, add, statuses],
  );

  return { begin, add };
}
