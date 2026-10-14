import { AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "@luke/ui/auth-surface";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { appLinkFromAddress } from "./open-address";
import { DMG_URL, LukeMark } from "./SiteChrome";
import "./styles.css";

/**
 * open.tsx -- the page a Luke link lands on in a browser: one press that hands the plan to the desktop app.
 *
 * A plan's link (`https://tryluke.dev/<workspace>/plan/<id>#<section>`) is the
 * same address on the web and in the app, as Linear's, Notion's and Slack's
 * are. Opened from Slack, a pull request, or a mail, it lands here, and the
 * press opens it in Luke through the desktop's own scheme (`tryluke://`),
 * which the app registers with macOS. The page fetches nothing and reads
 * nothing of the plan, so a visitor signed out, or one the plan is not
 * shared with, learns no more than the address already says. Nothing opens
 * by itself, because a browser with no app for the scheme answers an
 * automatic hand-off with an error of its own; and the page counts no visit,
 * because its address names a workspace and a plan.
 */

const WORDS = {
  TITLE: "Open this plan in Luke",
  NOT_A_PLAN: "This isn't a link to a Luke plan",
  OPEN: "Open in Luke",
  NO_APP: "Don't have Luke yet?",
  DOWNLOAD: "Download it for Mac",
} as const;

const OPEN_BUTTON =
  "mt-6 flex min-h-[46px] items-center justify-center rounded-md bg-foreground px-5 font-semibold text-background transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none";

function OpenInLuke(): React.JSX.Element {
  const [appLink] = useState(() =>
    appLinkFromAddress(window.location.pathname, window.location.hash),
  );
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="open-title">
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 id="open-title" className={AUTH_TITLE}>
          {appLink === undefined ? WORDS.NOT_A_PLAN : WORDS.TITLE}
        </h1>
        {appLink === undefined ? null : (
          <a className={OPEN_BUTTON} href={appLink}>
            {WORDS.OPEN}
          </a>
        )}
        <p className="mt-4 mb-0 text-muted-foreground">
          {WORDS.NO_APP}{" "}
          <a className="underline underline-offset-2" href={DMG_URL}>
            {WORDS.DOWNLOAD}
          </a>
        </p>
      </section>
    </main>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element is missing");
createRoot(rootElement).render(
  <StrictMode>
    <OpenInLuke />
  </StrictMode>,
);
