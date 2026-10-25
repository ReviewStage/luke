/**
 * toolbar.tsx -- the bar across the top of a workspace, which is also the window's drag handle: what leads it, the page's title and the tag after it, and the page's actions at its end; and the not-found state that keeps it.
 *
 * Inbox, Tasks, Chat, Automations, an agent's page, Version history, Admin,
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
 * - `tag` follows the title on its last baseline: a capsule naming the
 *   page's state (an experiment), or a switch of its view.
 * - `actions` end the bar, at the control gap.
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

import type { ReactNode } from "react";
import { NotFoundIcon } from "../../icons/lucide-glyphs.js";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { EmptyState, type EmptyStateAction } from "../empty-state/empty-state.js";
import { FILL_ELEMENT, Fill } from "../layout/layout.js";
import { ONE_LINE_ELEMENT, OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";
import {
  TOOLBAR_INSET,
  TOOLBAR_LOOK,
  ToolbarFrame,
  type ToolbarInset,
  type ToolbarLook,
} from "./toolbar-frame.js";

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

/** The name of a trail's landmark. */
const TRAIL_LABEL = "Path";

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
/** The title, in the dialog's type with a title's tracking; its room reaches 6px left of the words, so its own hover fill and field ring, which start there, are not clipped. */
const TITLE =
  "luke-toolbar-title m-0 -ml-luke-6 pl-luke-6 text-dialog-size font-dialog tracking-title";

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
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The page's name as the bar's heading: words on one line, fading where cut and read whole by the hint; anything else as given. */
function ToolbarTitle({ title }: { title: ReactNode }): React.JSX.Element {
  if (typeof title !== "string") return <>{title}</>;
  return (
    <OneLine as={ONE_LINE_ELEMENT.H1} hint={wholeWordsHint(title)} className={TITLE}>
      {title}
    </OneLine>
  );
}

/** A place of the trail as a crumb: the folding way back where it wears a glyph, a quiet pill where it does not. */
function placeCrumb(place: ToolbarPlace): Crumb {
  const onPress = () => place.onPress();
  return place.icon === undefined
    ? { label: place.label, onPress }
    : { label: place.label, icon: place.icon, onPress };
}

/**
 * The page's trail: the places above it, then its own name last, words that
 * are no press, said to be the current page. A name that comes and goes
 * (`shown`, as a document's does once its header has scrolled away) joins
 * the trail fading in, and is out of it, and a reader's, while it is gone.
 */
function ToolbarTrail({
  trail,
  title,
  shown,
}: {
  trail: readonly ToolbarPlace[];
  title: string;
  shown?: boolean | undefined;
}): React.JSX.Element {
  // Note that a name not yet read leaves the places alone, so the way back stands while it loads.
  const own: Crumb[] = title === "" ? [] : [{ label: title, current: true, shown }];
  return (
    <Breadcrumbs
      label={TRAIL_LABEL}
      variant={BREADCRUMBS_VARIANT.TITLE}
      crumbs={[...trail.map(placeCrumb), ...own]}
    />
  );
}

/** The name the bar picks up from a document's header: words on one line, there to fade in and out, hidden from a reader until shown. */
function ToolbarPickedUp({ pickUp }: { pickUp: ToolbarPickUp }): React.JSX.Element {
  return (
    <span
      className="luke-toolbar-pick-up"
      data-shown={pickUp.shown ? "true" : "false"}
      aria-hidden={pickUp.shown ? undefined : "true"}
    >
      <OneLine hint={pickUp.shown ? wholeWordsHint(pickUp.name) : undefined} className={TITLE}>
        {pickUp.name}
      </OneLine>
    </span>
  );
}

/** A workspace's bar: its lead, its heading (the title and its tag), and its actions, in that order. */
export function Toolbar({
  lead,
  title,
  trail,
  pickUp,
  tag,
  actions,
  start,
  end,
  look,
  place,
  measure,
  folded,
}: ToolbarProps): React.JSX.Element {
  return (
    <ToolbarFrame
      start={start}
      end={end}
      look={look}
      place={place}
      measure={measure}
      folded={folded}
    >
      {said(lead) ? <div className={LEAD}>{lead}</div> : null}
      <div className="luke-toolbar-heading">
        {trail !== undefined && trail.length > 0 && typeof title === "string" && title !== "" ? (
          <ToolbarTrail trail={trail} title={title} />
        ) : trail !== undefined && trail.length > 0 && !said(title) && pickUp !== undefined ? (
          <ToolbarTrail trail={trail} title={pickUp.name} shown={pickUp.shown} />
        ) : said(title) ? (
          <ToolbarTitle title={title} />
        ) : pickUp !== undefined && pickUp.name !== "" ? (
          <ToolbarPickedUp pickUp={pickUp} />
        ) : null}
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
