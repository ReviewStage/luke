import "@fontsource-variable/bricolage-grotesque/wght.css";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  SOCIAL_PROVIDER_LABEL,
  type SocialProvider,
  socialProviderFromState,
} from "./sign-in-provider";
import "./styles.css";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// desktop authorization request when Google or GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

function providerHint(): SocialProvider | undefined {
  return socialProviderFromState(new URLSearchParams(window.location.search).get("state"));
}

function SignIn(): React.JSX.Element {
  const [provider] = useState(providerHint);
  const [pending, setPending] = useState<SocialProvider>();
  const [failure, setFailure] = useState<string>();
  const startedFromHint = useRef(false);

  useEffect(() => {
    if (!provider || startedFromHint.current) return;
    startedFromHint.current = true;
    setPending(provider);
    void authClient.signIn.social({ provider }).then((result) => {
      if (!result.error) return;
      setPending(undefined);
      setFailure("Sign-in could not start. Please try again.");
    });
  }, [provider]);

  const begin = async () => {
    if (!provider || pending) return;
    setPending(provider);
    setFailure(undefined);
    const result = await authClient.signIn.social({ provider });
    if (result.error) {
      setPending(undefined);
      setFailure("Sign-in could not start. Please try again.");
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-mark" aria-hidden="true">
          <span />
          <span />
        </div>
        <h1 id="auth-title">Sign in to Luke</h1>
        <p>
          {provider
            ? `Continue with the ${SOCIAL_PROVIDER_LABEL[provider]} account you want Luke to know you by.`
            : "Luke could not verify which provider you chose. Return to Luke and try again."}
        </p>
        {provider ? (
          <div className="auth-actions">
            <button type="button" disabled={pending !== undefined} onClick={() => void begin()}>
              {pending ? "Opening…" : `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`}
            </button>
          </div>
        ) : null}
        {failure ? <p className="auth-error">{failure}</p> : null}
        <small>You can close this window after Luke confirms the sign-in.</small>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <SignIn />
  </StrictMode>,
);
