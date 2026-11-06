import type { ReactNode } from "react";
import { SPINNER_SIZE, Spinner } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * waiting-line.tsx -- a wait on something outside the app, said as a line: the ring turning, what is awaited, and a muted hint under it.
 *
 * Where a surface stands waiting on a person to finish elsewhere, a code
 * entered on another site, it says so in one line led by the one spinner,
 * standing from the start since the wait is the point, its words in the
 * label's type and a hint under them in the caption's muted ink. The ring's
 * words are the line's own, so a reader hears the wait once.
 */

/** The ring, `children` saying what is awaited, and `hint` under them where one is given. */
export function WaitingLine({
  hint,
  children,
}: {
  hint?: ReactNode;
  children: string;
}): React.JSX.Element {
  return (
    <div className="ui-waiting-line flex items-start gap-control-gap">
      <span className="flex h-ui-20 flex-none items-center">
        <Spinner label={children} size={SPINNER_SIZE.INLINE} delay={false} />
      </span>
      <div className="flex min-w-0 flex-col gap-tight-gap">
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.LABEL} aria-hidden="true">
          {children}
        </Text>
        {hint === undefined ? null : (
          <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {hint}
          </Text>
        )}
      </div>
    </div>
  );
}
