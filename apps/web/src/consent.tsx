import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { LANDING_CLOSE_TAB, LANDING_TONE } from "@repo/features/landing-outcome";
import { oauthRedirectDestination, oauthScopeLines } from "@repo/features/oauth-consent";
import { AuthMark, AuthPage, CONSENT_ANSWER, type ConsentAnswer, ConsentCard } from "@repo/ui";
import { createAuthClient } from "better-auth/react";
import { useEffect, useState } from "react";
import { completeSiteSignIn, startSiteAnalytics } from "./analytics";
import "./styles.css";
import { readingWords } from "@repo/features/words";
import { mountPrerenderedPage } from "./mount-page";

// The provider client forwards the signed authorization on this page's
// address as `oauth_query` with every answer, and follows the redirect the
// answer comes back with, to the client's own redirect.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

/**
 * The authorization the server signed onto this page's address: the client
 * asking, the scopes it asks, and where its answer goes. Better Auth's
 * consent page reads these off its address (its `consentPage` docs), and the
 * answer is refused if any of them was changed.
 */
const AUTHORIZATION = {
  CLIENT_ID: "client_id",
  SCOPE: "scope",
  REDIRECT_URI: "redirect_uri",
} as const;

/** What the card names a client that registered no name. */
const UNNAMED_CLIENT = "An unnamed app";

/** Where the page stands: reading the request, asking the member, or unable to go on. */
const CONSENT_STEP = {
  READING: "reading",
  ASKING: "asking",
  FAILED: "failed",
} as const;

/** The request as the card says it. */
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

/** The account the browser is signed in as, or nothing where it is signed out or the read failed. */
const signedIn = authClient
  .getSession()
  .then((answer) => answer.data)
  .catch(() => null);

/**
 * The request this page asks about: the client's registered name, as the
 * provider's public client read answers it, the account, and the scopes and
 * redirect the signed authorization names; undefined where any is missing.
 */
async function readRequest(): Promise<ConsentRequest | undefined> {
  const authorization = new URLSearchParams(window.location.search);
  const clientId = authorization.get(AUTHORIZATION.CLIENT_ID);
  const redirectUri = authorization.get(AUTHORIZATION.REDIRECT_URI);
  if (clientId === null || redirectUri === null) return undefined;
  const [session, client] = await Promise.all([
    signedIn,
    authClient.oauth2.publicClient({ query: { client_id: clientId } }),
  ]);
  if (!session || !client.data) return undefined;
  return {
    client: client.data.client_name ?? UNNAMED_CLIENT,
    account: session.user.email,
    abilities: oauthScopeLines(authorization.get(AUTHORIZATION.SCOPE) ?? ""),
    destination: oauthRedirectDestination(redirectUri),
  };
}

/** What the page says while it reads the request, and once it cannot go on. */
const CONSENT_WORDS = {
  READING: `${readingWords("the request")}…`,
  FAILED: "The agent was not connected",
  START_AGAIN: `Start again from the agent. ${LANDING_CLOSE_TAB}`,
} as const;

/**
 * The page opens on the MCP glyph while it reads the request, then asks
 * the member through the consent card until they answer. Allow and Deny
 * each go to the client's redirect, with a code or with `access_denied`;
 * a request it cannot read, or an answer the server refuses, badges the
 * glyph as failed, as a connection page's provider is, and says to start
 * again from the agent, which is where the flow began, so it offers no way
 * into the app. It names no agent, since a request it could not read has
 * no name to give.
 */
function Consent(): React.JSX.Element {
  const [state, setState] = useState<ConsentState>({ step: CONSENT_STEP.READING });
  const [answering, setAnswering] = useState<ConsentAnswer>();
  useEffect(() => {
    void readRequest().then((request) =>
      setState(
        request === undefined
          ? { step: CONSENT_STEP.FAILED }
          : { step: CONSENT_STEP.ASKING, request },
      ),
    );
  }, []);

  const answer = async (given: ConsentAnswer) => {
    if (answering !== undefined) return;
    setAnswering(given);
    const accept = given === CONSENT_ANSWER.ALLOW;
    // Note that the desktop's client skips this page, so its hand-off
    // (`desktop-session.tsx`) is where a sign-in is usually counted; one
    // that passes both is counted once, by its session. It is counted
    // before the answer goes, because the browser leaves as it lands.
    if (accept) await completeSiteSignIn(signedIn);
    const result = await authClient.oauth2.consent({ accept });
    if (result.error) setState({ step: CONSENT_STEP.FAILED });
  };

  if (state.step === CONSENT_STEP.ASKING) {
    return (
      <ConsentCard
        {...state.request}
        answering={answering}
        onAnswer={(given) => void answer(given)}
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
