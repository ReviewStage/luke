import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import {
  GITHUB_CONNECT_CLAIM,
  GITHUB_CONNECT_PAGE,
  type GitHubConnectClaim,
  githubConnectClaimAnswerSchema,
} from "@sidecar/hosted/github-connection-wire";
import { createAuthClient } from "better-auth/react";
import { Option, Schema } from "effect";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { GitHubMark, GoogleMark } from "./account-marks";
import { AUTH_BUTTON, AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import {
  CONNECT_STEP,
  type ConnectStep,
  connectStepFromSearch,
  failedLinkAddress,
  LINK_FAILED,
  linkErrorWords,
} from "./connect-github-step";
import { ConnectionGraphic } from "./connection-graphic";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";
import "./styles.css";

/**
 * connect-github.tsx -- the page that connects or disconnects the signed-in account's GitHub, on the browser's own session.
 *
 * Better Auth links a provider only for a browser session (`linkSocial`),
 * and the Mac holds an OAuth token rather than one, so the Mac opens this
 * page. With an intent, the page claims it on the browser's session, which
 * must be the account the Mac asked for, and only then asks Better Auth to
 * link GitHub; Better Auth returns the browser here with `done=1` or
 * `error=1`. With `disconnect=1`, it asks Better Auth to unlink GitHub, which
 * wants a fresh session, so a refusal for that sends the browser through
 * sign-in again. A browser with no session signs in and comes back to the
 * same address. Nothing of the address is drawn: an error is drawn by our
 * words for its code, or by Better Auth's own.
 */

const authClient = createAuthClient();

const decodeClaim = Schema.decodeUnknownOption(githubConnectClaimAnswerSchema);

const PROVIDER_MARK = {
  [SOCIAL_PROVIDER.GOOGLE]: GoogleMark,
  [SOCIAL_PROVIDER.GITHUB]: GitHubMark,
} as const satisfies Record<SocialProvider, typeof GitHubMark>;

/** HTTP statuses Better Auth refuses a missing or stale session with. */
const SESSION_REFUSED = new Set([401, 403]);

/** What the card shows: the work under way, a sign-in to choose, or how the work settled. */
const VIEW = { WORKING: "working", SIGN_IN: "sign-in", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | {
      readonly kind: typeof VIEW.SIGN_IN | typeof VIEW.SAID;
      readonly title: string;
      readonly body: string;
    };

const WORKING: View = { kind: VIEW.WORKING };
const RETURN = "Return to Luke. You can close this tab.";
const RETRY_CONNECT = "Reload this page to try again, or return to Luke and choose Connect GitHub.";
const SIGN_IN_BODY = "Sign in to the Luke account you use on your Mac, and you'll come back here.";

/** A claim that did not settle: the browser has no session, or the service gave no answer. */
const CLAIM_UNSETTLED = { SIGNED_OUT: "signed-out", UNANSWERED: "unanswered" } as const;

type ClaimUnsettled = (typeof CLAIM_UNSETTLED)[keyof typeof CLAIM_UNSETTLED];

/** Words closed with a full stop, so another sentence can follow them. */
function asSentence(words: string): string {
  return words.endsWith(".") ? words : `${words}.`;
}

function said(title: string, body: string): View {
  return { kind: VIEW.SAID, title, body };
}

function signIn(title: string, body: string): View {
  return { kind: VIEW.SIGN_IN, title, body };
}

/** The intent claimed on this browser's session: how it settled, or why it did not. */
async function claimIntent(intent: string): Promise<GitHubConnectClaim | ClaimUnsettled> {
  const response = await fetch(HOSTED_SERVICE_PATH.GITHUB_CONNECT_CLAIM, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ intent }),
  }).catch(() => undefined);
  if (response === undefined) return CLAIM_UNSETTLED.UNANSWERED;
  if (response.status === 401) return CLAIM_UNSETTLED.SIGNED_OUT;
  if (!response.ok) return CLAIM_UNSETTLED.UNANSWERED;
  const answer = decodeClaim(await response.json().catch(() => undefined));
  return Option.isSome(answer) ? answer.value.claim : CLAIM_UNSETTLED.UNANSWERED;
}

/** Carries out a connect: claims the intent, then hands the browser to Better Auth's link. */
async function connect(intent: string): Promise<View> {
  const claim = await claimIntent(intent);
  if (claim === CLAIM_UNSETTLED.SIGNED_OUT)
    return signIn("Sign in to connect GitHub", SIGN_IN_BODY);
  if (claim === GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT) {
    return signIn(
      "Sign in as the account you're connecting",
      "This browser is signed in to a different Luke account than the one that asked to connect GitHub.",
    );
  }
  if (claim === GITHUB_CONNECT_CLAIM.EXPIRED) {
    return said("This link has expired", "Return to Luke and choose Connect GitHub again.");
  }
  if (claim === CLAIM_UNSETTLED.UNANSWERED) {
    return said("Luke could not be reached", "Reload this page to try again.");
  }
  const linked = await authClient.linkSocial({
    provider: SOCIAL_PROVIDER.GITHUB,
    callbackURL: `${GITHUB_CONNECT_PAGE.PATH}?${GITHUB_CONNECT_PAGE.DONE_PARAM}=${GITHUB_CONNECT_PAGE.FLAG}`,
    errorCallbackURL: failedLinkAddress(intent),
  });
  if (linked.error) {
    return said(
      "GitHub was not connected",
      `${asSentence(linkErrorWords(LINK_FAILED.CONNECT, linked.error.code, linked.error.message))} ${RETRY_CONNECT}`,
    );
  }
  // Better Auth's client is sending the browser on to GitHub.
  return WORKING;
}

/** A refusal on the way to a disconnect: a missing or stale session is sent to sign in again, and anything else is said. */
function disconnectRefused(error: {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
}): View {
  if (SESSION_REFUSED.has(error.status)) {
    return signIn(
      "Sign in again to disconnect GitHub",
      "Disconnecting GitHub needs a recent sign-in.",
    );
  }
  return said(
    "GitHub is still connected",
    linkErrorWords(LINK_FAILED.DISCONNECT, error.code, error.message),
  );
}

/**
 * Carries out a disconnect: Better Auth unlinks an account by its own record's
 * id, which `listAccounts` answers, so the session's GitHub account is found
 * there first; none linked is already disconnected.
 */
async function disconnect(): Promise<View> {
  const accounts = await authClient.listAccounts();
  if (accounts.error) return disconnectRefused(accounts.error);
  const github = accounts.data.find((account) => account.providerId === SOCIAL_PROVIDER.GITHUB);
  if (github === undefined) return said("GitHub disconnected", RETURN);
  const unlinked = await authClient.unlinkAccount({ accountId: github.id });
  if (!unlinked.error) return said("GitHub disconnected", RETURN);
  return disconnectRefused(unlinked.error);
}

/** What the page shows before it knows whether the browser is signed in, or with no work to do. */
function settledView(step: ConnectStep): View | undefined {
  if (step.kind === CONNECT_STEP.DONE) return said("GitHub connected", RETURN);
  if (step.kind === CONNECT_STEP.FAILED) {
    return said("GitHub was not connected", linkErrorWords(LINK_FAILED.CONNECT, step.code));
  }
  if (step.kind === CONNECT_STEP.NOTHING) {
    return said("Nothing to connect", "Return to Luke and choose Connect GitHub.");
  }
  return undefined;
}

function SignInChoices(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);
  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    // A sign-in returns the browser to this same address, to carry on where it was.
    const result = await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.pathname}${window.location.search}`,
    });
    if (!result.error) return;
    setPending(undefined);
    setFailed(true);
  };
  return (
    <>
      <div className="mt-8 mb-4 grid gap-3">
        {Object.values(SOCIAL_PROVIDER).map((provider) => {
          const Mark = PROVIDER_MARK[provider];
          return (
            <button
              key={provider}
              type="button"
              className={`${AUTH_BUTTON} inline-flex items-center justify-center gap-2.5`}
              disabled={pending !== undefined}
              onClick={() => void begin(provider)}
            >
              <Mark className="size-[15px] shrink-0" />
              {pending === provider
                ? "Opening…"
                : `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`}
            </button>
          );
        })}
      </div>
      {failed ? (
        <p className="m-0 text-attention" role="alert">
          Sign-in could not start. Try again.
        </p>
      ) : null}
    </>
  );
}

function ConnectGitHub(): React.JSX.Element {
  const [step] = useState(() => connectStepFromSearch(window.location.search));
  const [view, setView] = useState<View>(() => settledView(step) ?? WORKING);
  const session = authClient.useSession();
  const started = useRef(false);

  useEffect(() => {
    if (settledView(step) !== undefined || session.isPending || started.current) return;
    if (!session.data) {
      setView(
        signIn(
          step.kind === CONNECT_STEP.CONNECT
            ? "Sign in to connect GitHub"
            : "Sign in to disconnect GitHub",
          SIGN_IN_BODY,
        ),
      );
      return;
    }
    // Note that the work runs once per load: a reload claims the intent again and retries.
    started.current = true;
    const work = step.kind === CONNECT_STEP.CONNECT ? connect(step.intent) : disconnect();
    void work.then(setView);
  }, [step, session.isPending, session.data]);

  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="connect-title">
        <ConnectionGraphic mark={<GitHubMark className="size-10 shrink-0" />} />
        <h1 id="connect-title" className={AUTH_TITLE}>
          {view.kind !== VIEW.WORKING
            ? view.title
            : step.kind === CONNECT_STEP.DISCONNECT
              ? "Disconnecting GitHub…"
              : "Connecting GitHub…"}
        </h1>
        {view.kind === VIEW.WORKING ? null : (
          <p className="m-0 text-muted-foreground">{view.body}</p>
        )}
        {view.kind === VIEW.SIGN_IN ? <SignInChoices /> : null}
        {step.kind === CONNECT_STEP.FAILED && step.retry !== undefined ? (
          <a className="font-semibold text-foreground underline" href={step.retry}>
            Try again
          </a>
        ) : null}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <ConnectGitHub />
  </StrictMode>,
);
