import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubMark, GoogleMark } from "./account-marks";
import { captureSiteEvent, SITE_EVENT, startSiteAnalytics } from "./analytics";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import { LukeMark } from "./SiteChrome";
import {
  SOCIAL_PROVIDER,
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

function previewMode(): boolean {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";
}

function ProviderMark({
  provider,
  className,
}: {
  provider: SocialProvider;
  className?: string;
}): React.JSX.Element {
  return provider === SOCIAL_PROVIDER.GITHUB ? (
    <GitHubMark className={className} />
  ) : (
    <GoogleMark className={className} />
  );
}

function ArrowMark(): React.JSX.Element {
  return (
    <svg
      className="size-6 shrink-0 text-muted-foreground"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ConnectionGraphic({ provider }: { provider: SocialProvider }): React.JSX.Element {
  return (
    <div
      className="mx-auto mb-5 flex items-center justify-center gap-4 text-foreground"
      aria-hidden="true"
    >
      <ProviderMark provider={provider} className="size-10 shrink-0" />
      <ArrowMark />
      <LukeMark className="h-auto w-12 shrink-0" />
    </div>
  );
}

function SignIn(): React.JSX.Element {
  const [provider] = useState(providerHint);
  const [preview] = useState(previewMode);
  const [pending, setPending] = useState<SocialProvider>();
  const [failure, setFailure] = useState<string>();
  const startedFromHint = useRef(false);

  useEffect(() => {
    if (preview || !provider || startedFromHint.current) return;
    startedFromHint.current = true;
    setPending(provider);
    captureSiteEvent(SITE_EVENT.SIGN_IN_START);
    void authClient.signIn.social({ provider }).then((result) => {
      if (!result.error) return;
      setPending(undefined);
      setFailure("Sign-in could not start. Try again.");
    });
  }, [provider, preview]);

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
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="auth-title">
        {/* The full mark, not a pair of dots: the card is the one thing on the
            page, so it carries the same face the product and the landing page
            wear. */}
        {provider ? (
          <ConnectionGraphic provider={provider} />
        ) : (
          <div className="inline-flex w-13" aria-hidden="true">
            <LukeMark className="h-auto w-full" />
          </div>
        )}
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
              className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
              disabled={pending !== undefined}
              onClick={() => void begin()}
            >
              <ProviderMark provider={provider} className="size-[15px] shrink-0" />
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

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <SignIn />
  </StrictMode>,
);
