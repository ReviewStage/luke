/**
 * toolbar.tsx -- the bar across the top of a workspace, which is also the window's drag handle: what leads it, the page's title and the tag after it, and the page's actions at its end; and the not-found state that keeps it.
 *
 * Inbox, Tasks, Automations, an agent's page, Version history, Admin,
 * an Inbox item, and the Automations list each stand under this one bar; a
 * document (a plan, Settings, a person, the automation editor) heads itself
 * in its page instead (`PageHeader`). The bar is one row at the window's bar
 * height (`--luke-toolbar-height`, which the shell sets level with its title
 * bar), and its slots stand in one order, each drawn only where it says
 * something:
 *
 * - `lead` stands first: a way back (`BackButton`) or a tab strip, controls
 *   the bar lays at its control gap and lets shrink before the actions do.
 * - The heading takes the room left, whether or not it holds a title, so
 *   the actions always end the bar. Its `title` is the page's name, drawn as
 *   its level-one heading on one line that fades out where the bar cuts it,
 *   as a row's name does, its hint reading it whole; a title that is more than words (an
 *   editable name, its skeleton block) stands there as given.
 * - Where the page has a parent, the caller hands its `trail`, the places
 *   above it outermost first, and the bar leads its heading with them as
 *   crumbs (`Breadcrumbs`), each a press back to its place, the page's
 *   `title` last as words that are no press, said to be the page the
 *   reader stands on. A place that wears its glyph is the trail's folding
 *   way back, whose words fold away as the bar's acts do.
 * - `detail` follows the title on its last baseline: quiet words saying
 *   what the page is beside its name (a channel's purpose), on one line
 *   that gives way, cut short, before the title does.
 * - `tag` follows the title on its last baseline: a capsule naming the
 *   page's state (an experiment), or a switch of its view.
 * - `actions` end the bar, at the control gap.
 *
 * A bar whose heading is crumbs or a title beside a way back and its
 * actions (`wrapHeading`: an Inbox item's) answers its own
 * width: under 360px the lead's labelled controls draw their glyphs alone,
 * named still, and once one row would show less of the page's own name than
 * reads (`--luke-title-floor`, `use-wrap-when-cut.ts`), the heading takes a
 * row of its own under the lead and the actions, one pane bar high, rather
 * than cutting the name to a few letters; above the floor the name fades
 * where it is cut, on the one row.
 *
 * A document's page draws the bar with no title of its own, since its header
 * names it in the page (`PageHeader`), and hands it `pickUp`: the header's
 * name, which the bar shows in its title's place only once the header has
 * scrolled away, fading in and out on the motion tokens. Where the page has
 * a parent too, the bar leads with its trail and the name joins it as the
 * last crumb, the page the reader stands on, as it scrolls into view and out
 * of it. Note that the copy is words, never a heading, because the header's
 * title is the page's one `h1`, and that it is hidden from a reader while
 * the header is in view, so the name is read once.
 *
 * Each edge is inset by name (`TOOLBAR_INSET`): a bar that starts or ends
 * on words stands them where its column's words start, and one that starts
 * or ends on a control stands it at the column's own edge, where a tab's
 * fill starts. Where the window's own buttons stand over an edge (the
 * folded sidebar's toggle, the side panel's), the shell moves that edge
 * clear of them.
 *
 * A phone's bar (`TOOLBAR_LOOK.PHONE`) lays the same slots as one control a
 * corner, its title centred between them, and is named by the place it
 * heads (`place`). A task's bar leads with its tab strip (`TOOLBAR_LOOK.TABS`),
 * which a narrow room wraps to a row of its own.
 *
 * What the window around the bar knows and the bar does not, it says in
 * custom properties on the room the bar stands in (`toolbar.css`): the
 * bar's row, where the window's own buttons stand over an edge, what its
 * ground is, and whether its title centres. No stylesheet of the window
 * reaches into the bar's parts.
 *
 * A place the window cannot show keeps its bar (`NotFound`), so a link to
 * something gone still leaves its way back and the window's drag handle
 * where every page has them, and says so in the room under it.
 */

import { type ReactNode, useRef } from "react";
import { NotFoundIcon } from "../../icons/lucide-glyphs.js";
import { type TitleSeat, useWrapWhenCut } from "../../use-wrap-when-cut.js";
import { EmptyState, type EmptyStateAction } from "../empty-state/empty-state.js";
import { FILL_ELEMENT, Fill } from "../layout/layout.js";
import { OneLine } from "../one-line/one-line.js";
import {
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  ToolbarFrame,
  type ToolbarInset,
  type ToolbarLook,
} from "./toolbar-frame.js";
import { said, ToolbarName } from "./toolbar-name.js";

export { TOOLBAR_INSET, TOOLBAR_LOOK, type ToolbarInset, type ToolbarLook };

/** What the not-found state calls the thing it could not show. */
export const NOT_FOUND_THING = {
  TASK: "task",
  AGENT: "agent",
  INBOX_ITEM: "Inbox item",
  AUTOMATION: "automation",
  PERSON: "profile",
  ACCOUNT: "account",
} as const;

export type NotFoundThing = (typeof NOT_FOUND_THING)[keyof typeof NOT_FOUND_THING];

/** The not-found state's title, the same for every thing. */
const NOT_FOUND_TITLE = "Not found";

/**
 * The bar's parts. Its own row stays in `toolbar.css`, which the window's
 * custom properties, its style query, and a narrow room's wrap restyle, and
 * which the tests read for its insets and its drag region; so does the
 * heading, which a narrow room's wrap sizes, and the picked-up name, whose
 * three properties leave on three timings. What leads gives way before the
 * actions do, its controls shrinking to their own floors rather than
 * pushing the actions off the bar.
 */
const LEAD = "luke-toolbar-lead flex min-w-0 flex-initial items-center gap-control-gap";
const ACTIONS = "luke-toolbar-actions relative flex flex-none items-center gap-control-gap";
const TAG = "luke-toolbar-tag flex-none";
/** Quiet words after the title, in the body's type, on one line cut short, fading, before the title is. */
const DETAIL = "luke-toolbar-detail min-w-0 flex-[0_1000_auto] text-body text-muted-foreground";
/** Where a bar's heading stands its title on one row: the page's own name, its last words. */
const HEADING_SEAT: TitleSeat = {
  room: ":scope > .luke-toolbar-heading",
  words: ":is(.luke-breadcrumb-label, .luke-toolbar-title)",
};

/** A place above the page in its trail: its name, the glyph it wears where it wears one, and the press back to it. */
export interface ToolbarPlace {
  readonly label: string;
  /** The place's own glyph, which makes it the trail's folding way back; words alone where none is given. */
  readonly icon?: ReactNode;
  readonly onPress: () => void;
}

/** A document's name as the bar picks it up from the page's header: shown only once the header has scrolled away. */
export interface ToolbarPickUp {
  /** The header's title in words; none draws nothing. */
  readonly name: string;
  /** Whether the header has scrolled away, so the bar shows the name. */
  readonly shown: boolean;
}

/** What a workspace's bar holds, each slot drawn only where it says something. */
export interface ToolbarProps {
  /** What stands first: a way back (`BackButton`) or a tab strip. */
  readonly lead?: ReactNode;
  /** The page's name, drawn as its heading on one line; a node that is more than words stands as given. */
  readonly title?: ReactNode;
  /** The places above the page, outermost first, which lead its heading as crumbs with the `title` last, or a document's `pickUp` name once it is shown; read only where the title is words or there is a `pickUp`. */
  readonly trail?: readonly ToolbarPlace[] | undefined;
  /** A document's name, shown in the title's place once its header has scrolled away; read only where there is no `title`. */
  readonly pickUp?: ToolbarPickUp | undefined;
  /** After the title, on its last baseline: quiet words saying what the page is beside its name, which give way before the title does. */
  readonly detail?: ReactNode;
  /** After the title, on its last baseline: a capsule naming the page's state, or a switch of its view. */
  readonly tag?: ReactNode;
  /** The page's actions, ending the bar. */
  readonly actions?: ReactNode;
  /** How far in the bar's first thing stands: where its column's words start, where none is named. */
  readonly start?: ToolbarInset | undefined;
  /** How far in the bar's last thing stands: where its column's words end, where none is named. */
  readonly end?: ToolbarInset | undefined;
  /** How the slots are laid: the window's, or a phone's one control a corner with the title centred; the window's where none is named. */
  readonly look?: ToolbarLook | undefined;
  /** What the bar heads (`task`), which names it to the page's own rules and its tests as `task-head`. */
  readonly place?: string | undefined;
  /** Whether the bar is a container its slots' rules answer the width of (`@container luke-toolbar`), so a control folds before the title or tabs beside it do. */
  readonly measure?: boolean | undefined;
  /** Whether every labelled control of the bar draws its glyph alone, named still. */
  readonly folded?: boolean | undefined;
  /** Whether a bar that would cut the page's own name under the readable floor stands its heading on a row of its own under the lead and actions, and under 360px folds its lead to glyphs. */
  readonly wrapHeading?: boolean | undefined;
}

/** A workspace's bar: its lead, its heading (the title and its tag), and its actions, in that order. */
export function Toolbar({
  lead,
  title,
  trail,
  pickUp,
  detail,
  tag,
  actions,
  start,
  end,
  look,
  place,
  measure,
  folded,
  wrapHeading,
}: ToolbarProps): React.JSX.Element {
  const frame = useRef<HTMLElement>(null);
  const wrapped = useWrapWhenCut(frame, HEADING_SEAT, wrapHeading === true);
  return (
    <ToolbarFrame
      frameRef={frame}
      wrapped={wrapped}
      start={start}
      end={end}
      look={look}
      place={place}
      measure={measure}
      folded={folded}
      wrapHeading={wrapHeading}
    >
      {said(lead) ? <div className={LEAD}>{lead}</div> : null}
      <div className="luke-toolbar-heading">
        <ToolbarName title={title} trail={trail} pickUp={pickUp} />
        {said(detail) ? <OneLine className={DETAIL}>{detail}</OneLine> : null}
        {said(tag) ? <span className={TAG}>{tag}</span> : null}
      </div>
      {said(actions) ? <div className={ACTIONS}>{actions}</div> : null}
    </ToolbarFrame>
  );
}

/**
 * A place the window cannot show, under the bar it would stand under: a
 * thing gone, or not shared with whoever opened it. The service answers both
 * alike, so a link never says that something private is there, and the
 * state draws nothing of the thing: the bar keeps only its way back and its
 * acts that need no thing, and the room under it says what is missing, with
 * the one way on from it where one is given.
 */
export function NotFound({
  thing,
  bar,
  action,
}: {
  thing: NotFoundThing;
  /** The bar the place stands under; left out only where the state stands under a bar already drawn. */
  bar?: ToolbarProps | undefined;
  action?: EmptyStateAction | undefined;
}): React.JSX.Element {
  const state = (
    <EmptyState icon={<NotFoundIcon />} title={NOT_FOUND_TITLE} action={action}>
      {`This ${thing} doesn't exist, or you don't have access to it.`}
    </EmptyState>
  );
  if (bar === undefined) return state;
  return (
    <Fill as={FILL_ELEMENT.SECTION} aria-label={NOT_FOUND_TITLE}>
      <Toolbar {...bar} />
      {state}
    </Fill>
  );
}
