import type { KeyboardEvent, Ref } from "react";
import type { FieldControl } from "../form-field/form-field.js";

/**
 * text-field.tsx -- the text-entry family: a one-line TextField and a many-line TextArea, each holding the value its caller holds.
 *
 * Both are controlled: the caller owns the value and answers every change,
 * so what is drawn is always what the caller has. Inside a `FormField`
 * each takes the field's control (`field`), which names it by the field's
 * label, describes it by the field's words, and marks it invalid while the
 * field says something is wrong; standing alone it is named by `label`.
 *
 * Text arriving through an input method (a Japanese or Chinese IME, the
 * Mac's accent menu) is composed in place before it is committed. Its
 * changes reach `onChange` as they come, as any other typing does, but the
 * Enter that commits a composition is the input method's, not the
 * caller's, so a TextField's `onEnter` answers only an Enter pressed while
 * nothing is being composed.
 */

/** What a one-line field holds: words, a search, an address, or a secret. */
export const TEXT_FIELD_TYPE = {
  TEXT: "text",
  SEARCH: "search",
  EMAIL: "email",
  URL: "url",
  PASSWORD: "password",
} as const;

export type TextFieldType = (typeof TEXT_FIELD_TYPE)[keyof typeof TEXT_FIELD_TYPE];

/** What both kinds of text entry take. */
interface TextEntryProps {
  value: string;
  onChange: (value: string) => void;
  /** The field's control, inside a `FormField`. */
  field?: FieldControl | undefined;
  /** The accessible name, where no `FormField` labels it. */
  label?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  autoFocus?: boolean | undefined;
  name?: string | undefined;
  maxLength?: number | undefined;
}

/** The attributes a text entry carries for its field, or its own name where it has none. */
function entryAttributes(props: TextEntryProps) {
  return {
    id: props.field?.id,
    "aria-label": props.field === undefined ? props.label : undefined,
    "aria-describedby": props.field?.["aria-describedby"],
    "aria-invalid": props.field?.["aria-invalid"],
    placeholder: props.placeholder,
    disabled: props.disabled,
    readOnly: props.readOnly,
    autoFocus: props.autoFocus,
    name: props.name,
    maxLength: props.maxLength,
    value: props.value,
  };
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** One line of text, answering Enter with `onEnter` where it is given. */
export function TextField({
  type = TEXT_FIELD_TYPE.TEXT,
  onEnter,
  ref,
  ...props
}: TextEntryProps & {
  type?: TextFieldType;
  /** What an Enter does, pressed while no input method is composing. */
  onEnter?: (() => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  return (
    <input
      ref={ref}
      className="luke-text-field"
      type={type}
      {...entryAttributes(props)}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || onEnter === undefined || composing(event)) return;
        event.preventDefault();
        onEnter();
      }}
    />
  );
}

/** Many lines of text, `rows` tall to start, growing a scroll of its own past that. */
export function TextArea({
  rows = 4,
  ref,
  ...props
}: TextEntryProps & {
  rows?: number;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}): React.JSX.Element {
  return (
    <textarea
      ref={ref}
      className="luke-text-field"
      rows={rows}
      {...entryAttributes(props)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  );
}
