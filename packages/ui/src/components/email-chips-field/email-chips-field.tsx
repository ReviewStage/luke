import { type ClipboardEvent, type KeyboardEvent, type Ref, useId, useRef } from "react";
import { isComposingKey } from "../../composing-key.js";
import { CheckIcon } from "../../face/glyphs.js";
import { AlertIcon } from "../../icons/lucide-glyphs.js";
import { joinRefs } from "../../join-refs.js";
import { STATUS_TONE } from "../../status-tone.js";
import { AVATAR_SIZE, Avatar } from "../avatar/avatar.js";
import { CHIP_LOOK, CHIP_SIZE, Chip, ChipName, StaticChip } from "../chip/chip.js";
import type { FieldControl } from "../form-field/form-field.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

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
 * that the service refused, wears the danger's mark, and why is said under
 * the field, a line per reason after the addresses it holds, which
 * describes the field to a reader; the chips stand in lines up to a grown
 * note's height, and scroll past it; one on its way pulses
 * the working dot, and one sent wears a tick. Neither of the last two can
 * be lifted or edited here, since what was sent is undone elsewhere.
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
  /** Why it is no address, or why the service refused it, which the field says under itself. */
  readonly reason?: string | undefined;
}

/**
 * Words that end an address being typed, where no name's bracket or quote is
 * still open: a comma or a semicolon, or a space once the words hold an
 * address, so a name typed before its address in brackets stays whole.
 */
const ADDRESS_END = /[,;]$|@\S*\s$/u;

/** Pasted words that hold more than one word, a list or a To line, rather than part of one address. */
const PASTED_LIST = /[\s,;]/u;

/** A name's bracket or quote still open in what is typed. */
const STILL_OPEN = /<[^>]*$|^[^"]*"[^"]*$/u;

/** The field's well: a control's, holding its chips in lines up to a grown note's height and scrolling past it, lighting while it holds the caret. */
const WELL =
  "ui-email-chips flex flex-wrap items-center content-start gap-chip-tight min-h-control max-h-text-area-grow-max overflow-y-auto box-border w-full min-w-0 rounded-control border border-border-strong bg-field px-ui-4 py-ui-4 cursor-text transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain focus-within:bg-field-focus aria-disabled:cursor-default aria-disabled:opacity-disabled";

/** The words being typed, after the chips, taking the rest of the line. */
const TYPING =
  "ui-email-chips-typing m-0 flex-1 basis-chip-field-half min-w-0 h-chip-compact border-0 bg-transparent p-0 ps-ui-4 font-body text-body font-text text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-default";

/** The wrong addresses by why each is wrong, so a long list of them reads as a line per reason. */
function reasonsOf(wrong: readonly EmailChip[]): Map<string, string[]> {
  const reasons = new Map<string, string[]>();
  for (const chip of wrong) {
    if (chip.reason === undefined) continue;
    reasons.set(chip.reason, [...(reasons.get(chip.reason) ?? []), chip.words]);
  }
  return reasons;
}

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
  const reasonsId = useId();
  const wrong = chips.filter((chip) => chip.reason !== undefined);
  const describedBy =
    [field?.["aria-describedby"], wrong.length > 0 ? reasonsId : undefined]
      .filter((id) => id !== undefined)
      .join(" ") || undefined;

  const take = (words: string) => {
    onTyped("");
    if (words.trim() !== "") onAdd(words);
  };
  const edit = (chip: EmailChip) => {
    onRemove(chip.id);
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
    if (!PASTED_LIST.test(pasted.trim())) return;
    event.preventDefault();
    const { selectionStart, selectionEnd } = event.currentTarget;
    const before = typed.slice(0, selectionStart ?? typed.length);
    const after = typed.slice(selectionEnd ?? typed.length);
    take(`${before} ${pasted} ${after}`);
  };

  return (
    <div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the well's bare ground lands the caret in its words for the pointer alone, as a press inside a field's box does; the words themselves are the keyboard's. */}
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
            onRemove={() => onRemove(chip.id)}
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
          aria-describedby={describedBy}
          aria-required={field?.["aria-required"]}
          aria-invalid={wrong.length > 0 || field?.["aria-invalid"] === true ? true : undefined}
          onChange={(event) => {
            const words = event.target.value;
            if (ADDRESS_END.test(words) && !STILL_OPEN.test(words)) take(words);
            else onTyped(words);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => take(typed)}
        />
      </div>
      {wrong.length === 0 ? null : (
        <div className="ui-email-chips-reasons mt-ui-4" id={reasonsId}>
          {[...reasonsOf(wrong)].map(([reason, words]) => (
            <Text key={reason} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {words.join(", ")}: {reason}
            </Text>
          ))}
        </div>
      )}
    </div>
  );
}
