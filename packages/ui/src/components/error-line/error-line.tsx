import { type ReactNode, useEffect, useRef } from "react";
import { FieldError } from "../../shadcn/field.js";
import { ANNOUNCE, type Announce, announce } from "../announcer/announcer.js";

/**
 * error-line.tsx -- what went wrong, on a line of its own under what it is about: a field's value, a setting's last write, a confirm's act.
 *
 * One line says it everywhere, so a refusal reads the same in a form, a
 * Settings row, and a confirm: `FormField`, `SettingsRow`, and
 * `ConfirmDialog` each draw theirs with it. It stands from the first render,
 * empty until it says something; empty, it takes no room, so the gap before
 * it goes too. What it says is set in the caption's type in the danger ink
 * and drops into its line as it arrives, and is said through the window's
 * `Announcer` as it changes, politely unless `level` asks for an alert, as
 * a Settings row's refused write does. A control it is about names it by its
 * `id` (`aria-describedby`). It is drawn by shadcn/ui's field error
 * (`../../shadcn/field.tsx`).
 */

/** What went wrong, or nothing while nothing has. */
export function ErrorLine({
  id,
  level = ANNOUNCE.POLITE,
  children,
}: {
  /** The id a control it describes names it by. */
  id?: string | undefined;
  /** How loudly its words are said as they arrive; politely where none is named. */
  level?: Announce | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  const line = useRef<HTMLParagraphElement>(null);
  const said = useRef<string | undefined>(undefined);
  // Note that the words are read off the drawn line, because a caller may
  // hand them as any node, and the words it first draws are not said, as a
  // live region's are not.
  useEffect(() => {
    const words = line.current?.textContent ?? "";
    const first = said.current === undefined;
    if (words === said.current) return;
    said.current = words;
    if (!first) announce(level, words);
  });
  return (
    <FieldError ref={line} id={id}>
      {children}
    </FieldError>
  );
}
