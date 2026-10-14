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
 */

import {
  type DesktopSessionPageQuery,
  desktopSessionPageQuery,
  desktopSessionReturnUrl,
} from "@sidecar/hosted/desktop-session-wire";
import { createAuthClient } from "better-auth/client";
import { Schema } from "effect";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "./auth-surface";
import "./styles.css";

const authClient = createAuthClient();

/** The Electron plugin's transfer endpoint, which the plugin's browser client calls `electron.transferUser`. */
const TRANSFER_PATH = "/electron/transfer-user";

const TransferAnswer = Schema.Struct({ electron_authorization_code: Schema.String });

/** The HTTP status Better Auth answers a transfer with when the browser holds no session. */
const SIGNED_OUT_STATUS = 401;

/** What the page shows: the hand-off under way, or how it ended short of the Mac. */
const VIEW = { WORKING: "working", SAID: "said" } as const;

type View =
  | { readonly kind: typeof VIEW.WORKING }
  | { readonly kind: typeof VIEW.SAID; readonly title: string; readonly body: string };

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
      ? said("You're signed out", "Return to Luke and sign in again.")
      : said("Luke could not be reached", "Return to Luke and sign in again.");
  }
  const code = Schema.decodeUnknownSync(TransferAnswer)(answered.data).electron_authorization_code;
  window.location.replace(desktopSessionReturnUrl(query.returnTo, code, query.transfer.state));
  return WORKING;
}

function DesktopSession(): React.JSX.Element {
  const [view, setView] = useState<View>(WORKING);
  const started = useRef(false);

  // Note that the hand-off runs once even where StrictMode runs an effect
  // twice, because each transfer mints a code of its own.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void handOff(desktopSessionPageQuery(window.location.search)).then(setView);
  }, []);

  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="hand-off-title">
        <h1 id="hand-off-title" className={AUTH_TITLE}>
          {view.kind === VIEW.WORKING ? "Finishing sign-in…" : view.title}
        </h1>
        {view.kind === VIEW.SAID ? <p className="m-0 text-muted-foreground">{view.body}</p> : null}
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");

createRoot(rootElement).render(
  <StrictMode>
    <DesktopSession />
  </StrictMode>,
);
