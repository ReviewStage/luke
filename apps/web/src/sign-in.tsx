import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
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
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="auth-title">
        {/* The full mark, not a pair of dots: the card is the one thing on the
            page, so it carries the same face the product and the landing page
            wear. */}
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 id="auth-title" className={AUTH_TITLE}>
          Sign in to Luke
        </h1>
        <p className="m-0 text-muted-foreground">
          {provider
            ? `Continue with the ${SOCIAL_PROVIDER_LABEL[provider]} account you want Luke to know you by.`
            : "Luke could not verify which provider you chose. Return to Luke and try again."}
        </p>
        {provider ? (
          <div className="mt-8 mb-4 grid gap-3">
            <button
              type="button"
              className={AUTH_BUTTON}
              disabled={pending !== undefined}
              onClick={() => void begin()}
            >
              {pending ? "Opening…" : `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`}
            </button>
          </div>
        ) : null}
        {failure ? <p className="m-0 text-attention">{failure}</p> : null}
        {/* Its own line rather than a run-on: with no provider to continue
            with there is no action block between it and the copy above. */}
        <small className="mt-4 block text-muted-foreground">
          You can close this window after Luke confirms the sign-in.
        </small>
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
