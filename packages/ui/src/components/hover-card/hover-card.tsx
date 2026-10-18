import type { ReactNode } from "react";
import { ClippedLine, ONE_LINE_ELEMENT, ONE_LINE_END } from "../one-line/clipped-line.js";

/**
 * hover-card.tsx -- the parts every hover card is drawn from: its head, its notes, and its rule, in one type scale.
 *
 * A control with more to say than a pill hangs a card in the pill's place
 * (`TooltipCard`), and every card an app hangs says what it says in these
 * parts, so the same name reads at the same size wherever the pointer rests.
 * The head is the subject's glyph where it wears one, its name in the card's
 * one weight, wrapped to two lines, or on one line faded where it is cut
 * short as a tab's label is; under the name, a quieter line of what it runs
 * on or whose it is; and at the head's right its corner, muted: how long ago,
 * how it ended, or how many wait. Under the head stand its notes, read whole
 * and so wrapped to three lines, or one line faded at its end, and a rule
 * before what a card lists under it.
 *
 * A card's rows are set as a menu's rows are: a glyph on the head's glyph
 * column, words on one line cut short with an ellipsis, and what stands at
 * the row's end, muted. A quieter row under the name (`DETAIL`) says where
 * the subject lives or who made it; a row of a list under a rule (`LINE`)
 * names one of the things the subject holds. Either is a button where a
 * press opens what it names and text where nothing does, in the same place
 * either way, washed under the pointer as a menu row is. A list counts what
 * it leaves out on a last line of its own.
 *
 * What is drawn here is the card's words alone. The surface it stands on,
 * when it shows, how long it lingers for the pointer to cross onto it, and
 * what its subject is read from are the app's.
 *
 * A card says what its subject is and offers no way to it, no "Open agent"
 * under a rule, because the control it hangs from opens the subject on a
 * press. Where that control's press does something else, as a group
 * header's folds, the card's own name is the way in; its rows may still
 * open what they name, another thing than the card's subject.
 */

/** The data attributes a card's root carries, which name the card for a test or a capture. */
type HoverCardMarks = { readonly [mark: `data-${string}`]: string | undefined };

/** How a card's row is set: a quieter line under its name, or a row of a list under a rule. */
export const HOVER_CARD_ROW_LOOK = {
  DETAIL: "detail",
  LINE: "line",
} as const;

export type HoverCardRowLook = (typeof HOVER_CARD_ROW_LOOK)[keyof typeof HOVER_CARD_ROW_LOOK];

/** A card's root: its parts in a column, one gap apart. */
export function HoverCard({
  children,
  ...marks
}: { children: ReactNode } & HoverCardMarks): React.JSX.Element {
  return (
    <div {...marks} className="luke-hover-card">
      {children}
    </div>
  );
}

/** A card's head: its glyph where it wears one, its name and the line under it, and its corner. */
export function HoverCardHead({
  glyph,
  name,
  oneLine = false,
  sub,
  corner,
}: {
  glyph?: ReactNode;
  name: ReactNode;
  /** Whether the name stands on one line, faded where it is cut short, rather than wrapping to two: a task standing in for a title. */
  oneLine?: boolean;
  /** The quieter line under the name: what the subject runs on, whose it is, or when it ran. */
  sub?: ReactNode;
  /** What stands muted at the head's right. */
  corner?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="luke-hover-card-head">
      {glyph === undefined ? null : <span className="luke-hover-card-glyph">{glyph}</span>}
      <div className="luke-hover-card-title">
        {oneLine ? (
          <ClippedLine
            className="luke-hover-card-name"
            as={ONE_LINE_ELEMENT.SPAN}
            end={ONE_LINE_END.FADE}
          >
            {name}
          </ClippedLine>
        ) : (
          <span className="luke-hover-card-name">{name}</span>
        )}
        {sub === undefined ? null : <span className="luke-hover-card-sub">{sub}</span>}
      </div>
      {corner === undefined ? null : <span className="luke-hover-card-corner">{corner}</span>}
    </div>
  );
}

/** Words under a card's head, wrapped to three lines, or on one line faded where it is cut short. */
export function HoverCardNote({
  oneLine = false,
  children,
}: {
  oneLine?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return oneLine ? (
    <ClippedLine className="luke-hover-card-note" as={ONE_LINE_ELEMENT.P} end={ONE_LINE_END.FADE}>
      {children}
    </ClippedLine>
  ) : (
    <p className="luke-hover-card-note">{children}</p>
  );
}

/** The hairline before what a card lists under its head. */
export function HoverCardRule(): React.JSX.Element {
  return <hr className="luke-hover-card-rule" />;
}

/** A row of a card: its glyph, its words on one line, and what stands at its end; a button where a press opens what it names. */
export function HoverCardRow({
  look = HOVER_CARD_ROW_LOOK.LINE,
  glyph,
  label,
  end,
  onPress,
}: {
  look?: HoverCardRowLook;
  glyph: ReactNode;
  label: ReactNode;
  /** What stands muted at the row's end: a size, a time, or a mark. */
  end?: ReactNode;
  /** Opens what the row names; a row without it is text. */
  onPress?: (() => void) | undefined;
}): React.JSX.Element {
  const row = (
    <>
      <span className="luke-hover-card-row-glyph">{glyph}</span>
      <span className="luke-hover-card-row-label">{label}</span>
      {end === undefined ? null : <span className="luke-hover-card-row-end">{end}</span>}
    </>
  );
  return onPress === undefined ? (
    <span className="luke-hover-card-row" data-look={look}>
      {row}
    </span>
  ) : (
    <button type="button" className="luke-hover-card-row" data-look={look} onClick={onPress}>
      {row}
    </button>
  );
}

/** A list a card holds under a rule, named by `label`: its rows, each an `li` of the caller's, and a last line counting what it leaves out. */
export function HoverCardList({
  label,
  more,
  children,
}: {
  label: string;
  /** How many it leaves out, in words ("2 more"); nothing where it leaves nothing out. */
  more?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ul className="luke-hover-card-list" aria-label={label}>
      {children}
      {more === undefined ? null : <li className="luke-hover-card-more">{more}</li>}
    </ul>
  );
}
