import { FIELD_WORDS } from "@repo/features/words";
import { type ReactNode, useId } from "react";
import type { ShownError } from "../../reported-failure.js";
import { Field, FieldDescription, FieldLabel } from "../../shadcn/field.js";
import { ErrorLine } from "../error-line/error-line.js";
import { LengthCounter } from "../length-counter/length-counter.js";

export interface FieldControl {
  readonly id: string;
  readonly labelId: string;
  readonly "aria-describedby": string | undefined;
  readonly "aria-invalid": true | undefined;
  readonly "aria-required": true | undefined;
}

function said(words: ReactNode): boolean {
  return words !== undefined && words !== null && words !== false && words !== "";
}

const OPTIONAL_MARK = "ui-field-optional ms-ui-6 text-caption font-text text-muted-foreground";

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
  optional?: boolean | undefined;
  error?: ShownError | undefined;
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
  const labeled = (
    <FieldLabel className="ui-field-label" id={labelId} htmlFor={controlId}>
      <span className="ui-field-words">{label}</span>
      {optional ? <span className={OPTIONAL_MARK}>{FIELD_WORDS.OPTIONAL}</span> : null}
    </FieldLabel>
  );
  return (
    <Field data-invalid={failed}>
      {count === undefined ? (
        labeled
      ) : (
        <div className="flex min-w-0 items-baseline justify-between gap-control-gap">
          {labeled}
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
