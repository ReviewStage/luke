import type { ClipboardEvent, KeyboardEvent, Ref } from "react";
import { cn } from "../../cn.js";
import { isComposingKey } from "../../composing-key.js";
import { cssCustomProperties } from "../../css.js";
import { ShadcnInput } from "../../shadcn/input.js";
import { ShadcnTextarea } from "../../shadcn/textarea.js";
import type { FieldControl } from "../form-field/form-field.js";

export const TEXT_FIELD_TYPE = {
  TEXT: "text",
  EMAIL: "email",
  URL: "url",
  PASSWORD: "password",
  TIME: "time",
  NUMBER: "number",
} as const;

export type TextFieldType = (typeof TEXT_FIELD_TYPE)[keyof typeof TEXT_FIELD_TYPE];

export const TEXT_FIELD_SIZE = {
  CONTROL: "control",
  TITLE: "title",
  COMPACT: "compact",
} as const;

export type TextFieldSize = (typeof TEXT_FIELD_SIZE)[keyof typeof TEXT_FIELD_SIZE];

export const TEXT_FIELD_GROUND = {
  INPUT: "input",
  CARD: "card",
} as const;

export type TextFieldGround = (typeof TEXT_FIELD_GROUND)[keyof typeof TEXT_FIELD_GROUND];

export const TEXT_FIELD_FONT = {
  BODY: "body",
  MONO: "mono",
} as const;

export type TextFieldFont = (typeof TEXT_FIELD_FONT)[keyof typeof TEXT_FIELD_FONT];

export const TEXT_FIELD_AUTO_COMPLETE = {
  OFF: "off",
} as const;

export type TextFieldAutoComplete =
  (typeof TEXT_FIELD_AUTO_COMPLETE)[keyof typeof TEXT_FIELD_AUTO_COMPLETE];

export const TEXT_FIELD_INPUT_MODE = {
  NUMERIC: "numeric",
} as const;

export type TextFieldInputMode = (typeof TEXT_FIELD_INPUT_MODE)[keyof typeof TEXT_FIELD_INPUT_MODE];

export const TEXT_AREA_SUBMIT = {
  MOD_ENTER: "mod-enter",
  ENTER: "enter",
} as const;

export type TextAreaSubmit = (typeof TEXT_AREA_SUBMIT)[keyof typeof TEXT_AREA_SUBMIT];

export const TEXT_AREA_LOOK = {
  WELL: "well",
  BARE: "bare",
} as const;

export type TextAreaLook = (typeof TEXT_AREA_LOOK)[keyof typeof TEXT_AREA_LOOK];

export const TEXT_AREA_GROW_LIMIT = {
  NOTE: "note",
  NONE: "none",
} as const;

export type TextAreaGrowLimit = (typeof TEXT_AREA_GROW_LIMIT)[keyof typeof TEXT_AREA_GROW_LIMIT];

export const ENTER_KEY_HINT = {
  SEND: "send",
  NEW_LINE: "enter",
} as const;

export type EnterKeyHint = (typeof ENTER_KEY_HINT)[keyof typeof ENTER_KEY_HINT];

const TEXT_FIELD_SIZE_CLASS = {
  [TEXT_FIELD_SIZE.CONTROL]: undefined,
  [TEXT_FIELD_SIZE.TITLE]:
    "h-auto p-0 border-0 bg-transparent focus:bg-transparent text-title font-title tracking-title outline-none",
  [TEXT_FIELD_SIZE.COMPACT]:
    "h-control-compact rounded-control-compact border-border bg-well px-ui-6 text-caption leading-body text-ellipsis focus:border-muted-foreground focus:bg-well focus:outline-none pointer-coarse:text-caption-touch",
} as const satisfies Record<TextFieldSize, string | undefined>;

const TEXT_FIELD_GROUND_CLASS = {
  [TEXT_FIELD_GROUND.INPUT]: undefined,
  [TEXT_FIELD_GROUND.CARD]: "bg-surface focus:bg-surface",
} as const satisfies Record<TextFieldGround, string | undefined>;

const TIME_FIELD =
  "appearance-none py-time-inset [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-date-and-time-value]:m-0 [&::-webkit-date-and-time-value]:min-h-time-value [&::-webkit-date-and-time-value]:text-start";

const TEXT_AREA_GROW =
  "min-h-text-area-least max-h-text-area-grow-max field-sizing-content resize-none";

const TEXT_AREA_BARE =
  "p-0 pt-text-area-inset-start px-text-area-inset-inline pb-text-area-inset-end rounded-none border-0 bg-transparent focus:bg-transparent resize-none outline-none";

const TEXT_FIELD_FONT_CLASS = {
  [TEXT_FIELD_FONT.BODY]: undefined,
  [TEXT_FIELD_FONT.MONO]: "font-mono",
} as const satisfies Record<TextFieldFont, string | undefined>;

type Named =
  | {
      field: FieldControl;
      label?: undefined;
    }
  | {
      field?: undefined;
      label: string;
      describedBy?: string | undefined;
      invalid?: boolean | undefined;
    };

type TextEntryProps = Named & {
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  readOnly?: boolean | undefined;
  autoFocus?: boolean | undefined;
  name?: string | undefined;
  maxLength?: number | undefined;
  spellCheck?: boolean | undefined;
  onEscape?: (() => void) | undefined;
  onBlur?: (() => void) | undefined;
  keyShortcuts?: string | undefined;
  font?: TextFieldFont | undefined;
};

type TextFieldValue =
  | {
      type?: Exclude<TextFieldType, typeof TEXT_FIELD_TYPE.NUMBER> | undefined;
      value: string;
      onChange: (value: string) => void;
    }
  | {
      type: typeof TEXT_FIELD_TYPE.NUMBER;
      value: number | undefined;
      onChange: (value: number | undefined) => void;
    };

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
    "aria-required": props.field?.["aria-required"],
    placeholder: props.placeholder,
    disabled: props.disabled,
    readOnly: props.readOnly,
    autoFocus: props.autoFocus,
    name: props.name,
    maxLength: props.maxLength,
    spellCheck: props.spellCheck,
    "aria-keyshortcuts": props.keyShortcuts,
    onBlur: props.onBlur,
    "data-font": props.font ?? TEXT_FIELD_FONT.BODY,
  };
}

function noop(): void {}

function answerEscape(event: KeyboardEvent, onEscape: (() => void) | undefined): void {
  if (event.key !== "Escape" || onEscape === undefined) return;
  event.preventDefault();
  if (!isComposingKey(event)) onEscape();
}

function submitting(event: KeyboardEvent, key: TextAreaSubmit): boolean {
  if (event.key !== "Enter" || isComposingKey(event)) return false;
  return key === TEXT_AREA_SUBMIT.ENTER ? !event.shiftKey : event.metaKey || event.ctrlKey;
}

function pastedInput(event: Event): boolean {
  return "inputType" in event && event.inputType === "insertFromPaste";
}

export function TextField({
  autoComplete,
  autoCorrect = true,
  inputMode,
  selectOnFocus = false,
  onEnter,
  onPasted,
  size = TEXT_FIELD_SIZE.CONTROL,
  ground = TEXT_FIELD_GROUND.INPUT,
  ref,
  ...props
}: TextEntryProps &
  TextFieldValue & {
    autoComplete?: TextFieldAutoComplete | undefined;
    autoCorrect?: boolean | undefined;
    inputMode?: TextFieldInputMode | undefined;
    selectOnFocus?: boolean | undefined;
    onEnter?: (() => void) | undefined;
    onPasted?: ((value: string) => void) | undefined;
    size?: TextFieldSize | undefined;
    ground?: TextFieldGround | undefined;
    ref?: Ref<HTMLInputElement> | undefined;
  }): React.JSX.Element {
  return (
    <ShadcnInput
      ref={ref}
      className={cn(
        TEXT_FIELD_SIZE_CLASS[size],
        TEXT_FIELD_GROUND_CLASS[ground],
        TEXT_FIELD_FONT_CLASS[props.font ?? TEXT_FIELD_FONT.BODY],
        props.type === TEXT_FIELD_TYPE.TIME && TIME_FIELD,
      )}
      type={props.type ?? TEXT_FIELD_TYPE.TEXT}
      autoComplete={autoComplete}
      autoCorrect={autoCorrect ? undefined : "off"}
      autoCapitalize={autoCorrect ? undefined : "off"}
      inputMode={inputMode}
      onFocus={selectOnFocus ? (event) => event.target.select() : undefined}
      data-size={size}
      {...entryAttributes(props)}
      value={props.value ?? ""}
      onChange={(event) => {
        if (props.type !== TEXT_FIELD_TYPE.NUMBER) {
          props.onChange(event.target.value);
          if (onPasted !== undefined && pastedInput(event.nativeEvent))
            onPasted(event.target.value);
          return;
        }
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

export function TextArea({
  rows = 4,
  grow = false,
  look = TEXT_AREA_LOOK.WELL,
  growLimit = TEXT_AREA_GROW_LIMIT.NOTE,
  enterKeyHint,
  busy = false,
  onSubmit,
  submitKey = TEXT_AREA_SUBMIT.ENTER,
  onPaste,
  ref,
  ...props
}: TextEntryProps & {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  grow?: boolean;
  look?: TextAreaLook | undefined;
  growLimit?: TextAreaGrowLimit | undefined;
  enterKeyHint?: EnterKeyHint | undefined;
  busy?: boolean | undefined;
  onSubmit?: (() => void) | undefined;
  submitKey?: TextAreaSubmit | undefined;
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
      style={grow ? cssCustomProperties({ "--ui-text-area-rows": rows }) : undefined}
      {...entryAttributes(props)}
      value={props.value}
      readOnly={busy || props.readOnly}
      aria-busy={busy || undefined}
      onChange={(event) => props.onChange(event.target.value)}
      onKeyDown={(event) => {
        answerEscape(event, busy && props.onEscape !== undefined ? noop : props.onEscape);
        if (onSubmit === undefined || !submitting(event, submitKey)) return;
        event.preventDefault();
        if (!busy) onSubmit();
      }}
      onPaste={onPaste}
    />
  );
}
