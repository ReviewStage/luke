import {
  PAGE_SHOWER,
  type PageLine,
  type PagePlace,
  type PageShower,
} from "@luke/features/page-wire";
import { HoverCard, HoverCardHead, PageThumb, Time, useMinute } from "@luke/ui";
import { AppWindowIcon } from "lucide-react";
import { appPlatform } from "../app-platform.js";
import { PAGE_SANDBOX } from "./page-pane.js";
import { useKnownNames } from "./use-known-names.js";

/**
 * page-card.tsx -- the card a page of the plan hangs wherever it is named: its tab's, its row's in the plan's summary, its chip's and bar's, and the transcript row's of a call that showed or read it.
 *
 * The head is the page as its tab names it: the tab's glyph, its title
 * wrapped to two lines, the version it stands at where it has more than
 * one and who showed it, Luke or a coding agent named as the window holds
 * it now, where the version says, and how long ago that version was
 * written. Under it the page
 * itself, small: its newest version drawn in a frame as its tab draws it
 * (`page-pane.tsx`), under the same sandbox and from the same `luke-page:`
 * address, laid out four times the card's width, a desktop window's, and
 * scaled down to the card's (tasks.css), so the developer sees what a page is before opening it. The frame
 * is the pointer's preview and nothing more: it takes no pointer, so the
 * card stays standing while the pointer crosses it, no focus, and no part
 * in what is read aloud, and it is left out of the screen recording as the
 * tab's is. Until the page has loaded the frame's place is held, at the
 * page's shape, in a quiet ground, so the card is placed once at its size.
 */

/** A page with an id and a version, on the plan it is of, or the agent on no task. */
interface CardPage {
  readonly place: PagePlace;
  readonly page: PageLine;
}

/** The page's newest version, drawn small and inert. */
function PagePreview({ place, page }: CardPage): React.JSX.Element {
  return (
    <PageThumb
      frame={{
        title: `${page.title} preview`,
        src: appPlatform().pageFrameUrl({ ...place, pageId: page.id, version: page.version }),
        sandbox: PAGE_SANDBOX,
      }}
    />
  );
}

/** What a page's card says of who showed its version where it names no agent by name. */
const SHOWN_BY = {
  LUKE: "Shown by Luke",
  AGENT: "Shown by a coding agent",
} as const;

/** Who showed a page's version: Luke, or a coding agent by the name the window holds now; nothing for one shown before who showed it was kept. */
function showerWords(
  shownBy: PageShower | undefined,
  agents: ReadonlyMap<string, string>,
): string | undefined {
  if (shownBy === undefined) return undefined;
  if (shownBy.kind === PAGE_SHOWER.LUKE) return SHOWN_BY.LUKE;
  const name = agents.get(shownBy.agentId);
  return name === undefined ? SHOWN_BY.AGENT : `Shown by ${name}`;
}

/** The line under a page's title: its version where it has more than one, and who showed it, where either is said. */
function subWords(page: PageLine, agents: ReadonlyMap<string, string>): string | undefined {
  const words = [
    page.version > 1 ? `Version ${page.version}` : undefined,
    showerWords(page.shownBy, agents),
  ].filter((each) => each !== undefined);
  return words.length === 0 ? undefined : words.join(" · ");
}

/** A page's card: its glyph, title, version, who showed it, and age, over a preview of its newest version. */
export function PageCard({ place, page }: CardPage): React.JSX.Element {
  const now = useMinute();
  const sub = subWords(page, useKnownNames().agents);
  return (
    <HoverCard data-page-card="" data-tab-card="">
      <HoverCardHead
        glyph={<AppWindowIcon aria-hidden="true" />}
        name={page.title}
        // Note that the words stand in a span of their own, so a long agent's name wraps inside the card.
        sub={sub === undefined ? undefined : <span>{sub}</span>}
        corner={<Time at={page.at} now={now} hint={false} />}
      />
      {/* A new version is a new preview, held hidden until it has loaded rather than over the last one's frame. */}
      <PagePreview key={`${page.id}/${page.version}`} place={place} page={page} />
    </HoverCard>
  );
}

/** What a page's card names it by before its page is read, or where it is gone: a page. */
const UNNAMED_PAGE = "Page";

/** A page's card where its page is not read: its tab's glyph and the name it was shown by. */
export function PageNameCard({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <HoverCard data-page-card="">
      <HoverCardHead
        glyph={<AppWindowIcon aria-hidden="true" />}
        name={name === undefined || name === "" ? UNNAMED_PAGE : name}
      />
    </HoverCard>
  );
}
