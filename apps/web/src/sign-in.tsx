import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { type SocialProvider, socialProviderFromState } from "@luke/features/sign-in-provider";
import {
  AuthPage,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SIGN_IN_FAILURE,
  SocialProviderButton,
} from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureSiteEvent, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { ConnectionGraphic } from "./connection-graphic";
import { LukeMark } from "./SiteChrome";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// desktop authorization request when Google or GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function providerHint(): SocialProvider | undefined {
  return socialProviderFromState(new URLSearchParams(window.location.search).get("state"));
}

/**
 * The card opens on the provider's mark joined to Luke's. An address that
 * names no provider is a sign-in that cannot go on, so it wears Luke's full
 * mark alone and the consent page's failure wording, and drops the closing
 * note, which promises a confirmation that will never come.
 */
function SignIn(): React.JSX.Element {
  const [provider] = useState(providerHint);
  const { pending, failed, begin } = useSocialSignIn(authClient, {
    callbackURL: () => undefined,
    onBegin: () => captureSiteEvent(SITE_EVENT.SIGN_IN_START),
  });
  const startedFromHint = useRef(false);

  useEffect(() => {
    if (!provider || startedFromHint.current) return;
    startedFromHint.current = true;
    begin(provider);
  }, [provider, begin]);

  return (
    <AuthPage
      mark={
        provider ? (
          <ConnectionGraphic
            mark={<ProviderMark provider={provider} size={PROVIDER_MARK_SIZE.TILE} />}
          />
        ) : (
          <span className="inline-flex w-13">
            <LukeMark className="h-auto w-full" />
          </span>
        )
      }
      title={provider ? "Sign in to Luke" : "Luke could not continue"}
      description={provider ? undefined : "Return to Luke and start sign-in again."}
      error={failed ? SIGN_IN_FAILURE : undefined}
      footnote={provider ? "You can close this window after Luke confirms the sign-in." : undefined}
    >
      {provider ? (
        <SocialProviderButton
          provider={provider}
          pending={pending}
          onPress={() => begin(provider)}
        />
      ) : null}
    </AuthPage>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <SignIn />
  </StrictMode>,
);
