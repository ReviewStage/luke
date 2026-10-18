/**
 * desktop-session.tsx -- the page that hands the Mac a Better Auth session of its own from the signed-in browser.
 *
 * The Mac opens it right after its OAuth sign-in, with a PKCE challenge, a
 * state, and its loopback address. On the browser's session the page asks
 * Better Auth's Electron plugin to transfer the user
 * (https://www.better-auth.com/docs/integrations/electron#handling-authorization-in-the-browser),
 * and sends the plugin's single-use code back to the loopback, where the Mac
 * exchanges it with its verifier. The plugin's own browser client would
 * redirect through a custom URL scheme; Luke's Mac listens on the loopback
 * its OAuth sign-in already uses, so the page returns there, and only to a
 * loopback (`desktop-session-wire.ts`).
 *
 * A browser that holds no session, which is the case when the Mac asks for
 * a session apart from its sign-in, signs in here first, and the page
 * carries on with the transfer when the sign-in returns it.
 *
 * It is also where the website names the visitor and counts their sign-in
 * (`completeSiteSignIn`), since the desktop's sign-in skips the consent page
 * and passes through no other page of the site on the session it made.
 */

import {
  type DesktopSessionPageQuery,
  desktopSessionPageQuery,
  desktopSessionReturnUrl,
} from "@luke/features/desktop-session-wire";
import { AuthPage } from "@luke/ui";
import { createAuthClient } from "better-auth/react";
import { Schema } from "effect";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { completeSiteSignIn, startSiteAnalytics } from "./analytics";
import { ProviderChoices, SIGN_IN_FAILURE, useSocialSignIn } from "./sign-in-choices";
import "./styles.css";

const authClient = createAuthClient();

/** The Electron plugin's transfer endpoint, which the plugin's browser client calls `electron.transferUser`. */
const TRANSFER_PATH = "/electron/transfer-user";

const TransferAnswer = Schema.Struct({ electron_authorization_code: Schema.String });

/** The HTTP status Better Auth answers a transfer with when the browser holds no session. */
const SIGNED_OUT_STATUS = 401;

/** What the page shows: the hand-off under way, a sign-in it needs first, or how it ended short of the Mac. */
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

/** Asks the plugin for the code and sends the browser on to the loopback; answers what to show when it cannot. */
async function handOff(query: DesktopSessionPageQuery | undefined): Promise<View> {
  if (query === undefined) {
    return said("This link did not come from Luke", "Return to Luke and sign in again.");
  }
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
          body: "Sign in with the account you use in Luke.",
        }
      : said("Luke could not be reached", "Return to Luke and sign in again.");
  }
  const code = Schema.decodeUnknownSync(TransferAnswer)(answered.data).electron_authorization_code;
  // Note that the sign-in is counted here, before the page leaves, because
  // the desktop's client skips consent and this is the one page of the flow
  // that runs on the session a sign-in just made; a count that fails never
  // stands between the Mac and its session.
  await completeSiteSignIn(async () => (await authClient.getSession()).data).catch(() => undefined);
  window.location.replace(desktopSessionReturnUrl(query.returnTo, code, query.transfer.state));
  return WORKING;
}

/**
 * The page is one AuthPage card with no artwork, as it had none before: the
 * title says where the hand-off stands, the description what to do about
 * it, and the body holds the providers when a sign-in comes first. A
 * sign-in that cannot start is said in the card's alert region rather than
 * under the choices.
 */
function DesktopSession(): React.JSX.Element {
  const [view, setView] = useState<View>(WORKING);
  const started = useRef(false);
  const signInChoices = useSocialSignIn(authClient);

  // Note that the hand-off runs once even where StrictMode runs an effect
  // twice, because each transfer mints a code of its own.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void handOff(desktopSessionPageQuery(window.location.search)).then(setView);
  }, []);

  return (
    <AuthPage
      title={view.kind === VIEW.WORKING ? "Finishing sign-in…" : view.title}
      description={view.kind === VIEW.WORKING ? undefined : view.body}
      error={view.kind === VIEW.SIGN_IN && signInChoices.failed ? SIGN_IN_FAILURE : undefined}
    >
      {view.kind === VIEW.SIGN_IN ? (
        <ProviderChoices pending={signInChoices.pending} onPress={signInChoices.begin} />
      ) : null}
    </AuthPage>
  );
}

startSiteAnalytics();

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <DesktopSession />
  </StrictMode>,
);
