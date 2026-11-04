import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { type SocialProvider, socialProviderFromState } from "@repo/features/sign-in-provider";
import {
  AuthMark,
  AuthPage,
  SIGN_IN_UNFINISHED,
  SocialProviderButton,
  SocialSignInCard,
} from "@repo/ui";
import { createAuthClient } from "better-auth/react";
import { useEffect, useRef, useState } from "react";
import { captureSiteEvent, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { mountPrerenderedPage } from "./mount-page";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// authorization request, the desktop's or another client's, when Google or
// GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function providerHint(): SocialProvider | undefined {
  return socialProviderFromState(new URLSearchParams(window.location.search).get("state"));
}

/**
 * The page opens on the provider's mark, unbadged while it offers that
 * provider's button, where the desktop's `state` names the provider its card
 * chose, and starts that sign-in at once. An authorization whose `state`
 * names no provider, another client's, opens on the app's mark and offers
 * every provider; either sign-in resumes the authorization, which goes on to
 * consent. It drops the closing note there, since the browser goes on to
 * that client rather than back to the app.
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

  if (!provider) {
    return (
      <SocialSignInCard
        mark={<AuthMark />}
        title={`Sign in to ${PRODUCT_NAME}`}
        pending={pending}
        failed={failed ? UNREPORTED.NO_REPORTER : undefined}
        onPress={begin}
      />
    );
  }
  return (
    <AuthPage
      mark={<AuthMark provider={provider} />}
      title={`Sign in to ${PRODUCT_NAME}`}
      error={failed ? { words: SIGN_IN_UNFINISHED, failure: UNREPORTED.NO_REPORTER } : undefined}
      footnote={`You can close this window after ${PRODUCT_NAME} confirms the sign-in.`}
    >
      <SocialProviderButton provider={provider} pending={pending} onPress={() => begin(provider)} />
    </AuthPage>
  );
}

startSiteAnalytics();

mountPrerenderedPage(<SignIn />);
