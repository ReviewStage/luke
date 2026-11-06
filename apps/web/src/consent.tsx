import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { LANDING_CLOSE_TAB, LANDING_TONE } from "@repo/features/landing-outcome";
import { oauthRedirectDestination, oauthScopeLines } from "@repo/features/oauth-consent";
import { QUERY_ROOT } from "@repo/panel/query-keys";
import { AuthMark, AuthPage, CONSENT_ANSWER, type ConsentAnswer, ConsentCard } from "@repo/ui";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { useState } from "react";
import { completeSiteSignIn, startSiteAnalytics } from "./analytics";
import "./styles.css";
import { readingWords } from "@repo/features/words";
import { mountPrerenderedPage } from "./mount-page";

const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

const AUTHORIZATION = {
  CLIENT_ID: "client_id",
  SCOPE: "scope",
  REDIRECT_URI: "redirect_uri",
} as const;

const UNNAMED_CLIENT = "An unnamed app";

const CONSENT_STEP = {
  READING: "reading",
  ASKING: "asking",
  FAILED: "failed",
} as const;

interface ConsentRequest {
  readonly client: string;
  readonly account: string;
  readonly abilities: readonly string[];
  readonly destination: string;
}

type ConsentState =
  | { readonly step: typeof CONSENT_STEP.READING }
  | { readonly step: typeof CONSENT_STEP.ASKING; readonly request: ConsentRequest }
  | { readonly step: typeof CONSENT_STEP.FAILED };

const signedIn = authClient
  .getSession()
  .then((answer) => answer.data)
  .catch(() => null);

function consentRequestQuery(authorization: URLSearchParams) {
  const clientId = authorization.get(AUTHORIZATION.CLIENT_ID);
  const redirectUri = authorization.get(AUTHORIZATION.REDIRECT_URI);
  const scope = authorization.get(AUTHORIZATION.SCOPE) ?? "";
  return queryOptions({
    queryKey: [QUERY_ROOT.CONSENT_REQUEST, clientId, redirectUri, scope],
    queryFn: async (): Promise<ConsentRequest | null> => {
      if (clientId === null || redirectUri === null) return null;
      const [session, client] = await Promise.all([
        signedIn,
        authClient.oauth2.publicClient({ query: { client_id: clientId } }),
      ]);
      if (!session || !client.data) return null;
      return {
        client: client.data.client_name ?? UNNAMED_CLIENT,
        account: session.user.email,
        abilities: oauthScopeLines(scope),
        destination: oauthRedirectDestination(redirectUri),
      };
    },
    staleTime: Infinity,
    retry: false,
  });
}

async function sendAnswer(given: ConsentAnswer): Promise<void> {
  const accept = given === CONSENT_ANSWER.ALLOW;
  if (accept) await completeSiteSignIn(signedIn);
  const result = await authClient.oauth2.consent({ accept });
  if (result.error) throw new Error("The consent answer was refused.");
}

const CONSENT_WORDS = {
  READING: `${readingWords("the request")}…`,
  FAILED: "The agent was not connected",
  START_AGAIN: `Start again from the agent. ${LANDING_CLOSE_TAB}`,
} as const;

function Consent(): React.JSX.Element {
  const [authorization] = useState(() => new URLSearchParams(window.location.search));
  const request = useQuery(consentRequestQuery(authorization));
  const answering = useMutation({ mutationFn: sendAnswer });
  const state: ConsentState =
    request.isError || request.data === null || answering.isError
      ? { step: CONSENT_STEP.FAILED }
      : request.data === undefined
        ? { step: CONSENT_STEP.READING }
        : { step: CONSENT_STEP.ASKING, request: request.data };

  const answer = (given: ConsentAnswer) => {
    if (!answering.isIdle) return;
    answering.mutate(given);
  };

  if (state.step === CONSENT_STEP.ASKING) {
    return (
      <ConsentCard
        {...state.request}
        answering={answering.isIdle ? undefined : answering.variables}
        onAnswer={answer}
      />
    );
  }
  const failed = state.step === CONSENT_STEP.FAILED;
  return (
    <AuthPage
      mark={<AuthMark mcpClient tone={failed ? LANDING_TONE.DANGER : undefined} />}
      title={failed ? CONSENT_WORDS.FAILED : CONSENT_WORDS.READING}
      description={failed ? CONSENT_WORDS.START_AGAIN : undefined}
    />
  );
}

startSiteAnalytics();

mountPrerenderedPage(<Consent />);
