import "@fontsource-variable/bricolage-grotesque/wght.css";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

// The provider client forwards the authorization server's signed `oauth_query`
// through social sign-in, so the new Better Auth session resumes this exact
// desktop authorization request when Google or GitHub returns.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] });

const SOCIAL_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

type SocialProvider = (typeof SOCIAL_PROVIDER)[keyof typeof SOCIAL_PROVIDER];

function providerHint(): SocialProvider | undefined {
  const state = new URLSearchParams(window.location.search).get("state");
  if (state?.startsWith(`${SOCIAL_PROVIDER.GOOGLE}.`)) return SOCIAL_PROVIDER.GOOGLE;
  if (state?.startsWith(`${SOCIAL_PROVIDER.GITHUB}.`)) return SOCIAL_PROVIDER.GITHUB;
  return undefined;
}

function SignIn(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider>();
  const [failure, setFailure] = useState<string>();
  const startedFromHint = useRef(false);

  useEffect(() => {
    const provider = providerHint();
    if (!provider || startedFromHint.current) return;
    startedFromHint.current = true;
    setPending(provider);
    void authClient.signIn.social({ provider }).then((result) => {
      if (!result.error) return;
      setPending(undefined);
      setFailure("Sign-in could not start. Please try again.");
    });
  }, []);

  const begin = async (provider: SocialProvider) => {
    if (pending) return;
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
        <p>Choose the account you want Luke to know you by.</p>
        <div className="auth-actions">
          <button
            type="button"
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GOOGLE)}
          >
            {pending === SOCIAL_PROVIDER.GOOGLE ? "Opening Google…" : "Continue with Google"}
          </button>
          <button
            type="button"
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GITHUB)}
          >
            {pending === SOCIAL_PROVIDER.GITHUB ? "Opening GitHub…" : "Continue with GitHub"}
          </button>
        </div>
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
