import { createAuthClient } from "better-auth/react";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubMark, GoogleMark } from "./account-marks";
import { startSiteAnalytics } from "./analytics";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import {
  CONNECT_QUERY,
  CONNECT_STEP,
  type ConnectStep,
  connectStep,
  returnAddress,
} from "./connect-github-step";
import { LukeMark } from "./SiteChrome";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";
import "./styles.css";

/**
 * connect-github.tsx -- the Connect GitHub page the Mac's Plans tab opens: link GitHub to the Luke account signed in here, with the scope that reads private repositories.
 *
 * A GitHub sign-in already asks for `repo` (`GITHUB_SIGN_IN_SCOPES`), so
 * this page is for an account signed in with Google, or a GitHub row from
 * before sign-in asked for it. It links GitHub through Better Auth's own
 * account link on the same OAuth App, and says plainly what that scope grants. The
 * token GitHub answers is stored on the account, sealed, by Better Auth, and
 * never reaches this page.
 */

const authClient = createAuthClient();

/** The scope linking asks for on top of sign-in's; classic OAuth has no read-only form of it. */
const REPOSITORY_SCOPE = "repo";

const SIGN_IN_PROVIDERS = [SOCIAL_PROVIDER.GOOGLE, SOCIAL_PROVIDER.GITHUB] as const;

function ProviderMark({ provider }: { provider: SocialProvider }): React.JSX.Element {
  return provider === SOCIAL_PROVIDER.GITHUB ? (
    <GitHubMark className="size-[15px] shrink-0" />
  ) : (
    <GoogleMark className="size-[15px] shrink-0" />
  );
}

/** The step once the browser's session has been read; nothing while it is being read. */
function useStep(): ConnectStep | undefined {
  const [step, setStep] = useState<ConnectStep>();
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    void authClient.getSession().then((answer) => {
      setStep(connectStep(answer.data?.user.id, query));
    });
  }, []);
  return step;
}

function Explanation(): React.JSX.Element {
  return (
    <p className="m-0 text-muted-foreground">
      Luke reads the repository you plan against through GitHub&apos;s read-only tools. To see
      private repositories, GitHub asks for its <code>repo</code> permission, which also allows
      writing to every repository you can access. Luke only ever reads.
    </p>
  );
}

function Body({ step }: { step: ConnectStep }): React.JSX.Element {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string>();
  const here = new URL(window.location.href);

  const connect = async () => {
    setPending(true);
    setFailure(undefined);
    const result = await authClient.linkSocial({
      provider: SOCIAL_PROVIDER.GITHUB,
      scopes: [REPOSITORY_SCOPE],
      callbackURL: returnAddress(here, CONNECT_QUERY.CONNECTED),
      errorCallbackURL: returnAddress(here, ""),
    });
    if (result.error) {
      setPending(false);
      setFailure("GitHub could not be opened. Try again.");
    }
  };

  const signIn = async (provider: SocialProvider) => {
    setPending(true);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: returnAddress(here, ""),
    });
    if (result.error) {
      setPending(false);
      setFailure("Sign-in could not start. Try again.");
    }
  };

  const signOut = async () => {
    setPending(true);
    await authClient.signOut();
    window.location.assign(returnAddress(here, ""));
  };

  switch (step.step) {
    case CONNECT_STEP.CONNECTED:
      return (
        <p className="m-0 text-muted-foreground">
          GitHub is connected. Return to Luke to choose a repository.
        </p>
      );
    case CONNECT_STEP.SIGN_IN:
      return (
        <>
          <p className="m-0 text-muted-foreground">
            Sign in to Luke in this browser first, with the account you use on your Mac.
          </p>
          <div className="mt-8 mb-4 grid gap-3">
            {SIGN_IN_PROVIDERS.map((provider) => (
              <button
                key={provider}
                type="button"
                className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
                disabled={pending}
                onClick={() => void signIn(provider)}
              >
                <ProviderMark provider={provider} />
                {`Sign in with ${SOCIAL_PROVIDER_LABEL[provider]}`}
              </button>
            ))}
          </div>
          {failure ? <p className="m-0 text-attention">{failure}</p> : null}
        </>
      );
    case CONNECT_STEP.WRONG_ACCOUNT:
      return (
        <>
          <p className="m-0 text-muted-foreground">
            This browser is signed in to a different Luke account than your Mac. Sign out here, then
            sign in with the account you use on your Mac.
          </p>
          <div className="mt-8 mb-4 grid gap-3">
            <button
              type="button"
              className={AUTH_BUTTON}
              disabled={pending}
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </>
      );
    case CONNECT_STEP.FAILED:
    case CONNECT_STEP.READY:
      return (
        <>
          {step.step === CONNECT_STEP.FAILED ? (
            <p className="mt-0 mb-4 text-attention">{step.message}</p>
          ) : null}
          <Explanation />
          <div className="mt-8 mb-4 grid gap-3">
            <button
              type="button"
              className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
              disabled={pending}
              onClick={() => void connect()}
            >
              <ProviderMark provider={SOCIAL_PROVIDER.GITHUB} />
              {pending ? "Opening…" : "Continue with GitHub"}
            </button>
          </div>
          {failure ? <p className="m-0 text-attention">{failure}</p> : null}
        </>
      );
  }
}

function ConnectGitHub(): React.JSX.Element {
  const step = useStep();
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="auth-title">
        <div
          className="mx-auto mb-5 flex items-center justify-center gap-4 text-foreground"
          aria-hidden="true"
        >
          <GitHubMark className="size-10 shrink-0" />
          <LukeMark className="h-auto w-12 shrink-0" />
        </div>
        <h1 id="auth-title" className={AUTH_TITLE}>
          Connect GitHub
        </h1>
        {step ? <Body step={step} /> : <p className="m-0 text-muted-foreground">Checking…</p>}
      </section>
    </main>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <ConnectGitHub />
  </StrictMode>,
);
