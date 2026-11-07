import { LEAD_ROW, LEAD_SLOT, LEAD_WORDS } from "../numbered-steps/lead-row.js";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * waiting-line.tsx -- a wait on something outside the app, said as a line: the ring turning and what is awaited.
 *
 * Where a surface stands waiting on a person to finish elsewhere, a code
 * entered on another site, it says so in one line led by the one spinner,
 * standing from the start since the wait is the point, its words in the
 * label's type. It stands as a numbered step does (`lead-row.ts`), the ring
 * in the slot a step's number stands in, so under the steps its words start
 * where theirs do. The ring's words are the line's own, so a reader hears
 * the wait once.
 */

/** The ring, and `children` saying what is awaited. */
export function WaitingLine({ children }: { children: string }): React.JSX.Element {
  return (
    <div className={`ui-waiting-line ${LEAD_ROW}`}>
      <span className={LEAD_SLOT}>
        <Spinner label={children} size={SPINNER_SIZE.INLINE} delay={false} />
      </span>
      <div className={LEAD_WORDS}>
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} aria-hidden="true">
          {children}
        </Text>
      </div>
    </div>
  );
}
