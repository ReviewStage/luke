import {
  type DesktopSessionPageQuery,
  desktopSessionPageQuery,
  desktopSessionReturnUrl,
} from "@repo/features/desktop-session-wire";
import { LANDING_TONE } from "@repo/features/landing-outcome";
import { AuthMark, AuthPage, SIGN_IN_UNFINISHED, SocialSignInChoices } from "@repo/ui";
import { useMutation } from "@tanstack/react-query";
import { createAuthClient } from "better-auth/react";
import { Schema } from "effect";
import { useEffect, useRef } from "react";
import { completeSiteSignIn, signInCountDeadline, startSiteAnalytics } from "./analytics";
import { openAppFromMac } from "./open-app";
import { useSocialSignIn } from "./sign-in-choices";
import "./styles.css";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { UNREPORTED } from "@repo/ui/reported-failure";
import { mountPrerenderedPage } from "./mount-page";

const authClient = createAuthClient();

const TRANSFER_PATH = "/electron/transfer-user";

const TransferAnswer = Schema.Struct({ electron_authorization_code: Schema.String });

const SIGNED_OUT_STATUS = 401;

const VIEW = { WORKING: "working", SIGN_IN: "sign-in", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | {
      readonly kind: typeof VIEW.SIGN_IN | typeof VIEW.SAID;
      readonly title: string;
      readonly body: string;
    };

const WORKING: View = { kind: VIEW.WORKING };

function said(title: string, body: string): View {
  return { kind: VIEW.SAID, title, body };
}

async function handOff(query: DesktopSessionPageQuery | undefined): Promise<View> {
  if (query === undefined) {
    return said(`This link did not come from ${PRODUCT_NAME}`, "Sign in again.");
  }
  const signedIn = authClient
    .getSession({ fetchOptions: { signal: signInCountDeadline() } })
    .then((answer) => answer.data)
    .catch(() => null);
  const answered = await authClient.$fetch(TRANSFER_PATH, {
    method: "POST",
    query: { ...query.transfer },
    body: {},
  });
  if (answered.error) {
    return answered.error.status === SIGNED_OUT_STATUS
      ? {
          kind: VIEW.SIGN_IN,
          title: "Sign in to finish",
          body: `Sign in with the account you use in ${PRODUCT_NAME}.`,
        }
      : said(`${PRODUCT_NAME} could not be reached`, "Sign in again.");
  }
  const code = Schema.decodeUnknownSync(TransferAnswer)(answered.data).electron_authorization_code;
  await completeSiteSignIn(signedIn).catch(() => undefined);
  window.location.replace(desktopSessionReturnUrl(query.returnTo, code, query.transfer.state));
  return WORKING;
}

function DesktopSession(): React.JSX.Element {
  const started = useRef(false);
  const handing = useMutation({ mutationFn: handOff });
  const view = handing.data ?? WORKING;
  const signInChoices = useSocialSignIn(authClient);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    handing.mutate(desktopSessionPageQuery(window.location.search));
  }, [handing.mutate]);

  return (
    <AuthPage
      mark={<AuthMark tone={view.kind === VIEW.SAID ? LANDING_TONE.DANGER : undefined} />}
      title={view.kind === VIEW.WORKING ? "Finishing sign-in…" : view.title}
      description={view.kind === VIEW.WORKING ? undefined : view.body}
      error={
        view.kind === VIEW.SIGN_IN && signInChoices.failed
          ? { words: SIGN_IN_UNFINISHED, failure: UNREPORTED.NO_REPORTER }
          : undefined
      }
      action={view.kind === VIEW.SAID ? openAppFromMac() : undefined}
    >
      {view.kind === VIEW.SIGN_IN ? (
        <SocialSignInChoices pending={signInChoices.pending} onPress={signInChoices.begin} />
      ) : null}
    </AuthPage>
  );
}

startSiteAnalytics();

mountPrerenderedPage(<DesktopSession />);
