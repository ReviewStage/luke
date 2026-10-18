import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { type SocialProvider, socialProviderFromState } from "@luke/features/sign-in-provider";
import { AuthPage, ProviderMark } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { captureSiteEvent, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { ConnectionGraphic } from "./connection-graphic";
import { LukeMark } from "./SiteChrome";
import { SocialProviderButton } from "./sign-in-choices";
import "./styles.css";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// desktop authorization request when Google or GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function providerHint(): SocialProvider | undefined {
  return socialProviderFromState(new URLSearchParams(window.location.search).get("state"));
}

/**
 * The card opens on the provider's mark joined to Luke's, or Luke's full mark
 * alone when the address names no provider. The closing note is its own line
 * rather than a run-on: with no provider to continue with there is no action
 * block between it and the copy above.
 */
function SignIn(): React.JSX.Element {
  const [provider] = useState(providerHint);
  const [pending, setPending] = useState<SocialProvider>();
  const [failure, setFailure] = useState<string>();
  const startedFromHint = useRef(false);

  useEffect(() => {
    if (!provider || startedFromHint.current) return;
    startedFromHint.current = true;
    setPending(provider);
    captureSiteEvent(SITE_EVENT.SIGN_IN_START);
    void authClient.signIn.social({ provider }).then((result) => {
      if (!result.error) return;
      setPending(undefined);
      setFailure("Sign-in could not start. Try again.");
    });
  }, [provider]);

  const begin = async () => {
    if (!provider || pending) return;
    setPending(provider);
    setFailure(undefined);
    captureSiteEvent(SITE_EVENT.SIGN_IN_START);
    const result = await authClient.signIn.social({ provider });
    if (result.error) {
      setPending(undefined);
      setFailure("Sign-in could not start. Try again.");
    }
  };

  return (
    <AuthPage
      mark={
        provider ? (
          <ConnectionGraphic
            mark={<ProviderMark provider={provider} className="size-10 shrink-0" />}
          />
        ) : (
          <span className="inline-flex w-13">
            <LukeMark className="h-auto w-full" />
          </span>
        )
      }
      title="Sign in to Luke"
      description={
        provider
          ? undefined
          : "Luke could not verify which provider you chose. Return to Luke and try again."
      }
      error={failure}
      footnote="You can close this window after Luke confirms the sign-in."
    >
      {provider ? (
        <SocialProviderButton provider={provider} pending={pending} onPress={() => void begin()} />
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
