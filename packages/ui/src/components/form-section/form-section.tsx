import { type FormEvent, type ReactNode, useId } from "react";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * form-section.tsx -- a form of fields: its heading and what it is for above them, what went wrong with the whole under them, and its actions at the end.
 *
 * The section is the `<form>` itself, so an Enter in one of its text fields
 * and a press of its `submit` button reach `onSubmit` alike, and the page
 * never reloads. It owns everything between its parts: the field gap between
 * one field (`FormField`) and the next, the room under its heading, and the
 * actions' line, which ends at the section's end edge with the control gap
 * between each button and wraps when they do not fit, so a caller sets no
 * length on a form. A field owns its own label, description, and error; the
 * section's `error` is what went wrong with the whole, a save the service
 * refused, and stands in a polite live region from the first render, as a
 * field's does, empty until it says something. A headed section is a form
 * landmark named by its heading and described by its words and its error.
 */

/** Whether words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A form of `children`, one field each, under `title`, ending in `actions`, answering a submit with `onSubmit`. */
export function FormSection({
  title,
  description,
  error,
  actions,
  onSubmit,
  children,
}: {
  /** The form's name, its `h2`, or nothing where what surrounds it names it. */
  title?: ReactNode;
  /** What the form is for, under its heading. */
  description?: ReactNode;
  /** What went wrong with the whole form, or nothing while nothing has. */
  error?: ReactNode;
  /** Its buttons, at the end of its last line, a submit among them. */
  actions?: ReactNode;
  /** What a submit does: an Enter in a text field or a press of a `submit` button. */
  onSubmit: () => void;
  /** The fields, a field's gap apart. */
  children: ReactNode;
}): React.JSX.Element {
  const id = useId();
  const titleId = `${id}title`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const headed = said(title);
  const described = said(description);
  const failed = said(error);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    <form
      className="luke-form-section"
      noValidate
      aria-labelledby={headed ? titleId : undefined}
      aria-describedby={describedBy === "" ? undefined : describedBy}
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {headed || described ? (
        <div className="luke-form-section-head">
          {headed ? (
            <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.H2} id={titleId}>
              {title}
            </Text>
          ) : null}
          {described ? (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} id={descriptionId}>
              {description}
            </Text>
          ) : null}
        </div>
      ) : null}
      <div className="luke-form-section-fields">{children}</div>
      <p className="luke-form-section-error" id={errorId} aria-live="polite">
        {failed ? error : null}
      </p>
      {actions === undefined ? null : <div className="luke-form-section-actions">{actions}</div>}
    </form>
  );
}
