import { type ReactNode, useId } from "react";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { STATUS_TONE } from "../../status-tone.js";
import {
  DisclosureChevron,
  type DisclosureControl,
  DisclosureScope,
  useDisclosureFold,
} from "../disclosure/disclosure.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { NAV_COUNT_SHOWN, type NavCount } from "../nav-item/nav-item.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * group-header.tsx -- the head over a group of rows, which may fold the group: the sidebar's repositories and sections, the Inbox's plans, the Tasks list's groups and the Board's columns, a Settings list's and the person page's sections alike.
 *
 * It is one row in the group role's type (`TEXT_VARIANT.GROUP`): the group's
 * glyph, its label, a mark said after the label (a pinned repository's pin),
 * and the count its caller hands it. The count is the caller's to give or
 * leave out, at any value and shown at rest or only under the pointer, since
 * when a group counts its rows is the surface's choice, not this one's.
 *
 * A group that folds (`fold`) is pressed on its head, which says whether the
 * group stands open in `aria-expanded`. The fold is a Disclosure's
 * (`useDisclosureFold`): a press that opens unrolls the rows as they fade in,
 * a press that closes fades them out before they leave the layout, and the
 * chevron is the Disclosure's own, turning on the one turn every fold makes
 * (disclosure.css), all timed on the motion tokens reduced motion zeroes. The
 * glyph gives way to the chevron while the head is hovered or has the
 * keyboard; a head with no glyph draws its chevron at rest, so a fold always
 * says it folds. A fold its holder keeps, as the sidebar keeps which groups
 * are folded, is handed `open` and hears `onOpenChange`.
 *
 * Note that the head is a heading holding a button, beside the group's
 * actions, rather than a `details` summary holding them, because a summary
 * is read as one button and would swallow the heading and the actions in it.
 * A closed group's rows are not drawn at all, so a find in the page passes
 * them by, as a sidebar's folded rows are passed by.
 *
 * A group's actions (a repository's ⋯ and +) stand at the head's end beside
 * the fold, so pressing one folds nothing, shown while the head is hovered
 * or holds the focus, and at rest where there is no hover. A right-click on
 * the head is the ⋯'s second door (`contextMenu`), and the head stays ringed
 * while the menu it opened stands (`menuOpen`).
 */

/** The element a head stands in: a heading at its level in the page's outline, or none, for a head that is no heading. */
export const GROUP_HEADING = {
  H2: "h2",
  H3: "h3",
  H4: "h4",
  NONE: "div",
} as const;
export type GroupHeading = (typeof GROUP_HEADING)[keyof typeof GROUP_HEADING];

/** How a group folds: open from the start or not, or as its holder keeps it. */
export type GroupFold = { readonly defaultOpen: boolean } | DisclosureControl;

/** Whether a slot says anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(node: ReactNode): boolean {
  return node !== undefined && node !== null && node !== false && node !== "";
}

/** The count after the label, read with its noun, at whatever value its caller gave. */
function Count({ count }: { count: NavCount }): React.JSX.Element {
  return (
    <span
      className="luke-group-header-count"
      data-shown={count.shown ?? NAV_COUNT_SHOWN.ALWAYS}
      data-tone={count.tone ?? STATUS_TONE.NEUTRAL}
    >
      {count.value}
      {count.noun === undefined ? null : (
        <span className="luke-visually-hidden"> {count.noun}</span>
      )}
    </span>
  );
}

/** What the head's lead says: the glyph and the chevron it gives way to, the label, the mark, the count. */
function Lead({
  glyph,
  folds,
  label,
  mark,
  count,
}: {
  glyph: ReactNode;
  folds: boolean;
  label: string;
  mark: ReactNode;
  count: NavCount | undefined;
}): React.JSX.Element {
  return (
    <>
      {said(glyph) || folds ? (
        <span className="luke-group-header-glyph" aria-hidden="true">
          {said(glyph) ? <span className="luke-group-header-icon">{glyph}</span> : null}
          {folds ? (
            <span className="luke-group-header-chevron">
              <DisclosureChevron />
            </span>
          ) : null}
        </span>
      ) : null}
      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP} truncate>
        {label}
      </Text>
      {said(mark) ? <span className="luke-group-header-mark">{mark}</span> : null}
      {count === undefined ? null : <Count count={count} />}
    </>
  );
}

/** A group's head and the rows under it, which a press on the head folds where the group folds. */
export function GroupHeader({
  label,
  glyph,
  mark,
  count,
  actions,
  fold,
  heading = GROUP_HEADING.H2,
  menuOpen = false,
  contextMenu,
  children,
}: {
  /** The group's name. */
  label: string;
  /** The group's glyph, decoration a reader is not told. */
  glyph?: ReactNode;
  /** Said after the label, quietly: a pinned repository's pin. */
  mark?: ReactNode;
  /** The count after the label, drawn as given; left out, nothing is counted. */
  count?: NavCount | undefined;
  /** The group's buttons at the head's end, beside the fold rather than inside it. */
  actions?: ReactNode;
  /** How the group folds; left out, the head folds nothing and the rows always stand. */
  fold?: GroupFold | undefined;
  heading?: GroupHeading;
  /** Whether a menu the head opened stands, which keeps it ringed and its actions shown. */
  menuOpen?: boolean;
  /** The menu a right-click or a long press opens on the head (`useMenu`'s `contextMenu`). */
  contextMenu?: ContextMenuProps | undefined;
  /** The group's rows. */
  children?: ReactNode;
}): React.JSX.Element {
  const rowsId = useId();
  const folds = fold !== undefined;
  const { state, details } = useDisclosureFold(
    fold !== undefined && "defaultOpen" in fold ? fold.defaultOpen : true,
    fold !== undefined && "open" in fold ? fold : undefined,
  );
  // Note that a group with no rows draws no body, so its fold names none.
  const rows = (!folds || state.drawn) && said(children);
  const Heading = heading;
  const lead = <Lead glyph={glyph} folds={folds} label={label} mark={mark} count={count} />;
  return (
    <DisclosureScope state={state}>
      <div
        className="luke-group-header"
        data-folds={folds ? "true" : undefined}
        data-disclosure={folds ? details["data-disclosure"] : undefined}
      >
        <div
          className="luke-group-header-head"
          data-menu-open={menuOpen ? "true" : undefined}
          {...withContextMenu<HTMLDivElement>(contextMenu, {})}
        >
          <Heading className="luke-group-header-heading">
            {folds ? (
              <button
                type="button"
                className="luke-group-header-lead"
                aria-expanded={state.open}
                aria-controls={rows ? rowsId : undefined}
                onClick={pulseOnPress(state.toggle, PRESS_PULSE.QUIET)}
              >
                {lead}
              </button>
            ) : (
              <span className="luke-group-header-lead">{lead}</span>
            )}
          </Heading>
          {said(actions) ? <span className="luke-group-header-actions">{actions}</span> : null}
        </div>
        {/* Note that the rows are the root's own child, the body disclosure.css unrolls and fades. */}
        {rows ? (
          <div
            ref={folds ? state.body : undefined}
            id={rowsId}
            className="luke-disclosure-body"
            data-inset="none"
            inert={folds && state.leaving}
          >
            {children}
          </div>
        ) : null}
      </div>
    </DisclosureScope>
  );
}
