import { LINK_PLACE, type LinkPlaceKind } from "@luke/features/luke-link";
import { openTargetOf } from "@luke/features/open-address";
import {
  AuthPage,
  BUTTON_VARIANT,
  ButtonLink,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@luke/ui";
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
  [LINK_PLACE.PULL_REQUEST_THREAD]: "Open this review comment in Luke",
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

/**
 * The page's address read as a link: a press opens what it names in the app, and a moment later says what to check where nothing did.
 *
 * One AuthPage card under Luke's mark: the title names the kind of thing the
 * link opens, and the card's body holds the press, the way to Luke, and the
 * line that follows a press, centred as the card's words are.
 */
export function OpenPage(): React.JSX.Element {
  const [target] = useState(() =>
    openTargetOf(window.location.pathname, window.location.hash, window.location.search),
  );
  const [pressed, setPressed] = useState(false);
  return (
    <AuthPage
      mark={
        <span className="inline-flex w-13">
          <LukeMark className="h-auto w-full" />
        </span>
      }
      title={target === undefined ? WORDS.NOT_A_LINK : TITLE[target.kind]}
    >
      {target === undefined ? null : (
        <ButtonLink
          variant={BUTTON_VARIANT.PRIMARY}
          href={target.appLink}
          onClick={() => setPressed(true)}
        >
          {WORDS.OPEN}
        </ButtonLink>
      )}
      <div className="text-center">
        <Text tone={TEXT_TONE.MUTED}>
          {WORDS.NO_APP}{" "}
          <TextLink href={LANDING_URL} look={TEXT_LINK_LOOK.UNDERLINED}>
            {WORDS.GET}
          </TextLink>
        </Text>
      </div>
      {/* Note that the line's room stands from the first paint, two lines where the card is narrow enough to wrap it, because a card growing under a press would move the button from under the pointer. */}
      <div className="min-h-8 text-center min-[480px]:min-h-4" role="status">
        {pressed ? (
          <div className="animate-arrive-late">
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {WORDS.DID_NOT_OPEN}{" "}
              <TextLink href={LANDING_URL} look={TEXT_LINK_LOOK.UNDERLINED}>
                {WORDS.INSTALLED}
              </TextLink>
              .
            </Text>
          </div>
        ) : null}
      </div>
    </AuthPage>
  );
}
