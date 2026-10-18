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
 * field says something is wrong; standing alone it is named by `label`, and
 * marked invalid by `invalid`, as a `SettingsRow` failing its write says.
 *
 * Text arriving through an input method (a Japanese or Chinese IME, the
 * Mac's accent menu) is composed in place before it is committed. Its
 * changes reach `onChange` as they come, as any other typing does, but the
 * Enter that commits a composition is the input method's, not the
 * caller's, so a TextField's `onEnter` answers only an Enter pressed while
 * nothing is being composed. A field given an `onEscape` marks every
 * Escape taken, but answers only one pressed while nothing is being
 * composed: the Escape that cancels a composition is the input method's,
 * and must not close the page the field stands on either. A TextArea's
 * `onSubmit` answers ⌘Return (Ctrl+Enter off the Mac) on the same terms,
 * leaving a plain Return to start a new line; or, for a note sent as a
 * chat message is, a plain Return, leaving Shift-Return the new line.
 *
 * A number field holds a number, or nothing while it is empty or holds what
 * is not yet one (a lone minus sign), as the browser reads it; a busy text
 * area, its words on their way somewhere, takes no typing and answers
 * neither Escape nor ⌘Return until it is not.
 */

/** What a one-line field holds: words, a search, an address, a secret, a time of day, or a number. */
export const TEXT_FIELD_TYPE = {
  TEXT: "text",
  SEARCH: "search",
  EMAIL: "email",
  URL: "url",
  PASSWORD: "password",
  TIME: "time",
  NUMBER: "number",
} as const;

export type TextFieldType = (typeof TEXT_FIELD_TYPE)[keyof typeof TEXT_FIELD_TYPE];

/** How large a one-line field stands: a control, or a page's title written in place, without a well. */
export const TEXT_FIELD_SIZE = {
  CONTROL: "control",
  TITLE: "title",
} as const;

export type TextFieldSize = (typeof TEXT_FIELD_SIZE)[keyof typeof TEXT_FIELD_SIZE];

/** The face a field's words are set in: the body's, or a fixed width for code, a cron or a path. */
export const TEXT_FIELD_FONT = {
  BODY: "body",
  MONO: "mono",
} as const;

export type TextFieldFont = (typeof TEXT_FIELD_FONT)[keyof typeof TEXT_FIELD_FONT];

/** What the system may fill a one-line field with: nothing, for a credential it must neither offer nor keep. */
export const TEXT_FIELD_AUTO_COMPLETE = {
  OFF: "off",
} as const;

export type TextFieldAutoComplete =
  (typeof TEXT_FIELD_AUTO_COMPLETE)[keyof typeof TEXT_FIELD_AUTO_COMPLETE];

/** The key that submits a text area: ⌘Return (Ctrl+Enter), or a plain Return, as a chat's note sends. */
export const TEXT_AREA_SUBMIT = {
  MOD_ENTER: "mod-enter",
  ENTER: "enter",
} as const;

export type TextAreaSubmit = (typeof TEXT_AREA_SUBMIT)[keyof typeof TEXT_AREA_SUBMIT];

/**
 * How a text entry is named: by its `FormField`'s label, through the field's
 * control, or by a `label` of its own where it stands alone, so none is
 * drawn without a name; one standing alone is described by `describedBy`
 * and marked invalid by `invalid`.
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
      /** The id of the words that say what the entry is for, where some stand beside it, as a `SettingsRow`'s description does. */
      describedBy?: string | undefined;
      /** Whether what it holds is wrong, as a `SettingsRow`'s error says while it stands. */
      invalid?: boolean | undefined;
    };

/** What both kinds of text entry take, bar the value they hold. */
type TextEntryProps = Named & {
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
  /** What an Escape does, pressed while no input method is composing; every Escape is marked taken, so the page's Escape passes it by. */
  onEscape?: (() => void) | undefined;
  /** What leaving it does, as a field that saves when the caret goes elsewhere does. */
  onBlur?: (() => void) | undefined;
  /** The chord that acts on what it holds, said to assistive technology (`aria-keyshortcuts`). */
  keyShortcuts?: string | undefined;
  /** The face its words are set in; the body's where none is named. */
  font?: TextFieldFont | undefined;
};

/** What a one-line field holds: words for every type but a number, and a number, or nothing, for that. */
type TextFieldValue =
  | {
      type?: Exclude<TextFieldType, typeof TEXT_FIELD_TYPE.NUMBER> | undefined;
      value: string;
      onChange: (value: string) => void;
    }
  | {
      type: typeof TEXT_FIELD_TYPE.NUMBER;
      /** The number it holds, or nothing while it is empty. */
      value: number | undefined;
      /** Answers each change with the number typed, or nothing while what is typed is not one. */
      onChange: (value: number | undefined) => void;
    };

/** The attributes a text entry carries for its field, or its own name where it has none. */
function entryAttributes(props: TextEntryProps) {
  return {
    id: props.field?.id,
    "aria-label": props.field === undefined ? props.label : undefined,
    "aria-describedby":
      props.field === undefined ? props.describedBy : props.field["aria-describedby"],
    "aria-invalid":
      props.field === undefined
        ? props.invalid === true
          ? true
          : undefined
        : props.field["aria-invalid"],
    placeholder: props.placeholder,
    disabled: props.disabled,
    readOnly: props.readOnly,
    required: props.required,
    autoFocus: props.autoFocus,
    name: props.name,
    maxLength: props.maxLength,
    spellCheck: props.spellCheck,
    "aria-keyshortcuts": props.keyShortcuts,
    onBlur: props.onBlur,
    "data-font": props.font ?? TEXT_FIELD_FONT.BODY,
  };
}

/** What a busy text area does with a key it takes: nothing. */
function noop(): void {}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Marks an Escape taken where `onEscape` is given, and answers it unless an
 * input method is composing. Note that the press still reaches the window,
 * because the app's own Escape, stopping a live call, comes before any
 * field's; the page's Escape passes a taken press by. A composing press is
 * the input method's already when the page hears it, so marking it takes
 * nothing from the input method.
 */
function answerEscape(event: KeyboardEvent, onEscape: (() => void) | undefined): void {
  if (event.key !== "Escape" || onEscape === undefined) return;
  event.preventDefault();
  if (!composing(event)) onEscape();
}

/** Whether a key is the one that submits a text area, and not an input method's. */
function submitting(event: KeyboardEvent, key: TextAreaSubmit): boolean {
  if (event.key !== "Enter" || composing(event)) return false;
  return key === TEXT_AREA_SUBMIT.ENTER ? !event.shiftKey : event.metaKey || event.ctrlKey;
}

/** One line of text, answering Enter with `onEnter` where it is given. */
export function TextField({
  autoComplete,
  onEnter,
  size = TEXT_FIELD_SIZE.CONTROL,
  ref,
  ...props
}: TextEntryProps &
  TextFieldValue & {
    /** What the system may fill the field with; the browser's own choice where none is named. */
    autoComplete?: TextFieldAutoComplete | undefined;
    /** What an Enter does, pressed while no input method is composing. */
    onEnter?: (() => void) | undefined;
    /** How large it stands; a control where none is named. */
    size?: TextFieldSize | undefined;
    ref?: Ref<HTMLInputElement> | undefined;
  }): React.JSX.Element {
  return (
    <input
      ref={ref}
      className="luke-text-field"
      type={props.type ?? TEXT_FIELD_TYPE.TEXT}
      autoComplete={autoComplete}
      data-size={size}
      {...entryAttributes(props)}
      value={props.value ?? ""}
      onChange={(event) => {
        if (props.type !== TEXT_FIELD_TYPE.NUMBER) return props.onChange(event.target.value);
        // Note that the browser reads nothing from what is not yet a number, as it does from nothing.
        const typed = event.target.valueAsNumber;
        props.onChange(Number.isFinite(typed) ? typed : undefined);
      }}
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
  busy = false,
  onSubmit,
  submitKey = TEXT_AREA_SUBMIT.MOD_ENTER,
  onPaste,
  ref,
  ...props
}: TextEntryProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  /** Whether it grows with its words from `rows` tall, rather than standing at that height. */
  grow?: boolean;
  /** Whether its words are on their way somewhere, so it takes no typing and answers no key until they arrive. */
  busy?: boolean | undefined;
  /** What the submit key does, pressed while no input method is composing. */
  onSubmit?: (() => void) | undefined;
  /** The key `onSubmit` answers; ⌘Return (Ctrl+Enter) where none is named. */
  submitKey?: TextAreaSubmit | undefined;
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
      value={props.value}
      readOnly={busy || props.readOnly}
      aria-busy={busy || undefined}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        // Note that a busy area still takes its Escape, so the page behind it stays put while it waits.
        answerEscape(event, busy && props.onEscape !== undefined ? noop : props.onEscape);
        if (onSubmit === undefined || !submitting(event, submitKey)) return;
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      onPaste={onPaste}
    />
  );
}
