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

/**
 * email-chips-field.tsx -- a field of email addresses, each a chip: typed or pasted in, marked where one is wrong, and ticking in as each is sent.
 *
 * The field is controlled, as a TextField is: the caller holds the chips and
 * the words still being typed (`typed`), reads what is typed into addresses
 * (`onAdd`), and says where each stands, so a press of the form's own reads
 * an address typed and never ended as one to send.
 * Words become chips at a comma, a semicolon, Return, or Tab, at a space
 * once they hold an address, when the caret leaves, and at once when a list
 * is pasted, so a whole To line lands in one press; a name before an address
 * in angle brackets stays open until its bracket closes. Backspace in an empty field takes the last
 * chip back into the words to edit it, as a press on a chip's words does,
 * and its × lifts it. ⌘Return (Ctrl+Enter off the Mac), or Return with
 * nothing typed, is the form's own submit.
 *
 * A chip to be sent wears its person's letter; one that is no address, or
 * that the service refused, wears the danger's mark, and why is its words'
 * hint, said on a rest, under a finger's long press, and to a reader as
 * their description, so the field holds no line of its own for it and a
 * caller may simply leave such an address unsent; one on its way pulses the
 * working dot, and one sent wears a tick. Neither of the last two can be
 * lifted or edited here, since what was sent is undone elsewhere. The chips
 * stand in lines up to a grown note's height, and scroll past it.
 */

/** Where one address stands: to be sent, no address, on its way, sent, or refused by the service. */
export const EMAIL_CHIP_STATE = {
  DRAFT: "draft",
  BAD: "bad",
  SENDING: "sending",
  SENT: "sent",
  REFUSED: "refused",
} as const;

export type EmailChipState = (typeof EMAIL_CHIP_STATE)[keyof typeof EMAIL_CHIP_STATE];

/** One address in the field. */
export interface EmailChip {
  /** What the caller knows the address by, unique in the field. */
  readonly id: string;
  /** What the chip says: the person's name where one was written, else the address. */
  readonly words: string;
  /** The words put back into the field to edit the address, as they were typed. */
  readonly typed: string;
  readonly state: EmailChipState;
  /** Why it is no address, or why the service refused it, which its chip's hint says. */
  readonly reason?: string | undefined;
}

/**
 * Whether typed words end an address, where no name's bracket or quote is
 * still open: at a comma or a semicolon, or at a space once the last word
 * holds an address, so a name typed before its address in brackets stays
 * whole. Note that this reads the words by hand rather than by a regular
 * expression, because a backtracking pattern over what anyone types or
 * pastes can be made slow.
 */
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

/** Whether pasted words hold more than one word, a list or a To line, rather than part of one address. */
function pastedList(pasted: string): boolean {
  const kept = pasted.trim();
  return [" ", "\t", "\n", ",", ";"].some((mark) => kept.includes(mark));
}

/**
 * The field's well: the text field's own input box (`INPUT_CONTROL`), let
 * grow to hold its chips in lines up to a grown note's height and scroll past
 * it, its room a chip's rather than a word's, lighting while its words hold
 * the caret.
 */
const WELL = cn(
  INPUT_CONTROL,
  "ui-email-chips flex flex-wrap items-center content-start gap-chip-tight h-auto min-h-control max-h-text-area-grow-max overflow-y-auto box-border w-full min-w-0 px-ui-4 py-ui-4 cursor-text transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain focus-within:bg-field-focus aria-disabled:cursor-default aria-disabled:opacity-disabled",
);

/** The words being typed, after the chips, taking the rest of the line. */
const TYPING =
  "ui-email-chips-typing m-0 flex-1 basis-chip-field-half min-w-0 h-chip-compact border-0 bg-transparent p-0 ps-ui-4 font-body text-body font-text text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default";

/** The chip one address stands as. */
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
  // Note that what was sent, or is on its way, is no longer this field's to lift, nor is anything while the field is still.
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

/** The field of addresses for `chips`, its words turned into addresses by `onAdd`. */
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
  /** The words typed and not yet a chip. */
  typed: string;
  onTyped: (typed: string) => void;
  /** Takes the words typed or pasted, one address or a list of them, to add as chips. */
  onAdd: (typed: string) => void;
  /** Lifts the chip `id`, by its × or to edit it. */
  onRemove: (id: string) => void;
  /** The `FormField`'s control, which names the words by its label. */
  field?: FieldControl | undefined;
  /** The words' name where no `FormField` names them. */
  label?: string | undefined;
  /** What the words ask for while no address stands. */
  placeholder: string;
  disabled?: boolean | undefined;
  /** The form's own submit, asked once what is typed stands as a chip. */
  onSubmit?: (() => void) | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const words = useRef<HTMLInputElement | null>(null);

  const take = (words: string) => {
    onTyped("");
    if (words.trim() !== "") onAdd(words);
  };
  // Note that the caret comes back to the words once a chip is lifted, since the chip that held focus is gone.
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
      // Note that Tab with nothing typed goes on to the next control, as it would from any field.
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
  // Note that a paste of part of one address is the browser's own, and a list replaces what is selected and lands as chips at once.
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
