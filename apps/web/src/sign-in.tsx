import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { LANDING_TONE } from "@luke/features/landing-outcome";
import { type SocialProvider, socialProviderFromState } from "@luke/features/sign-in-provider";
import { AuthMark, AuthPage, SIGN_IN_UNFINISHED, SocialProviderButton } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { useEffect, useRef, useState } from "react";
import { captureSiteEvent, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { openLukeFromMac } from "./open-luke";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { mountPrerenderedPage } from "./mount-page";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// desktop authorization request when Google or GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function providerHint(): SocialProvider | undefined {
  return socialProviderFromState(new URLSearchParams(window.location.search).get("state"));
}

/**
 * The page opens on the provider's mark, unbadged while it offers that
 * provider's button. An address that names no provider is a sign-in that
 * cannot go on, so it opens on Luke's mark badged as failed, says so in the
 * consent page's failure wording, and offers Open Luke instead; it drops the
 * closing note, which promises a confirmation that will never come.
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
      mark={<AuthMark provider={provider} tone={provider ? undefined : LANDING_TONE.DANGER} />}
      title={provider ? "Sign in to Luke" : "Luke could not continue"}
      description={provider ? undefined : "Start sign-in again."}
      error={failed ? SIGN_IN_UNFINISHED : undefined}
      action={provider ? undefined : openLukeFromMac()}
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

mountPrerenderedPage(<SignIn />);
