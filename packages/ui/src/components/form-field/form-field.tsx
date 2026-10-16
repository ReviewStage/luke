import { type ReactNode, useId } from "react";

/**
 * form-field.tsx -- a control with the words around it: its label over it, what it is for under it, and what is wrong with it under that.
 *
 * The field mints the ids and hands its control everything it needs to be
 * read as one with its words, so no caller wires an id by hand: the label
 * names the control, the description and the error describe it, and an
 * error marks it invalid. The error stands in a polite live region from the
 * first render, empty until it says something, because a reader announces a
 * region filling more surely than one arriving. The field owns the room
 * between its parts; the room around it is its container's.
 */

/** What a field hands the control it holds, spread onto an input or read by a control of its own. */
export interface FieldControl {
  /** The control's id, which the label names it by. */
  readonly id: string;
  /** The label's id, for a control that is named by `aria-labelledby` rather than a `<label>`. */
  readonly labelId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
}

/** Whether a field's words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** A control under `label`, described by `description`, and marked invalid by `error` while it says something. */
export function FormField({
  label,
  description,
  error,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** What is wrong with the value, or nothing while it is fine. */
  error?: ReactNode;
  children: (control: FieldControl) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const controlId = `${id}control`;
  const labelId = `${id}label`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const failed = said(error);
  const described = said(description);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  return (
    <div className="luke-field" data-invalid={failed}>
      <label className="luke-field-label" id={labelId} htmlFor={controlId}>
        {label}
      </label>
      {children({
        id: controlId,
        labelId,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": failed ? true : undefined,
      })}
      {described ? (
        <p className="luke-field-description" id={descriptionId}>
          {description}
        </p>
      ) : null}
      <p className="luke-field-error" id={errorId} aria-live="polite">
        {failed ? error : null}
      </p>
    </div>
  );
}
