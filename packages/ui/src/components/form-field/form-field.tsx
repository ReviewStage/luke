import { FIELD_WORDS } from "@luke/features/words";
import { type ReactNode, useId } from "react";
import type { ShownError } from "../../reported-failure.js";
import { Field, FieldDescription, FieldLabel } from "../../shadcn/field.js";
import { ErrorLine } from "../error-line/error-line.js";
import { LengthCounter } from "../length-counter/length-counter.js";

/**
 * form-field.tsx -- a control with the words around it: its label over it, what it is for under it, and what is wrong with it under that.
 *
 * The field mints the ids and hands its control everything it needs to be
 * read as one with its words, so no caller wires an id by hand: the label
 * names the control, the description and the error describe it, and an
 * error marks it invalid. The error is the one `ErrorLine` every form part
 * says what went wrong in, handed as what it says and whether it is the
 * person's input checked (`inputProblem`) or a failure of the app's, which
 * is reported and offers its details to copy. A field is to be filled unless it says otherwise:
 * one that may be left empty (`optional`) says Optional after its label, in
 * the label, so a reader hears it with the field's name, and the control of
 * one that may not is marked required (`aria-required`), never the native
 * `required`, whose browser bubble would stop a form's own submit. A field whose control takes
 * so many characters at most (`count`) says how many it holds of them at the
 * end of its label's line once they near the limit (`LengthCounter`). The field owns the room
 * between its parts; the room around it is its container's. It is drawn by
 * shadcn/ui's field (`../../shadcn/field.tsx`); its label keeps the
 * `luke-field-label` name a test finds it by.
 */

/** What a field hands the control it holds, spread onto an input or read by a control of its own. */
export interface FieldControl {
  /** The control's id, which the label names it by. */
  readonly id: string;
  /** The label's id, for a control that is named by `aria-labelledby` rather than a `<label>`. */
  readonly labelId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
  /** Whether the field is to be filled, which every field is unless it is `optional`. */
  readonly "aria-required": true | undefined;
}

/** Whether a field's words say anything: nothing, `null`, `false`, and an empty string say nothing. */
function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

/** The muted caption Optional is set in after a label, a short step off it. */
const OPTIONAL_MARK = "luke-field-optional ms-luke-6 text-caption font-text text-muted-foreground";

/** A control under `label`, described by `description`, and marked invalid by `error` while it says something. */
export function FormField({
  label,
  description,
  error,
  optional = false,
  count,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  /** Whether the field may be left empty, which its label then says. */
  optional?: boolean | undefined;
  /** What is wrong with the value, or what refused it, and the failure beneath; nothing while it is fine. */
  error?: ShownError | undefined;
  /** How many characters the control holds of the most it takes, where it takes a limited number. */
  count?: { readonly length: number; readonly limit: number } | undefined;
  children: (control: FieldControl) => ReactNode;
}): React.JSX.Element {
  const id = useId();
  const controlId = `${id}control`;
  const labelId = `${id}label`;
  const descriptionId = `${id}description`;
  const errorId = `${id}error`;
  const failed = error !== undefined && said(error.words);
  const described = said(description);
  const describedBy = [described ? descriptionId : undefined, failed ? errorId : undefined]
    .filter((part) => part !== undefined)
    .join(" ");
  const labelled = (
    <FieldLabel className="luke-field-label" id={labelId} htmlFor={controlId}>
      {/* Note that the words stand in a span of their own, which a readable region lets select where the label itself may not. */}
      <span className="luke-field-words">{label}</span>
      {optional ? <span className={OPTIONAL_MARK}>{FIELD_WORDS.OPTIONAL}</span> : null}
    </FieldLabel>
  );
  return (
    <Field data-invalid={failed}>
      {count === undefined ? (
        labelled
      ) : (
        <div className="flex min-w-0 items-baseline justify-between gap-control-gap">
          {labelled}
          <LengthCounter length={count.length} limit={count.limit} />
        </div>
      )}
      {children({
        id: controlId,
        labelId,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": failed ? true : undefined,
        "aria-required": optional ? undefined : true,
      })}
      {described ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <ErrorLine id={errorId} error={failed ? error : undefined} />
    </Field>
  );
}
