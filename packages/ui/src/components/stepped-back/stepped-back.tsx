import type { ReactNode } from "react";

/**
 * stepped-back.tsx -- a region whose controls stand stepped back: what was asked once and is asked no longer, in the muted ink at full strength.
 *
 * A settled choice list steps the options nobody picked back to an outline
 * in muted words (`ChoiceList`'s `settled`). This region draws every
 * control inside it the same way, so an ask taken back reads as history
 * rather than as one still waiting or one answered: a choice's rows lose
 * their fill for that outline, a checkbox's words and a field's name go to
 * the muted ink, and a button's words and edge go quiet. Note that it fades
 * nothing by opacity, which would leave a control looking half pressable,
 * and lights nothing, so none of an answer's tells (a pick, a tick, a lit
 * press) is ever drawn here. The controls inside it are the caller's to
 * hold read-only; the region draws no box of its own, so what holds it lays
 * them out as before.
 */

/** Controls drawn stepped back, as what was asked and is no longer. */
export function SteppedBack({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-stepped-back" data-stepped-back="">
      {children}
    </div>
  );
}
