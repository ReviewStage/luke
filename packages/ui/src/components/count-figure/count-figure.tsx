/**
 * count-figure.tsx -- the one way a drawn count says its figure: a count past 99 is drawn "99+", and a reader still hears the whole number.
 *
 * Every count `@repo/ui` draws, a NavItem's, a group head's, a bar item's
 * badge, a glyph's corner, takes its figure from here, so a count never
 * widens its box past two digits and a plus. A figure drawn short is hidden
 * from a reader, who hears the whole number beside it instead, since "99+"
 * would say less than what waits.
 */

/** The largest figure a count draws whole; one past it is drawn as this and a plus. */
const COUNT_CAP = 99;

/** What a count draws: its figure, or "99+" past the cap. */
export function cappedCount(value: number): string {
  return value > COUNT_CAP ? `${COUNT_CAP}+` : String(value);
}

/** A count's figure as `cappedCount` draws it, with the whole number said to a reader where the drawing is short of it. */
export function CountFigure({ value }: { value: number }): React.JSX.Element {
  if (value <= COUNT_CAP) return <>{value}</>;
  return (
    <>
      <span aria-hidden="true">{cappedCount(value)}</span>
      <span className="ui-visually-hidden">{value}</span>
    </>
  );
}
