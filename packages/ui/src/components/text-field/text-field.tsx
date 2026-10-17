import type { ClipboardEvent, KeyboardEvent, Ref } from "react";
import { cssCustomProperties } from "../../css.js";
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
 * nothing is being composed. A field given an `onEscape` keeps every
 * Escape from whatever stands around it, but answers only one pressed while
 * nothing is being composed: the Escape that cancels a composition is the
 * input method's, and must not close the page the field stands on either.
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

/** What the system may fill a one-line field with: nothing, for a credential it must neither offer nor keep. */
export const TEXT_FIELD_AUTO_COMPLETE = {
  OFF: "off",
} as const;

export type TextFieldAutoComplete =
  (typeof TEXT_FIELD_AUTO_COMPLETE)[keyof typeof TEXT_FIELD_AUTO_COMPLETE];

/**
 * How a text entry is named: by its `FormField`'s label, through the field's
 * control, or by a `label` of its own where it stands alone, so none is
 * drawn without a name.
 */
type Named =
  | {
      /** The field's control, inside a `FormField`. */
      field: FieldControl;
      label?: undefined;
    }
  | {
      field?: undefined;
      /** The accessible name, where no `FormField` labels it. */
      label: string;
    };

/** What both kinds of text entry take. */
type TextEntryProps = Named & {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  /** Whether the form it stands in refuses to submit while it is empty, or, for an address, malformed. */
  required?: boolean | undefined;
  autoFocus?: boolean | undefined;
  name?: string | undefined;
  maxLength?: number | undefined;
  /** Whether the system's spell check marks the words; off for a name, an identifier, or code. */
  spellCheck?: boolean | undefined;
  /** What an Escape does, pressed while no input method is composing; no Escape reaches the page, which it would close. */
  onEscape?: (() => void) | undefined;
};

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
    required: props.required,
    autoFocus: props.autoFocus,
    name: props.name,
    maxLength: props.maxLength,
    spellCheck: props.spellCheck,
    value: props.value,
  };
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Keeps an Escape from the page where `onEscape` is given, as a SearchField
 * does, and answers it unless an input method is composing. Note that a
 * composing Escape keeps its default, because the input method may cancel
 * its candidates by it.
 */
function answerEscape(event: KeyboardEvent, onEscape: (() => void) | undefined): void {
  if (event.key !== "Escape" || onEscape === undefined) return;
  event.stopPropagation();
  if (composing(event)) return;
  event.preventDefault();
  onEscape();
}

/** One line of text, answering Enter with `onEnter` where it is given. */
export function TextField({
  type = TEXT_FIELD_TYPE.TEXT,
  autoComplete,
  onEnter,
  ref,
  ...props
}: TextEntryProps & {
  type?: TextFieldType;
  /** What the system may fill the field with; the browser's own choice where none is named. */
  autoComplete?: TextFieldAutoComplete | undefined;
  /** What an Enter does, pressed while no input method is composing. */
  onEnter?: (() => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  return (
    <input
      ref={ref}
      className="luke-text-field"
      type={type}
      autoComplete={autoComplete}
      {...entryAttributes(props)}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        answerEscape(event, props.onEscape);
        if (event.key !== "Enter" || onEnter === undefined || composing(event)) return;
        event.preventDefault();
        onEnter();
      }}
    />
  );
}

/**
 * Many lines of text, `rows` tall to start, growing a scroll of its own past
 * that, or, where it may `grow`, growing with its words up to the profile's
 * tallest note before it scrolls, with no handle to size it by.
 */
export function TextArea({
  rows = 4,
  grow = false,
  onPaste,
  ref,
  ...props
}: TextEntryProps & {
  rows?: number;
  /** Whether it grows with its words from `rows` tall, rather than standing at that height. */
  grow?: boolean;
  /** What a paste does before the text arrives, for a caller that takes pasted files itself. */
  onPaste?: ((event: ClipboardEvent<HTMLTextAreaElement>) => void) | undefined;
  ref?: Ref<HTMLTextAreaElement> | undefined;
}): React.JSX.Element {
  return (
    <textarea
      ref={ref}
      className="luke-text-field"
      rows={rows}
      data-grow={grow}
      // Note that a growing note sizes to its words, which the browser does
      // without reading `rows`, so its rows reach its stylesheet as its least height.
      style={grow ? cssCustomProperties({ "--luke-text-area-rows": rows }) : undefined}
      {...entryAttributes(props)}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => answerEscape(event, props.onEscape)}
      onPaste={onPaste}
    />
  );
}
