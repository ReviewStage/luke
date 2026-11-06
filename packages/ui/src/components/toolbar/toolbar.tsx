/**
 * toolbar.tsx -- the bar across the top of a workspace, which is also the window's drag handle: what leads it, the page's title and the tag after it, and the page's actions at its end; and the not-found state that keeps it.
 *
 * Inbox, Tasks, Automations, an agent's page, Version history, Admin,
 * an Inbox item, and the Automations list each stand under this one bar; a
 * document (a description, Settings, a person, the automation editor) heads itself
 * in its page instead (`PageHeader`). The bar is one row at the window's bar
 * height (`--ui-toolbar-height`, which the shell sets level with its title
 * bar), and its slots stand in one order, each drawn only where it says
 * something:
 *
 * - `lead` stands first: a way back (`BackButton`) or a tab strip, controls
 *   the bar lays at its control gap and lets shrink before the actions do.
 * - The heading takes the room left, whether or not it holds a title, so
 *   the actions always end the bar. Its `title` is the page's name, drawn as
 *   its level-one heading on one line that fades out where the bar cuts it,
 *   as a row's name does, its hint reading it whole; a title that is more than words (an
 *   editable name, its skeleton block) stands there as given. A title in
 *   words may open what it names (`titlePress`), set then at a bar title's
 *   size, and may hold the page's menu on a right-click (`titleMenu`), which
 *   is where the page's acts stand rather than a ⋯ at the bar's end.
 * - Where the page has a parent, the caller hands its `trail`, the places
 *   above it outermost first, and the bar leads its heading with them as
 *   crumbs (`Breadcrumbs`), each a press back to its place, the page's
 *   `title` last as words that are no press, said to be the page the
 *   reader stands on. A place that wears its glyph is the trail's folding
 *   way back, whose words fold away as the bar's acts do.
 * - `detail` follows the title on its last baseline: quiet words saying
 *   what the page is beside its name, on one line
 *   that gives way, cut short, before the title does.
 * - `tag` follows the title on its last baseline: a capsule naming the
 *   page's state (an experiment), or a switch of its view.
 * - `actions` end the bar, at the control gap.
 *
 * A bar whose heading is crumbs or a title beside a way back and its
 * actions (`wrapHeading`: an Inbox item's) answers its own
 * width: under 360px the lead's labeled controls draw their glyphs alone,
 * named still, and once one row would show less of the page's own name than
 * reads (`--ui-title-floor`, `use-wrap-when-cut.ts`), the heading takes a
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
 * corner, its title centered between them in a bar title's type whatever
 * the page, and its tag under the title, so the title stays centered; it is
 * named by the place it heads (`place`). A corner is one control wide, so
 * every labeled control in it draws its glyph alone, named still, centered
 * where every corner's is. A task's bar leads with its tab strip
 * (`TOOLBAR_LOOK.TABS`), which a narrow room wraps to a row of its own.
 *
 * What the window around the bar knows and the bar does not, it says in
 * custom properties on the room the bar stands in (`toolbar.css`): the
 * bar's row, where the window's own buttons stand over an edge, what its
 * ground is, and whether its title centers. No stylesheet of the window
 * reaches into the bar's parts.
 *
 * A place the window cannot show keeps its bar (`NotFound`), so a link to
 * something gone still leaves its way back and the window's drag handle
 * where every page has them, and says so in the room under it.
 */

import { type ReactNode, useRef } from "react";
import { NotFoundIcon } from "../../icons/lucide-glyphs.js";
import { ReplayMask, ReplayWords } from "../../session-replay-marks.js";
import { type TitleSeat, useWrapWhenCut } from "../../use-wrap-when-cut.js";
import { BREADCRUMBS_VARIANT, Breadcrumbs, type Crumb } from "../breadcrumbs/breadcrumbs.js";
import { EmptyState, type EmptyStateAction } from "../empty-state/empty-state.js";
import { FILL_ELEMENT, Fill } from "../layout/layout.js";
import type { ContextMenuProps } from "../menu/menu.js";
import { ONE_LINE_ELEMENT, OneLine } from "../one-line/one-line.js";
import { Tooltip, wholeWordsHint } from "../tooltip/hint.js";
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
  WORKSPACE: "workspace",
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
const LEAD = "ui-toolbar-lead flex min-w-0 flex-initial items-center gap-control-gap";
const ACTIONS = "ui-toolbar-actions relative flex flex-none items-center gap-control-gap";
const TAG = "ui-toolbar-tag flex-none";
/** Quiet words after the title, in the body's type, on one line cut short, fading, before the title is. */
const DETAIL = "ui-toolbar-detail min-w-0 flex-[0_1000_auto] text-body text-muted-foreground";
/** The title, in the dialog's type with a title's tracking; its room reaches 6px left of the words, so its own hover fill and field ring, which start there, are not clipped. */
const TITLE = "ui-toolbar-title m-0 -ml-ui-6 pl-ui-6 text-dialog-size font-dialog tracking-title";
/** A phone's title, in a bar title's type, as every phone heads a page, so one place's name reads no larger than another's. */
const PHONE_TITLE =
  "ui-toolbar-title m-0 -ml-ui-6 pl-ui-6 text-toolbar-title font-toolbar-title tracking-title";

/** A title that opens what it names, set as a bar's title rather than a page's heading, so it reads no louder than the tabs beside it. */
const TITLE_PRESS_HEADING =
  "ui-toolbar-title m-0 min-w-0 text-toolbar-title font-toolbar-title tracking-title";

/**
 * The press itself: words at rest, a light wash on hover alone, as a page's
 * title is in Notion, and no fill while what it opens stands. It is laid as
 * a tab is (`tabs.tsx`): a control high, its mark at a tab's start inset and
 * icon gap, so a bar that starts at its column's edge (`TOOLBAR_INSET.COLUMN`)
 * stands its mark and words over the first tab's under it.
 */
const TITLE_PRESS =
  "ui-toolbar-title-press inline-flex h-control max-w-full items-center gap-icon-gap rounded-control bg-transparent px-ui-8 hover:bg-muted [&_svg]:size-control-icon";

/** Where a bar's heading stands its title on one row: the page's own name, its last words. */
const HEADING_SEAT: TitleSeat = {
  room: ":scope > .ui-toolbar-heading",
  words: ":is(.ui-breadcrumb-label, .ui-toolbar-title)",
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

/** A title in words that opens what it names, as a channel's name opens its details: whether that stands open, its hint, and the press. */
export interface ToolbarTitlePress {
  readonly open: boolean;
  /** What the press opens, its hint ("Task details"). */
  readonly label: string;
  /** The mark of what the title names, inside the press before its words, as a chip wears it: a task's status. */
  readonly icon?: ReactNode;
  /** The card the press hangs while the pointer rests on it, naming what the title names whole, as its chip's does. */
  readonly card?: ReactNode;
  readonly onPress: () => void;
}

/** The page's menu on its title: `useMenu`'s `contextMenu()` and `keyMenu`. */
export interface ToolbarTitleMenu {
  readonly contextMenu: ContextMenuProps;
  readonly keyMenu: (event: React.KeyboardEvent<HTMLElement>) => void;
}

/** What a workspace's bar holds, each slot drawn only where it says something. */
export interface ToolbarProps {
  /** What stands first: a way back (`BackButton`) or a tab strip. */
  readonly lead?: ReactNode;
  /** The page's name, drawn as its heading on one line; a node that is more than words stands as given. */
  readonly title?: ReactNode;
  /** Whether the title in words opens what it names (`ToolbarTitlePress`); read only where the title is words and there is no `trail`. */
  readonly titlePress?: ToolbarTitlePress | undefined;
  /** The menu a right-click, a long press, or the menu key on the title opens, in place of a ⋯ at the bar's end (`ToolbarTitleMenu`). */
  readonly titleMenu?: ToolbarTitleMenu | undefined;
  /** Whether a title in words is the app's own (Settings, Tasks, Inbox), which a screen recording shows as it reads; one that names a task or a workspace stays masked, as every place of a trail and a picked-up name do. */
  readonly titleReplayUnmasked?: boolean | undefined;
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
  /** How the slots are laid: the window's, or a phone's one control a corner with the title centered; the window's where none is named. */
  readonly look?: ToolbarLook | undefined;
  /** What the bar heads (`task`), which names it to the page's own rules and its tests as `task-head`. */
  readonly place?: string | undefined;
  /** Whether the bar is a container its slots' rules answer the width of (`@container ui-toolbar`), so a control folds before the title or tabs beside it do. */
  readonly measure?: boolean | undefined;
  /** Whether every labeled control of the bar draws its glyph alone, named still; a phone's bar always does. */
  readonly folded?: boolean | undefined;
  /** Whether a bar that would cut the page's own name under the readable floor stands its heading on a row of its own under the lead and actions, and under 360px folds its lead to glyphs. */
  readonly wrapHeading?: boolean | undefined;
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The page's name as the bar's heading: words on one line, fading where cut and read whole by the hint; anything else as given. */
function ToolbarTitle({
  title,
  unmasked,
  press,
  menu,
  phone,
}: {
  title: ReactNode;
  /** Whether the bar is a phone's, whose title takes a bar title's type. */
  phone: boolean;
  /** Whether a title in words shows in a screen recording (`titleReplayUnmasked`). */
  unmasked: boolean;
  /** What a title in words opens, which makes it a press; none for words alone. */
  press?: ToolbarTitlePress | undefined;
  /** The page's menu, which a press holds on its right-click and the menu key (`titleMenu`). */
  menu?: ToolbarTitleMenu | undefined;
}): React.JSX.Element {
  if (typeof title !== "string") return <>{title}</>;
  if (press !== undefined) {
    return (
      <h1 className={TITLE_PRESS_HEADING}>
        <Tooltip label={press.label} card={press.card}>
          <button
            type="button"
            className={TITLE_PRESS}
            aria-expanded={press.open}
            onClick={press.onPress}
            {...menu?.contextMenu}
            onKeyDown={menu?.keyMenu}
          >
            {press.icon}
            <OneLine className="min-w-0" words={title}>
              <ReplayWords unmasked={unmasked}>{title}</ReplayWords>
            </OneLine>
          </button>
        </Tooltip>
      </h1>
    );
  }
  return (
    <OneLine
      as={ONE_LINE_ELEMENT.H1}
      hint={wholeWordsHint(title)}
      className={phone ? PHONE_TITLE : TITLE}
      words={title}
    >
      <ReplayWords unmasked={unmasked}>{title}</ReplayWords>
    </OneLine>
  );
}

/** The box a name holding the page's menu stands in: as wide as its words. */
const TITLE_MENU = "ui-toolbar-title-menu w-fit min-w-0 max-w-full rounded-control";

/**
 * A name that is no press of its own holding the page's menu on a
 * right-click, a long press, or the menu key and ⇧F10, where one is given
 * (`titleMenu`); a press holds it itself (`ToolbarTitle`). The box is as wide
 * as the name's words, so on the desktop's bar, which is otherwise the
 * window's drag handle and would take the right-click, only the name keeps
 * its presses and the rest of the bar still drags the window
 * (`toolbar.css`). A name alone takes the focus as the menu's button, so the
 * keys reach the menu; a trail's crumbs are buttons of their own, which no
 * button may hold, so there the keys reach it from a crumb.
 */
function TitleMenu({
  menu,
  crumbs,
  children,
}: {
  menu: ToolbarTitleMenu | undefined;
  /** Whether the name is led by a trail's crumbs (`trail`). */
  crumbs: boolean;
  children: ReactNode;
}): React.JSX.Element {
  if (menu === undefined) return <>{children}</>;
  if (crumbs) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: the box groups a trail's crumbs and the page's name, not a form's fields, so it is no `<fieldset>`.
      <div role="group" className={TITLE_MENU} {...menu.contextMenu} onKeyDown={menu.keyMenu}>
        {children}
      </div>
    );
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: the box holds the page's heading, which a <button> may not hold.
    <div
      role="button"
      aria-haspopup="menu"
      className={TITLE_MENU}
      tabIndex={0}
      {...menu.contextMenu}
      onKeyDown={menu.keyMenu}
    >
      {children}
    </div>
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
function ToolbarPickedUp({
  pickUp,
  phone,
}: {
  pickUp: ToolbarPickUp;
  /** Whether the bar is a phone's, whose title takes a bar title's type. */
  phone: boolean;
}): React.JSX.Element {
  return (
    <span
      className="ui-toolbar-pick-up"
      data-shown={pickUp.shown ? "true" : "false"}
      aria-hidden={pickUp.shown ? undefined : "true"}
    >
      <OneLine
        hint={pickUp.shown ? wholeWordsHint(pickUp.name) : undefined}
        className={phone ? PHONE_TITLE : TITLE}
      >
        {pickUp.name}
      </OneLine>
    </span>
  );
}

/** A workspace's bar: its lead, its heading (the title and its tag), and its actions, in that order. */
export function Toolbar({
  lead,
  title,
  titlePress,
  titleMenu,
  titleReplayUnmasked = false,
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
      <div className="ui-toolbar-heading">
        <TitleMenu
          menu={titlePress === undefined ? titleMenu : undefined}
          crumbs={trail !== undefined && trail.length > 0}
        >
          {trail !== undefined && trail.length > 0 && typeof title === "string" && title !== "" ? (
            <ReplayMask>
              <ToolbarTrail trail={trail} title={title} />
            </ReplayMask>
          ) : trail !== undefined && trail.length > 0 && !said(title) && pickUp !== undefined ? (
            <ReplayMask>
              <ToolbarTrail trail={trail} title={pickUp.name} shown={pickUp.shown} />
            </ReplayMask>
          ) : said(title) ? (
            <ToolbarTitle
              title={title}
              unmasked={titleReplayUnmasked}
              press={titlePress}
              menu={titleMenu}
              phone={look === TOOLBAR_LOOK.PHONE}
            />
          ) : pickUp !== undefined && pickUp.name !== "" ? (
            <ReplayMask>
              <ToolbarPickedUp pickUp={pickUp} phone={look === TOOLBAR_LOOK.PHONE} />
            </ReplayMask>
          ) : null}
        </TitleMenu>
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
  replayUnmasked = false,
}: {
  thing: NotFoundThing;
  /** The bar the place stands under; left out only where the state stands under a bar already drawn. */
  bar?: ToolbarProps | undefined;
  action?: EmptyStateAction | undefined;
  /** Whether its words, which name no thing, show in a screen recording (`EmptyState`'s `replayUnmasked`); its bar's title is the bar's own to mark. */
  replayUnmasked?: boolean | undefined;
}): React.JSX.Element {
  const state = (
    <EmptyState
      icon={<NotFoundIcon />}
      title={NOT_FOUND_TITLE}
      action={action}
      replayUnmasked={replayUnmasked}
    >
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
