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
 * - `lead` stands first: a way back, crumbs, or a tab strip, controls the
 *   bar lays at its control gap and lets shrink before the actions do.
 * - The heading takes the room left, whether or not it holds a title, so
 *   the actions always end the bar. Its `title` is the page's name, drawn as
 *   its level-one heading on one line that fades out where the bar cuts it,
 *   as a row's name does, its hint reading it whole; a title that is more than words (an
 *   editable name, its skeleton block) stands there as given.
 * - `tag` follows the title on its last baseline: a capsule naming the
 *   page's state (an experiment), or a switch of its view.
 * - `actions` end the bar, at the control gap.
 *
 * A document's page draws the bar with no title of its own, since its header
 * names it in the page (`PageHeader`), and hands it `pickUp`: the header's
 * name, which the bar shows in its title's place only once the header has
 * scrolled away, fading in and out on the motion tokens. Note that the copy
 * is words, never a heading, because the header's title is the page's one
 * `h1`, and that it is hidden from a reader while the header is in view, so
 * the name is read once.
 *
 * Each edge is inset by name (`TOOLBAR_INSET`): a bar that starts or ends
 * on words stands them where its column's words start, and one that starts
 * or ends on a control stands it at the column's own edge, where a tab's
 * fill starts. Where the window's own buttons stand over an edge (the
 * folded sidebar's toggle, the side panel's), the shell moves that edge
 * clear of them.
 *
 * A place the window cannot show keeps its bar (`NotFound`), so a link to
 * something gone still leaves its way back and the window's drag handle
 * where every page has them, and says so in the room under it.
 */

import type { ReactNode } from "react";
import { NotFoundIcon } from "../../icons/lucide-glyphs.js";
import { EmptyState, type EmptyStateAction } from "../empty-state/empty-state.js";
import { FILL_ELEMENT, Fill } from "../layout/layout.js";
import { ONE_LINE_ELEMENT, OneLine } from "../one-line/one-line.js";
import { wholeWordsHint } from "../tooltip/hint.js";
import { TOOLBAR_INSET, ToolbarFrame, type ToolbarInset } from "./toolbar-frame.js";

export { TOOLBAR_INSET, type ToolbarInset };

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

/** A document's name as the bar picks it up from the page's header: shown only once the header has scrolled away. */
export interface ToolbarPickUp {
  /** The header's title in words; none draws nothing. */
  readonly name: string;
  /** Whether the header has scrolled away, so the bar shows the name. */
  readonly shown: boolean;
}

/** What a workspace's bar holds, each slot drawn only where it says something. */
export interface ToolbarProps {
  /** What stands first: a way back, crumbs, or a tab strip. */
  readonly lead?: ReactNode;
  /** The page's name, drawn as its heading on one line; a node that is more than words stands as given. */
  readonly title?: ReactNode;
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
}

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The page's name as the bar's heading: words on one line, fading where cut and read whole by the hint; anything else as given. */
function ToolbarTitle({ title }: { title: ReactNode }): React.JSX.Element {
  if (typeof title !== "string") return <>{title}</>;
  return (
    <OneLine
      as={ONE_LINE_ELEMENT.H1}
      hint={wholeWordsHint(title)}
      className="luke-toolbar-title desktop-toolbar-title"
    >
      {title}
    </OneLine>
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
      <OneLine
        hint={pickUp.shown ? wholeWordsHint(pickUp.name) : undefined}
        className="luke-toolbar-title"
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
  pickUp,
  tag,
  actions,
  start,
  end,
}: ToolbarProps): React.JSX.Element {
  return (
    <ToolbarFrame start={start} end={end}>
      {said(lead) ? <div className="luke-toolbar-lead">{lead}</div> : null}
      <div className="luke-toolbar-heading desktop-toolbar-heading">
        {said(title) ? (
          <ToolbarTitle title={title} />
        ) : pickUp !== undefined && pickUp.name !== "" ? (
          <ToolbarPickedUp pickUp={pickUp} />
        ) : null}
        {said(tag) ? <span className="luke-toolbar-tag">{tag}</span> : null}
      </div>
      {said(actions) ? (
        <div className="luke-toolbar-actions desktop-toolbar-actions">{actions}</div>
      ) : null}
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
