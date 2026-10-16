import type { ReactNode } from "react";
import { useClipped } from "./use-clipped";

/**
 * hover-card.tsx -- the parts every hover card is drawn from: its head, its notes, and its rule, in one type scale.
 *
 * A control with more to say than a pill hangs a card in the pill's place
 * (`tooltip.tsx`'s `card`), and every card the window hangs, a plan's, a
 * pinned tab's, a skill's, an agent tab's, a summary row's, a Changes
 * tab's, a turn's, and a call's, says what it says in these parts, so the
 * same name reads at the same size wherever the pointer rests. The head is
 * the subject's glyph where it wears one, its name in the card's one weight,
 * wrapped to two lines, or on one line faded where it is cut short as a
 * tab's label is; under the name, a quieter line of what it runs on or
 * whose it is; and at the head's right its corner, muted: how long ago, how
 * it ended, or how many wait. Under the head stand its notes, read whole
 * and so wrapped to three lines, or one line faded at its end, and a rule
 * before what a card lists under it. The sizes are the stylesheet's, on the
 * `card-` classes (desktop.css), which only these parts draw.
 *
 * A card says what its subject is and offers no way to it, no "Open agent"
 * under a rule, because the control it hangs from opens the subject on a
 * press. Where that control's press does something else, as a group
 * header's folds, the card's own name is the way in; its rows may still
 * open what they name, another thing than the card's subject.
 */

/** The data attributes a card's root carries, which name the card for a test or a capture. */
type CardMarks = { readonly [mark: `data-${string}`]: string | undefined };

/** A name or a note on one line, faded at its end where it is cut short. */
function OneLine({
  className,
  as: Element,
  children,
}: {
  className: string;
  as: "span" | "p";
  children: ReactNode;
}): React.JSX.Element {
  const [line, clipped] = useClipped();
  return (
    <Element ref={line} className={className} data-one-line="" data-overflow={String(clipped)}>
      {children}
    </Element>
  );
}

/** A card's root: its parts in a column, one gap apart. */
export function HoverCard({
  children,
  ...marks
}: { children: ReactNode } & CardMarks): React.JSX.Element {
  return (
    <div {...marks} className="card">
      {children}
    </div>
  );
}

/** A card's head: its glyph where it wears one, its name and the line under it, and its corner. */
export function CardHead({
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
    <div className="card-head">
      {glyph === undefined ? null : <span className="card-glyph">{glyph}</span>}
      <div className="card-title">
        {oneLine ? (
          <OneLine className="card-name" as="span">
            {name}
          </OneLine>
        ) : (
          <span className="card-name">{name}</span>
        )}
        {sub === undefined ? null : <span className="card-sub">{sub}</span>}
      </div>
      {corner === undefined ? null : <span className="card-corner">{corner}</span>}
    </div>
  );
}

/** Words under a card's head, wrapped to three lines, or on one line faded where it is cut short. */
export function CardNote({
  oneLine = false,
  children,
}: {
  oneLine?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return oneLine ? (
    <OneLine className="card-note" as="p">
      {children}
    </OneLine>
  ) : (
    <p className="card-note">{children}</p>
  );
}

/** The hairline before what a card lists under its head. */
export function CardRule(): React.JSX.Element {
  return <hr className="card-rule" />;
}
