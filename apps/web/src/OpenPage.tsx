import { appLinkFromAddress } from "@luke/features/open-address";
import { AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "@luke/ui/auth-surface";
import { useState } from "react";
import { LukeMark } from "./SiteChrome";

/**
 * OpenPage.tsx -- the page a Luke link lands on in a browser: one press that hands the plan to the desktop app.
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
 *
 * A browser says nothing when no app answers the scheme, and an app too old
 * to know it is the same silence, so a press is followed, a moment later, by
 * a quiet line saying what to check. The way to Luke is the landing page,
 * which says what Luke is before it offers the download.
 */

const WORDS = {
  TITLE: "Open this plan in Luke",
  NOT_A_PLAN: "This isn't a link to a Luke plan",
  OPEN: "Open in Luke",
  DID_NOT_OPEN: "Didn't open? Make sure Luke is",
  INSTALLED: "installed and up to date",
  NO_APP: "Don't have it yet?",
  GET: "Get Luke for Mac",
} as const;

/** The landing page, on whichever host served this one. */
const LANDING_URL = "/";

const OPEN_BUTTON =
  "mt-6 flex min-h-[46px] items-center justify-center rounded-md bg-foreground px-5 font-semibold text-background transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none";

const QUIET_LINK = "underline underline-offset-2";

/** The page's address read as a plan's: a press opens it in the app, and a moment later says what to check where nothing did. */
export function OpenPage(): React.JSX.Element {
  const [appLink] = useState(() =>
    appLinkFromAddress(window.location.pathname, window.location.hash),
  );
  const [pressed, setPressed] = useState(false);
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
          <a className={OPEN_BUTTON} href={appLink} onClick={() => setPressed(true)}>
            {WORDS.OPEN}
          </a>
        )}
        <p className="mt-4 mb-0 text-muted-foreground">
          {WORDS.NO_APP}{" "}
          <a className={QUIET_LINK} href={LANDING_URL}>
            {WORDS.GET}
          </a>
        </p>
        {/* Note that the line's room stands from the first paint, two lines where the card is narrow enough to wrap it, because a card growing under a press would move the button from under the pointer. */}
        <p
          className="mt-3 mb-0 min-h-10 text-muted-foreground text-sm min-[480px]:min-h-5"
          role="status"
        >
          {pressed ? (
            <span className="animate-arrive-late">
              {WORDS.DID_NOT_OPEN}{" "}
              <a className={QUIET_LINK} href={LANDING_URL}>
                {WORDS.INSTALLED}
              </a>
              .
            </span>
          ) : null}
        </p>
      </section>
    </main>
  );
}
