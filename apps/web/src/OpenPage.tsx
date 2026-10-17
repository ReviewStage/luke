import { LINK_PLACE, type LinkPlaceKind } from "@luke/features/luke-link";
import { openTargetOf } from "@luke/features/open-address";
import { AUTH_CARD, AUTH_SHELL, AUTH_TITLE } from "@luke/ui/auth-surface";
import { useState } from "react";
import { LukeMark } from "./SiteChrome";

/**
 * OpenPage.tsx -- the page a Luke link lands on in a browser: one press that hands the place it names to the desktop app.
 *
 * A link to anything in Luke, a task, an agent, an Inbox item, an
 * automation (`@luke/features/luke-link`), is the same address on the web
 * and in the app, as Linear's, Notion's and Slack's are. Opened from Slack,
 * a pull request, or a mail, it lands here, the title naming the kind of
 * thing it opens, and the press opens it in Luke through the desktop's own
 * scheme, which the app registers with macOS. The page fetches nothing and
 * reads nothing of the thing, so a visitor signed out, or one it is not
 * shared with, learns no more than the address already says; Luke checks
 * who may see it once it opens there. Nothing opens by itself, because a
 * browser with no app for the scheme answers an automatic hand-off with an
 * error of its own; and the page counts no visit, because its address names
 * a workspace and a thing in it.
 * Pasted into Slack or a message, a link unfurls as the site's own card,
 * the same for every link (`open.html`'s head), since an unfurler fetches it
 * signed out and anyone holding the link reads what the card says.
 *
 * A browser says nothing when no app answers the scheme, and an app too old
 * to know it is the same silence, so a press is followed, a moment later, by
 * a quiet line saying what to check. The way to Luke is the landing page,
 * which says what Luke is before it offers the download.
 */

const WORDS = {
  NOT_A_LINK: "This isn't a link to anything in Luke",
  OPEN: "Open in Luke",
  DID_NOT_OPEN: "Didn't open? Make sure Luke is",
  INSTALLED: "installed and up to date",
  NO_APP: "Don't have it yet?",
  GET: "Get Luke for Mac",
} as const;

/** The page's title, by the kind of place its link opens. */
const TITLE = {
  [LINK_PLACE.TASK]: "Open this task in Luke",
  [LINK_PLACE.SECTION]: "Open this section in Luke",
  [LINK_PLACE.COMMENT]: "Open this comment in Luke",
  [LINK_PLACE.VERSION]: "Open this version in Luke",
  [LINK_PLACE.PAGE]: "Open this page in Luke",
  [LINK_PLACE.CALL]: "Open this call in Luke",
  [LINK_PLACE.TURN]: "Open this turn in Luke",
  [LINK_PLACE.AGENT]: "Open this agent in Luke",
  [LINK_PLACE.WORKER]: "Open this worker in Luke",
  [LINK_PLACE.CHANGES]: "Open these changes in Luke",
  [LINK_PLACE.MESSAGE]: "Open this message in Luke",
  [LINK_PLACE.INBOX]: "Open the Inbox in Luke",
  [LINK_PLACE.INBOX_ITEM]: "Open this Inbox item in Luke",
  [LINK_PLACE.AUTOMATIONS]: "Open Automations in Luke",
  [LINK_PLACE.AUTOMATION]: "Open this automation in Luke",
  [LINK_PLACE.AUTOMATION_RUN]: "Open this run in Luke",
  [LINK_PLACE.FACTORY]: "Open Factory in Luke",
  [LINK_PLACE.SETTINGS]: "Open these settings in Luke",
  [LINK_PLACE.PERSON]: "Open this profile in Luke",
  [LINK_PLACE.ISSUE]: "Open this issue in Luke",
} as const satisfies Record<LinkPlaceKind, string>;

/** The landing page, on whichever host served this one. */
const LANDING_URL = "/";

const OPEN_BUTTON =
  "mt-6 flex min-h-[46px] items-center justify-center rounded-md bg-foreground px-5 font-semibold text-background transition-transform duration-150 hover:-translate-y-px motion-reduce:transition-none";

const QUIET_LINK = "underline underline-offset-2";

/** The page's address read as a link: a press opens what it names in the app, and a moment later says what to check where nothing did. */
export function OpenPage(): React.JSX.Element {
  const [target] = useState(() =>
    openTargetOf(window.location.pathname, window.location.hash, window.location.search),
  );
  const [pressed, setPressed] = useState(false);
  return (
    <main className={AUTH_SHELL}>
      <section className={AUTH_CARD} aria-labelledby="open-title">
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 id="open-title" className={AUTH_TITLE}>
          {target === undefined ? WORDS.NOT_A_LINK : TITLE[target.kind]}
        </h1>
        {target === undefined ? null : (
          <a className={OPEN_BUTTON} href={target.appLink} onClick={() => setPressed(true)}>
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
