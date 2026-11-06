import {
  CONNECT_STEP,
  type ConnectStep,
  connectStepFromSearch,
  failedLinkAddress,
  LINK_FAILED,
  linkErrorWords,
} from "@repo/features/connect-github-step";
import { browserClient, browserRefusal } from "@repo/features/contract/browser-client";
import {
  GITHUB_CONNECT_CLAIM,
  GITHUB_CONNECT_PAGE,
  type GitHubConnectClaim,
} from "@repo/features/github-connection-wire";
import { INTEGRATION_NAME, INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import {
  LANDING_OUTCOME,
  LANDING_TONE,
  type LandingOutcome,
  type LandingWords,
  landingWords,
} from "@repo/features/landing-outcome";
import { SOCIAL_PROVIDER } from "@repo/features/sign-in-provider";
import {
  AuthMark,
  AuthPage,
  MARK_PROVIDER,
  SIGN_IN_UNFINISHED,
  SocialSignInChoices,
  TEXT_LINK_LOOK,
  TextLink,
} from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { useEffect, useRef, useState } from "react";
import { landingDescription, useConnectReturn } from "./connect-return";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { mountPrerenderedPage } from "./mount-page";

const authClient = createAuthClient();

const VIEW = { WORKING: "working", SIGN_IN: "sign-in", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | { readonly kind: typeof VIEW.SIGN_IN; readonly title: string; readonly body: string }
  | { readonly kind: typeof VIEW.SAID; readonly words: LandingWords };

const WORKING: View = { kind: VIEW.WORKING };
const GITHUB = INTEGRATION_NAME[INTEGRATION_PROVIDER.GITHUB];
const RELOAD = "Reload this page to try again.";
const SIGN_IN_BODY = `Sign in to the ${PRODUCT_NAME} account you use on your Mac.`;

const CLAIM_UNSETTLED = { SIGNED_OUT: "signed-out", UNANSWERED: "unanswered" } as const;

type ClaimUnsettled = (typeof CLAIM_UNSETTLED)[keyof typeof CLAIM_UNSETTLED];

function asSentence(words: string): string {
  return words.endsWith(".") ? words : `${words}.`;
}

function said(outcome: LandingOutcome, line?: string): View {
  const words = landingWords(outcome, GITHUB);
  return { kind: VIEW.SAID, words: line === undefined ? words : { ...words, line } };
}

function signIn(title: string, body: string): View {
  return { kind: VIEW.SIGN_IN, title, body };
}

async function claimIntent(intent: string): Promise<GitHubConnectClaim | ClaimUnsettled> {
  try {
    return (await browserClient.github.claim({ intent })).claim;
  } catch (failure) {
    return browserRefusal(failure)?.status === 401
      ? CLAIM_UNSETTLED.SIGNED_OUT
      : CLAIM_UNSETTLED.UNANSWERED;
  }
}

async function connect(intent: string): Promise<View> {
  const claim = await claimIntent(intent);
  if (claim === CLAIM_UNSETTLED.SIGNED_OUT)
    return signIn("Sign in to connect GitHub", SIGN_IN_BODY);
  if (claim === GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT) {
    return signIn(
      "Sign in as the account you're connecting",
      `This browser is signed in to a different ${PRODUCT_NAME} account than the one that asked to connect GitHub.`,
    );
  }
  if (claim === GITHUB_CONNECT_CLAIM.EXPIRED) return said(LANDING_OUTCOME.EXPIRED);
  if (claim === CLAIM_UNSETTLED.UNANSWERED) return said(LANDING_OUTCOME.SERVICE_UNREACHABLE);
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
  return WORKING;
}

function settledView(step: ConnectStep): View | undefined {
  if (step.kind === CONNECT_STEP.DONE) return said(LANDING_OUTCOME.CONNECTED);
  if (step.kind === CONNECT_STEP.FAILED) {
    return said(LANDING_OUTCOME.NOT_COMPLETED, linkErrorWords(LINK_FAILED.CONNECT, step.code));
  }
  if (step.kind === CONNECT_STEP.NOTHING) return said(LANDING_OUTCOME.NOTHING_TO_CONNECT);
  return undefined;
}

function viewOf(
  step: ConnectStep,
  sessionStands: boolean,
  connecting: { readonly isIdle: boolean; readonly data: View | undefined },
): View {
  const settled = settledView(step);
  if (settled !== undefined) return settled;
  if (!connecting.isIdle) return connecting.data ?? WORKING;
  if (!sessionStands) return signIn("Sign in to connect GitHub", SIGN_IN_BODY);
  return WORKING;
}

function ConnectGitHub(): React.JSX.Element {
  const [step] = useState(() => connectStepFromSearch(window.location.search));
  const session = authClient.useSession();
  const started = useRef(false);
  const connecting = useMutation({ mutationFn: connect });
  const signInChoices = useSocialSignIn(authClient);
  const view = viewOf(step, session.isPending || Boolean(session.data), connecting);
  const ended = view.kind === VIEW.SAID ? view.words : undefined;
  const { back, open } = useConnectReturn({
    landed: ended !== undefined,
    settled: ended?.tone === LANDING_TONE.COMPLETE,
  });

  useEffect(() => {
    if (step.kind !== CONNECT_STEP.CONNECT || session.isPending || !session.data) return;
    if (started.current) return;
    started.current = true;
    connecting.mutate(step.intent);
  }, [step, session.isPending, session.data, connecting.mutate]);

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
      error={
        view.kind === VIEW.SIGN_IN && signInChoices.failed
          ? { words: SIGN_IN_UNFINISHED, failure: UNREPORTED.NO_REPORTER }
          : undefined
      }
      action={open}
    >
      {view.kind === VIEW.SIGN_IN ? (
        <SocialSignInChoices pending={signInChoices.pending} onPress={signInChoices.begin} />
      ) : null}
    </AuthPage>
  );
}

mountPrerenderedPage(<ConnectGitHub />);
