import { SIGN_IN } from "@repo/features/integration-sign-in";
import type { IntegrationConnectView } from "@repo/features/integration-view";
import { INTEGRATION_CALL_FAILURE } from "@repo/features/integration-view";
import {
  INTEGRATION_GRANT,
  INTEGRATION_GRANT_OF,
  type IntegrationProvider,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { ACT_KIND } from "@repo/host/acts";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { actMutation } from "./act-mutations.js";
import { useGitHubConnection } from "./github-connect.js";
import type { IntegrationStatuses } from "./integration-statuses.js";

export const GRANT_OUTCOME = {
  BEGUN: "begun",
  NOT_OPENED: "not-opened",
  REFUSED: "refused",
} as const;

type GrantOutcome = (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME];

export interface IntegrationGrant {
  readonly begin: (server: string) => Promise<GrantOutcome>;
  readonly add: (provider: IntegrationProvider) => Promise<GrantOutcome>;
}

export function grantedBySignIn(provider: IntegrationProvider): boolean {
  return INTEGRATION_GRANT_OF[provider] === INTEGRATION_GRANT.GITHUB_SIGN_IN;
}

export function useIntegrationGrant(statuses: IntegrationStatuses): IntegrationGrant {
  const { mutateAsync: connectIntegration } = useMutation(
    actMutation(ACT_KIND.INTEGRATIONS_CONNECT),
  );
  const { connect } = useGitHubConnection();
  const { signInBegun } = statuses;

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
      const answer = await connectIntegration({ provider, add: true }).catch(() => undefined);
      return outcomeOf(answer, provider);
    },
    [connectIntegration, outcomeOf],
  );

  const begin = useCallback(
    async (server: string): Promise<GrantOutcome> => {
      const account = integrationConnectionOf(server);
      if (account === undefined) return GRANT_OUTCOME.REFUSED;
      const { provider } = account;
      const ended = statuses.signInOf(server)?.kind !== SIGN_IN.WAITING;
      if (account.place > 1 && !statuses.listed(server) && ended) return add(provider);
      if (grantedBySignIn(provider)) {
        if (!(await connect())) return GRANT_OUTCOME.NOT_OPENED;
        signInBegun(provider);
        return GRANT_OUTCOME.BEGUN;
      }
      const answer = await connectIntegration({
        provider,
        ...(server === provider ? undefined : { connection: server }),
      }).catch(() => undefined);
      return outcomeOf(answer, server);
    },
    [connectIntegration, connect, signInBegun, outcomeOf, add, statuses],
  );

  return { begin, add };
}
