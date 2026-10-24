import type { ClipboardEvent, KeyboardEvent, Ref } from "react";
import { cn } from "../../cn.js";
import { isComposingKey } from "../../composing-key.js";
import { cssCustomProperties } from "../../css.js";
import { ShadcnInput } from "../../shadcn/input.js";
import { ShadcnTextarea } from "../../shadcn/textarea.js";
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
 *
 * A TextField is drawn by shadcn/ui's input (`../../shadcn/input.tsx`, on
 * Base UI) and a TextArea by its textarea (`../../shadcn/textarea.tsx`); a
 * size or look other than the control's well replaces the well's classes
 * whole, in Tailwind utilities over the theme's field roles.
 */

/** What a one-line field holds: words, an address, a secret, a time of day, or a number. */
export const TEXT_FIELD_TYPE = {
  TEXT: "text",
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
  /** A step under a control in the caption's type, on the well's ground, among a bar's controls, as a Browser tab's address. */
  COMPACT: "compact",
  /** Words written in place in the body's type, without a well, as a mail's subject among the lines of its head. */
  INLINE: "inline",
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

/** How a text area stands: in a field's well, or bare in a card that is its well, at the insets the card sets (`--luke-text-area-inset-*`). */
export const TEXT_AREA_LOOK = {
  WELL: "well",
  BARE: "bare",
} as const;

export type TextAreaLook = (typeof TEXT_AREA_LOOK)[keyof typeof TEXT_AREA_LOOK];

/** How far a growing text area grows: to the profile's tallest note before it scrolls, or with its words however many, as a message box does. */
export const TEXT_AREA_GROW_LIMIT = {
  NOTE: "note",
  NONE: "none",
} as const;

export type TextAreaGrowLimit = (typeof TEXT_AREA_GROW_LIMIT)[keyof typeof TEXT_AREA_GROW_LIMIT];

/** The label an on-screen keyboard draws on its return key: Send where Return sends, a return where it is a new line. */
export const ENTER_KEY_HINT = {
  SEND: "send",
  NEW_LINE: "enter",
} as const;

export type EnterKeyHint = (typeof ENTER_KEY_HINT)[keyof typeof ENTER_KEY_HINT];

/**
 * Each size's own classes, in place of the control's well, which a control
 * keeps. Note that a well-less size grounds its focus too, because the
 * well's focus ground would otherwise fill it.
 */
const TEXT_FIELD_SIZE_CLASS = {
  [TEXT_FIELD_SIZE.CONTROL]: undefined,
  /** A page's title written in place: the title's words alone, the caret in them showing focus. */
  [TEXT_FIELD_SIZE.TITLE]:
    "h-auto p-0 border-0 bg-transparent focus:bg-transparent text-title font-bold outline-none",
  /** A step under a control, on the well's ground, its edge lighting while it holds the caret; 16px words under a finger. */
  [TEXT_FIELD_SIZE.COMPACT]:
    "h-control-compact rounded-control-compact border-border bg-well px-luke-6 text-caption leading-body text-ellipsis focus:border-muted-foreground focus:bg-well focus:outline-none pointer-coarse:text-caption-touch",
  /** Words written in place in the body's type: no well, no edge, and no ring. */
  [TEXT_FIELD_SIZE.INLINE]: "h-auto p-0 border-0 bg-transparent focus:bg-transparent outline-none",
} as const satisfies Record<TextFieldSize, string | undefined>;

/**
 * A time is typed or stepped with the arrows, the engine's own clock hidden.
 * WebKit on iOS draws a time in a box of its own, so its look is let go, its
 * block inset is the room around one line, and its value starts where every
 * field's words start.
 */
const TIME_FIELD =
  "appearance-none py-time-inset [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:min-h-time-value [&::-webkit-date-and-time-value]:text-start";

/** A note that grows with its words from its rows' height, up to the profile's tallest note, with no handle. */
const TEXT_AREA_GROW =
  "min-h-text-area-least max-h-text-area-grow-max field-sizing-content resize-none";

/** A text area bare in a card that is its well: no edge, no ground, and no ring, at the insets its card sets. */
const TEXT_AREA_BARE =
  "p-0 pt-text-area-inset-start px-text-area-inset-inline pb-text-area-inset-end rounded-none border-0 bg-transparent focus:bg-transparent resize-none outline-none";

/** Each face's class: the body's, which a field wears already, or a fixed width. */
const TEXT_FIELD_FONT_CLASS = {
  [TEXT_FIELD_FONT.BODY]: undefined,
  [TEXT_FIELD_FONT.MONO]: "font-mono",
} as const satisfies Record<TextFieldFont, string | undefined>;

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
  if (!isComposingKey(event)) onEscape();
}

/** Whether a key is the one that submits a text area, and not an input method's. */
function submitting(event: KeyboardEvent, key: TextAreaSubmit): boolean {
  if (event.key !== "Enter" || isComposingKey(event)) return false;
  return key === TEXT_AREA_SUBMIT.ENTER ? !event.shiftKey : event.metaKey || event.ctrlKey;
}

/** One line of text, answering Enter with `onEnter` where it is given. */
export function TextField({
  autoComplete,
  autoCorrect = true,
  selectOnFocus = false,
  onEnter,
  size = TEXT_FIELD_SIZE.CONTROL,
  ref,
  ...props
}: TextEntryProps &
  TextFieldValue & {
    /** What the system may fill the field with; the browser's own choice where none is named. */
    autoComplete?: TextFieldAutoComplete | undefined;
    /** Whether the system may correct and capitalize words as they are typed; off for an address or a name. */
    autoCorrect?: boolean | undefined;
    /** Whether the caret arriving selects every word, so typing replaces them, as an address bar does. */
    selectOnFocus?: boolean | undefined;
    /** What an Enter does, pressed while no input method is composing. */
    onEnter?: (() => void) | undefined;
    /** How large it stands; a control where none is named. */
    size?: TextFieldSize | undefined;
    ref?: Ref<HTMLInputElement> | undefined;
  }): React.JSX.Element {
  return (
    <ShadcnInput
      ref={ref}
      className={cn(
        TEXT_FIELD_SIZE_CLASS[size],
        TEXT_FIELD_FONT_CLASS[props.font ?? TEXT_FIELD_FONT.BODY],
        props.type === TEXT_FIELD_TYPE.TIME && TIME_FIELD,
      )}
      type={props.type ?? TEXT_FIELD_TYPE.TEXT}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect ? undefined : "off"}
      autoCapitalize={autoCorrect ? undefined : "off"}
      onFocus={selectOnFocus ? (event) => event.target.select() : undefined}
      data-size={size}
      {...entryAttributes(props)}
      value={props.value ?? ""}
      onChange={(event) => {
        if (props.type !== TEXT_FIELD_TYPE.NUMBER) return props.onChange(event.target.value);
        // Note that a half-typed number reads as nothing, and React leaves its text standing, as it compares loosely.
        const typed = event.target.valueAsNumber;
        props.onChange(Number.isFinite(typed) ? typed : undefined);
      }}
      onKeyDown={(event) => {
        answerEscape(event, props.onEscape);
        if (event.key !== "Enter" || onEnter === undefined || isComposingKey(event)) return;
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
  look = TEXT_AREA_LOOK.WELL,
  growLimit = TEXT_AREA_GROW_LIMIT.NOTE,
  enterKeyHint,
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
  /** How it stands; in a field's well where none is named. */
  look?: TextAreaLook | undefined;
  /** How far it grows, where it may; to the profile's tallest note where none is named. */
  growLimit?: TextAreaGrowLimit | undefined;
  /** The label an on-screen keyboard's return key wears; the keyboard's own where none is named. */
  enterKeyHint?: EnterKeyHint | undefined;
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
    <ShadcnTextarea
      ref={ref}
      className={cn(
        grow && TEXT_AREA_GROW,
        look === TEXT_AREA_LOOK.BARE && TEXT_AREA_BARE,
        grow && look === TEXT_AREA_LOOK.BARE && "min-h-text-area-bare-least",
        grow && growLimit === TEXT_AREA_GROW_LIMIT.NONE && "max-h-none",
        TEXT_FIELD_FONT_CLASS[props.font ?? TEXT_FIELD_FONT.BODY],
      )}
      rows={rows}
      data-grow={grow}
      data-look={look}
      data-grow-limit={grow ? growLimit : undefined}
      enterKeyHint={enterKeyHint}
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
