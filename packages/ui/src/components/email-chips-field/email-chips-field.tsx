import { type ClipboardEvent, type KeyboardEvent, type Ref, useRef } from "react";
import { cn } from "../../cn.js";
import { isComposingKey } from "../../composing-key.js";
import { CheckIcon } from "../../face/glyphs.js";
import { AlertIcon } from "../../icons/lucide-glyphs.js";
import { joinRefs } from "../../join-refs.js";
import { INPUT_CONTROL } from "../../shadcn/input.js";
import { STATUS_TONE } from "../../status-tone.js";
import { AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, StaticChip } from "../chip/chip.js";
import type { FieldControl } from "../form-field/form-field.js";

export const EMAIL_CHIP_STATE = {
  DRAFT: "draft",
  BAD: "bad",
  SENDING: "sending",
  SENT: "sent",
  REFUSED: "refused",
} as const;

export type EmailChipState = (typeof EMAIL_CHIP_STATE)[keyof typeof EMAIL_CHIP_STATE];

export interface EmailChip {
  readonly id: string;
  readonly words: string;
  readonly typed: string;
  readonly state: EmailChipState;
  readonly reason?: string | undefined;
}

function endsAddress(words: string): boolean {
  if (words.lastIndexOf("<") > words.lastIndexOf(">")) return false;
  if ((words.split('"').length - 1) % 2 === 1) return false;
  const last = words.at(-1);
  if (last === "," || last === ";") return true;
  if (last === undefined || last.trim() !== "") return false;
  const kept = words.trimEnd();
  const lastWord = kept.slice(
    Math.max(kept.lastIndexOf(" "), kept.lastIndexOf("\t"), kept.lastIndexOf("\n")) + 1,
  );
  return lastWord.includes("@");
}

function pastedList(pasted: string): boolean {
  const kept = pasted.trim();
  return [" ", "\t", "\n", ",", ";"].some((mark) => kept.includes(mark));
}

const WELL = cn(
  INPUT_CONTROL,
  "ui-email-chips flex flex-wrap items-center content-start gap-chip-tight h-auto min-h-control max-h-text-area-grow-max overflow-y-auto box-border w-full min-w-0 px-ui-4 py-ui-4 cursor-text transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain focus-within:bg-field-focus aria-disabled:cursor-default aria-disabled:opacity-disabled",
);

const TYPING =
  "ui-email-chips-typing m-0 flex-1 basis-chip-field-half min-w-0 h-chip-compact border-0 bg-transparent p-0 ps-ui-4 font-body text-body font-text text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default";

function AddressChip({
  chip,
  onRemove,
  onEdit,
  disabled,
}: {
  chip: EmailChip;
  onRemove: () => void;
  onEdit: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const wrong = chip.state === EMAIL_CHIP_STATE.BAD || chip.state === EMAIL_CHIP_STATE.REFUSED;
  const mark = {
    [EMAIL_CHIP_STATE.DRAFT]: <Avatar name={chip.words} size={AVATAR_SIZE.INLINE} decorative />,
    [EMAIL_CHIP_STATE.BAD]: <AlertIcon />,
    [EMAIL_CHIP_STATE.REFUSED]: <AlertIcon />,
    [EMAIL_CHIP_STATE.SENDING]: null,
    [EMAIL_CHIP_STATE.SENT]: <CheckIcon />,
  }[chip.state];
  const tone = {
    [EMAIL_CHIP_STATE.DRAFT]: undefined,
    [EMAIL_CHIP_STATE.BAD]: STATUS_TONE.DANGER,
    [EMAIL_CHIP_STATE.REFUSED]: STATUS_TONE.DANGER,
    [EMAIL_CHIP_STATE.SENDING]: STATUS_TONE.WORKING,
    [EMAIL_CHIP_STATE.SENT]: STATUS_TONE.COMPLETE,
  }[chip.state];
  const words = <ChipName>{chip.words}</ChipName>;
  if (disabled || !(wrong || chip.state === EMAIL_CHIP_STATE.DRAFT)) {
    return (
      <StaticChip
        look={CHIP_LOOK.PILL}
        size={CHIP_SIZE.COMPACT}
        tone={tone}
        aria-busy={chip.state === EMAIL_CHIP_STATE.SENDING ? true : undefined}
      >
        {mark}
        {words}
      </StaticChip>
    );
  }
  return (
    <Chip
      look={CHIP_LOOK.PILL}
      size={CHIP_SIZE.COMPACT}
      tone={tone}
      onRemove={onRemove}
      removeLabel={`Remove ${chip.words}`}
      onOpen={onEdit}
      hint={chip.reason}
    >
      {mark}
      {words}
    </Chip>
  );
}

export function EmailChipsField({
  chips,
  typed,
  onTyped,
  onAdd,
  onRemove,
  field,
  label,
  placeholder,
  disabled = false,
  onSubmit,
  ref,
}: {
  chips: readonly EmailChip[];
  typed: string;
  onTyped: (typed: string) => void;
  onAdd: (typed: string) => void;
  onRemove: (id: string) => void;
  field?: FieldControl | undefined;
  label?: string | undefined;
  placeholder: string;
  disabled?: boolean | undefined;
  onSubmit?: (() => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const words = useRef<HTMLInputElement | null>(null);

  const take = (words: string) => {
    onTyped("");
    if (words.trim() !== "") onAdd(words);
  };
  const lift = (chip: EmailChip) => {
    onRemove(chip.id);
    words.current?.focus();
  };
  const edit = (chip: EmailChip) => {
    lift(chip);
    onTyped(chip.typed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposingKey(event)) return;
    const blank = typed.trim() === "";
    if (event.key === "Enter") {
      event.preventDefault();
      take(typed);
      if (blank || event.metaKey || event.ctrlKey) onSubmit?.();
    } else if (event.key === "Tab" && !blank) {
      event.preventDefault();
      take(typed);
    } else if (event.key === "Backspace" && typed === "") {
      const last = chips.at(-1);
      const locked =
        last?.state === EMAIL_CHIP_STATE.SENDING || last?.state === EMAIL_CHIP_STATE.SENT;
      if (last === undefined || locked) return;
      event.preventDefault();
      edit(last);
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!pastedList(pasted)) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    const before = typed.slice(0, selectionStart ?? typed.length);
    const after = typed.slice(selectionEnd ?? typed.length);
    take(`${before} ${pasted} ${after}`);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the well's bare ground lands the caret in its words for the pointer alone, as a press inside a field's box does; the words themselves are the keyboard's.
    <div
      className={WELL}
      aria-disabled={disabled ? true : undefined}
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget || disabled) return;
        event.preventDefault();
        words.current?.focus();
      }}
    >
      {chips.map((chip) => (
        <AddressChip
          key={chip.id}
          chip={chip}
          disabled={disabled}
          onRemove={() => lift(chip)}
          onEdit={() => edit(chip)}
        />
      ))}
      <input
        ref={joinRefs(words, ref)}
        id={field?.id}
        className={TYPING}
        type="text"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={typed}
        disabled={disabled}
        placeholder={chips.length === 0 ? placeholder : undefined}
        aria-label={field === undefined ? label : undefined}
        aria-describedby={field?.["aria-describedby"]}
        aria-required={field?.["aria-required"]}
        aria-invalid={field?.["aria-invalid"]}
        onChange={(event) => {
          const words = event.target.value;
          if (endsAddress(words)) take(words);
          else onTyped(words);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => take(typed)}
      />
    </div>
  );
}
