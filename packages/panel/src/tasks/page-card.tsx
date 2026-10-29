import { LINK_PLACE } from "@luke/features/link-grammar";
import {
  PAGE_SHOWER,
  type PageLine,
  type PagePlace,
  type PageShower,
} from "@luke/features/page-wire";
import { HoverCard, HoverCardHead, HoverCardSkeleton, PageThumb, Time, useMinute } from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, LUKE_ACTOR } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { AppWindowIcon } from "lucide-react";
import { PROVENANCE_VERB, ProvenanceRow } from "../actor-ref.js";
import { appPlatform } from "../app-platform.js";
import { PAGE_SANDBOX } from "./page-pane.js";
import { useKnownNames } from "./use-known-names.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * page-card.tsx -- the card a page of the plan hangs wherever it is named: its tab's, its row's in the plan's summary, its chip's and bar's, and the transcript row's of a call that showed or read it.
 *
 * The head is the page as its tab names it: the tab's glyph, its title
 * wrapped to two lines, the version it stands at where it has more than
 * one, and how long ago that version was written. Under it, who showed it,
 * where the version says, as a provenance row: Luke, or a coding agent by
 * its tile and the name the window holds for it now, which a press opens.
 * Then the page
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

/**
 * Who showed a page's version: Luke, or a coding agent by the name the
 * window holds now, its tile at rest since its model is not known here,
 * hanging its own card on the task it works on; nothing for one shown
 * before who showed it was kept.
 */
function showerActor(
  shownBy: PageShower | undefined,
  place: PagePlace,
  agents: ReadonlyMap<string, string>,
): Actor | undefined {
  if (shownBy === undefined) return undefined;
  if (shownBy.kind === PAGE_SHOWER.LUKE) return LUKE_ACTOR;
  return {
    kind: ACTOR_KIND.AGENT,
    agentId: shownBy.agentId,
    taskId: "taskId" in place ? place.taskId : undefined,
    name: agents.get(shownBy.agentId) ?? TAB_WORDS.CODING_AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

/** A press on the agent who showed a page, opening its tab, where the window opens places; none for Luke. */
function useShowerDoor(shower: Actor | undefined): (() => void) | undefined {
  const openPlace = useOpenPlace();
  if (openPlace === undefined || shower?.kind !== ACTOR_KIND.AGENT) return undefined;
  const { agentId, taskId } = shower;
  if (agentId === undefined) return undefined;
  return () =>
    openPlace({
      kind: LINK_PLACE.AGENT,
      ...(taskId === undefined ? undefined : { planId: taskId }),
      agentId,
    });
}

/** A page's card: its glyph, title, version, and age, who showed it, and a preview of its newest version. */
export function PageCard({ place, page }: CardPage): React.JSX.Element {
  const now = useMinute();
  const shower = showerActor(page.shownBy, place, useKnownNames().agents);
  const openShower = useShowerDoor(shower);
  return (
    <HoverCard data-page-card="" data-tab-card="">
      <HoverCardHead
        glyph={<AppWindowIcon aria-hidden="true" />}
        name={page.title}
        sub={page.version > 1 ? `Version ${page.version}` : undefined}
        corner={<Time at={page.at} now={now} hint={false} />}
      />
      {/* Note that the row says no time, because the corner already says when this version was shown. */}
      {shower === undefined ? null : (
        <ProvenanceRow verb={PROVENANCE_VERB.SHOWN} actor={shower} now={now} onOpen={openShower} />
      )}
      {/* A new version is a new preview, held hidden until it has loaded rather than over the last one's frame. */}
      <PagePreview key={`${page.id}/${page.version}`} place={place} page={page} />
    </HoverCard>
  );
}

/** What a page's card names it by before its page is read, or where it is gone: a page. */
const UNNAMED_PAGE = "Page";

/** The name a page's card calls it by before its page is read: the name it was shown by, or a page. */
function shownName(name: string | undefined): string {
  return name === undefined || name === "" ? UNNAMED_PAGE : name;
}

/** A page's card where its page is not read: its tab's glyph and the name it was shown by. */
export function PageNameCard({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <HoverCard data-page-card="">
      <HoverCardHead glyph={<AppWindowIcon aria-hidden="true" />} name={shownName(name)} />
    </HoverCard>
  );
}

/** A page's card while its page is read: its tab's glyph and the name it was shown by, holding the line its version and who showed it stand on. */
export function PageNameSkeleton({ name }: { name: string | undefined }): React.JSX.Element {
  return (
    <HoverCardSkeleton
      glyph={<AppWindowIcon aria-hidden="true" />}
      name={shownName(name)}
      sub
      data-page-card=""
    />
  );
}
