import {
  CONNECT_STEP,
  type ConnectStep,
  connectStepFromSearch,
  failedLinkAddress,
  LINK_FAILED,
  linkErrorWords,
} from "@luke/features/connect-github-step";
import { browserClient, browserRefusal } from "@luke/features/contract/browser-client";
import {
  GITHUB_CONNECT_CLAIM,
  GITHUB_CONNECT_PAGE,
  type GitHubConnectClaim,
} from "@luke/features/github-connection-wire";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  LANDING_OUTCOME,
  LANDING_TONE,
  type LandingOutcome,
  type LandingWords,
  landingWords,
} from "@luke/features/landing-outcome";
import { SOCIAL_PROVIDER } from "@luke/features/sign-in-provider";
import {
  AuthMark,
  AuthPage,
  MARK_PROVIDER,
  SIGN_IN_UNFINISHED,
  SocialSignInChoices,
  TEXT_LINK_LOOK,
  TextLink,
} from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { useEffect, useRef, useState } from "react";
import { landingDescription, useConnectReturn } from "./connect-return";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { mountPrerenderedPage } from "./mount-page";

/**
 * connect-github.tsx -- the page that connects the signed-in account's GitHub, on the browser's own session.
 *
 * Better Auth links a provider only for a browser session (`linkSocial`),
 * and the Mac holds an OAuth token rather than one, so the Mac opens this
 * page. With an intent, the page claims it on the browser's session, which
 * must be the account the Mac asked for, and only then asks Better Auth to
 * link GitHub; Better Auth returns the browser here with `done=1` or
 * `error=1`. Disconnecting is the Mac's own, under its Better Auth session
 * (`POST /api/github/disconnect`), so no page acts on whichever account a
 * browser happens to be signed in to. A browser with no session signs in and
 * comes back to the same address. Nothing of the address is drawn: how the
 * connect ended is said in every landing's words
 * (`@luke/features/landing-outcome`), and an error by our words for its code,
 * or by Better Auth's own. Once the page says how it ended it offers Open
 * Luke (`connect-return.ts`), and a connect the web app started closes where
 * that is `done=1`; never while the page is still on its way to GitHub.
 */

const authClient = createAuthClient();

/** What the page shows: the work under way, a sign-in to choose, or how the work settled. */
const VIEW = { WORKING: "working", SIGN_IN: "sign-in", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | { readonly kind: typeof VIEW.SIGN_IN; readonly title: string; readonly body: string }
  | { readonly kind: typeof VIEW.SAID; readonly words: LandingWords };

const WORKING: View = { kind: VIEW.WORKING };
const GITHUB = INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB];
const RELOAD = "Reload this page to try again.";
const SIGN_IN_BODY = "Sign in to the Luke account you use on your Mac.";

/** A claim that did not settle: the browser has no session, or the service gave no answer. */
const CLAIM_UNSETTLED = { SIGNED_OUT: "signed-out", UNANSWERED: "unanswered" } as const;

type ClaimUnsettled = (typeof CLAIM_UNSETTLED)[keyof typeof CLAIM_UNSETTLED];

/** Words closed with a full stop, so another sentence can follow them. */
function asSentence(words: string): string {
  return words.endsWith(".") ? words : `${words}.`;
}

/** How the connect ended, in every landing's words, its line given in place of the outcome's where `line` is. */
function said(outcome: LandingOutcome, line?: string): View {
  const words = landingWords(outcome, GITHUB);
  return { kind: VIEW.SAID, words: line === undefined ? words : { ...words, line } };
}

function signIn(title: string, body: string): View {
  return { kind: VIEW.SIGN_IN, title, body };
}

/** The intent claimed on this browser's session: how it settled, or why it did not. */
async function claimIntent(intent: string): Promise<GitHubConnectClaim | ClaimUnsettled> {
  try {
    return (await browserClient.github.claim({ intent })).claim;
  } catch (failure) {
    return browserRefusal(failure)?.status === 401
      ? CLAIM_UNSETTLED.SIGNED_OUT
      : CLAIM_UNSETTLED.UNANSWERED;
  }
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
  if (claim === GITHUB_CONNECT_CLAIM.EXPIRED) return said(LANDING_OUTCOME.EXPIRED);
  if (claim === CLAIM_UNSETTLED.UNANSWERED) return said(LANDING_OUTCOME.LUKE_UNREACHABLE);
  const linked = await authClient.linkSocial({
    provider: SOCIAL_PROVIDER.GITHUB,
    callbackURL: `${GITHUB_CONNECT_PAGE.PATH}?${GITHUB_CONNECT_PAGE.DONE_PARAM}=${GITHUB_CONNECT_PAGE.FLAG}`,
    errorCallbackURL: failedLinkAddress(intent),
  });
  if (linked.error) {
    return said(
      LANDING_OUTCOME.NOT_COMPLETED,
      `${asSentence(linkErrorWords(LINK_FAILED.CONNECT, linked.error.code, linked.error.message))} ${RELOAD}`,
    );
  }
  // Better Auth's client is sending the browser on to GitHub.
  return WORKING;
}

/** What the page shows before it knows whether the browser is signed in, or with no work to do. */
function settledView(step: ConnectStep): View | undefined {
  if (step.kind === CONNECT_STEP.DONE) return said(LANDING_OUTCOME.CONNECTED);
  if (step.kind === CONNECT_STEP.FAILED) {
    return said(LANDING_OUTCOME.NOT_COMPLETED, linkErrorWords(LINK_FAILED.CONNECT, step.code));
  }
  if (step.kind === CONNECT_STEP.NOTHING) return said(LANDING_OUTCOME.NOTHING_TO_CONNECT);
  return undefined;
}

/**
 * The page opens on GitHub's mark, badged once the connect has ended: the
 * title says where the connect stands, the description what to do about it,
 * with a link that offers a refused connect again, the body holds the
 * providers when a sign-in comes first, and Open Luke goes back once it
 * ended. A sign-in that cannot start is said in the page's alert region
 * rather than under the choices.
 */
function ConnectGitHub(): React.JSX.Element {
  const [step] = useState(() => connectStepFromSearch(window.location.search));
  const [view, setView] = useState<View>(() => settledView(step) ?? WORKING);
  const session = authClient.useSession();
  const started = useRef(false);
  const signInChoices = useSocialSignIn(authClient);
  const ended = view.kind === VIEW.SAID ? view.words : undefined;
  const { back, open } = useConnectReturn({
    landed: ended !== undefined,
    settled: ended?.tone === LANDING_TONE.COMPLETE,
  });

  useEffect(() => {
    if (step.kind !== CONNECT_STEP.CONNECT || session.isPending || started.current) return;
    if (!session.data) {
      setView(signIn("Sign in to connect GitHub", SIGN_IN_BODY));
      return;
    }
    // Note that the work runs once per load: a reload claims the intent again and retries.
    started.current = true;
    void connect(step.intent).then(setView);
  }, [step, session.isPending, session.data]);

  const retry = step.kind === CONNECT_STEP.FAILED ? step.retry : undefined;
  const body =
    view.kind === VIEW.SIGN_IN
      ? view.body
      : ended === undefined
        ? undefined
        : landingDescription(ended, back);
  return (
    <AuthPage
      mark={<AuthMark provider={MARK_PROVIDER.GITHUB} tone={ended?.tone} />}
      title={
        view.kind === VIEW.WORKING
          ? "Connecting GitHub…"
          : view.kind === VIEW.SIGN_IN
            ? view.title
            : view.words.title
      }
      description={
        body === undefined ? undefined : (
          <>
            {body}
            {retry === undefined ? null : (
              <>
                {" "}
                <TextLink href={retry} look={TEXT_LINK_LOOK.UNDERLINED}>
                  Try again
                </TextLink>
              </>
            )}
          </>
        )
      }
      error={view.kind === VIEW.SIGN_IN && signInChoices.failed ? SIGN_IN_UNFINISHED : undefined}
      action={open}
    >
      {view.kind === VIEW.SIGN_IN ? (
        <SocialSignInChoices pending={signInChoices.pending} onPress={signInChoices.begin} />
      ) : null}
    </AuthPage>
  );
}

mountPrerenderedPage(<ConnectGitHub />);
