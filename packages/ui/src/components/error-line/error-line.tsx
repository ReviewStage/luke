import type { ReactNode } from "react";
import { FieldError } from "../../shadcn/field.js";

/**
 * error-line.tsx -- what went wrong, on a line of its own under what it is about: a field's value, a setting's last write, a confirm's act.
 *
 * One line says it everywhere, so a refusal reads the same in a form, a
 * Settings row, and a confirm: `FormField`, `SettingsRow`, and
 * `ConfirmDialog` each draw theirs with it. It stands from the first render,
 * empty until it says something, in a polite live region, because a reader
 * announces a region filling more surely than one arriving; empty, it takes
 * no room, so the gap before it goes too. What it says is set in the
 * caption's type in the danger ink and drops into its line as it arrives. A
 * control it is about names it by its `id` (`aria-describedby`). It is drawn
 * by shadcn/ui's field error (`../../shadcn/field.tsx`).
 */

/** What went wrong, or nothing while nothing has. */
export function ErrorLine({
  id,
  children,
}: {
  /** The id a control it describes names it by. */
  id?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return <FieldError id={id}>{children}</FieldError>;
}
