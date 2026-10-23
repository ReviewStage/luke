import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup } from "@base-ui/react/checkbox-group";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import type { ReactNode } from "react";
import { cn } from "../../cn.js";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { useClipped } from "../../use-clipped.js";
import { BADGE_TONE, Badge, type BadgeTone } from "../badge/badge.js";

/**
 * choice-list.tsx -- a list of options a reader picks from, each a row the width of its column holding a label, a line of detail, and a badge: one of them, or any that apply, and once settled, what was offered with what was picked.
 *
 * Picking one is a radio group: the group is named by its legend, each row
 * is a radio checked while its value is, Tab lands on the checked row (the
 * first open one while none is) and leaves the group in one press, and the
 * arrow keys move along the open rows and choose as they go, wrapping at
 * either end. A press on the checked row does nothing, unless the list is
 * `clearable`, where it takes the choice back, or hears it (`onPressChecked`),
 * as a list of voices does to play the chosen one again. Picking several is a group of
 * checkboxes in a fieldset, each its own Tab stop, toggled by a press or
 * Space, the arrow keys moving the keyboard along them without toggling.
 * Enter presses a row as a button's Enter does, unless what holds the list
 * takes the key first, as the Inbox does for its send. A row may be
 * unavailable on its own, saying why in its detail, and the keyboard steps
 * past it.
 *
 * A `marked` list leads each row with the control it behaves as, a radio's
 * round mark or a checkbox's square, filled in the accent once checked, so
 * one pick or several reads before a word does. A `numbered` list wears each
 * of its first nine rows' number at the row's right, after the badge, and
 * says it to a reader as the row's key; the caller answers the keys, since
 * a number picks a row from wherever the caller lets it. A row's `tone`
 * fills its checked control with what picking it means, going ahead in the
 * complete green or holding back in the danger red, and a list may stand
 * its rows `across`, side by side, as a yes beside a no. A `pill` list
 * draws its options as pills that wrap onto as many lines as they need,
 * the picked one tinted in the accent with a check before its words, for
 * short options with no detail, a form's select. A `picture` list stands its
 * options as faces in a grid, four to a line: each option's `mark` a round
 * picture ringed in the accent once picked, its label under it, faded out at
 * its end where the face is too narrow to hold it, for a set of people or
 * places to tell apart by their pictures.
 * A `card` list draws each option as a bordered card, ringed once picked: the
 * option's radio and label on its head, its `aside` at the head's end, and its
 * `below` under them, controls of its own that the card holds. The head alone
 * is the radio, so a key pressed in the controls under it is theirs. A card
 * whose option gives a detail steps back whole, as an unavailable one, its
 * detail saying why.
 *
 * A settled list is the record of a choice made: the same rows as a list a
 * reader cannot press, the picked ones in the checked look with a check and
 * the caller's words for whose pick it was, and the rest stepped back to an
 * outline. A badge (the agent's "Recommended") stands at the row's top
 * right however the label wraps, in the attention tone while the choice
 * waits on the reader and the neutral one once settled, when it is history
 * rather than a call to act.
 *
 * A read-only list is the record of a choice made in the look it was made
 * in: the open list's own rows, marks, pills, and flow, the picked ones
 * checked and the rest not, at full strength rather than faded as an
 * unavailable list is, so it reads as an answer given and not one waiting.
 * No press, key, or Tab reaches its rows, and its badges stand in the
 * neutral tone, as a settled list's do.
 *
 * The list owns its rows' spacing, type, and states. The caller holds the
 * value and answers every change with the values it asks for.
 *
 * A pick-one list is Base UI's `RadioGroup` of `Radio`s, a pick-several one
 * its `CheckboxGroup` of `Checkbox`es, each row a native button
 * (`nativeButton`) holding its words, so the roles, the checked state, and
 * the `data-checked` a row is drawn by are Base UI's. What a press and a
 * key do stays Luke's: Base UI checks a radio as focus lands on it, refuses
 * Enter on a row, and has no press that takes a choice back or hears the
 * checked row again, so the list answers its rows' presses and its arrows
 * itself and stops Base UI's own handling of them
 * (`preventBaseUIHandler`). Its rows are drawn in Tailwind utilities over
 * `tailwind/theme.css`; `choice-list.css` keeps what must stay a sheet's,
 * its header saying why.
 */

/** How many options a list takes: exactly one, or any that apply. */
export const CHOICE_SELECT = {
  ONE: "one",
  MANY: "many",
} as const;

export type ChoiceSelect = (typeof CHOICE_SELECT)[keyof typeof CHOICE_SELECT];

/** How an open list's rows are drawn: rows of words alone, rows led by the radio or checkbox each behaves as, pills that wrap, a check in the picked one, faces in a grid, or cards holding controls of their own. */
export const CHOICE_LOOK = {
  PLAIN: "plain",
  MARKED: "marked",
  PILL: "pill",
  PICTURE: "picture",
  CARD: "card",
} as const;

export type ChoiceLook = (typeof CHOICE_LOOK)[keyof typeof CHOICE_LOOK];

/** How an open list's rows stand: one under another, or side by side, sharing the width, as a yes and a no do. */
export const CHOICE_FLOW = {
  DOWN: "down",
  ACROSS: "across",
} as const;

export type ChoiceFlow = (typeof CHOICE_FLOW)[keyof typeof CHOICE_FLOW];

/** What a marked row's control fills with once checked where not the accent: what picking it means, going ahead or holding back. */
export const CHOICE_TONE = {
  COMPLETE: "complete",
  DANGER: "danger",
} as const;

export type ChoiceTone = (typeof CHOICE_TONE)[keyof typeof CHOICE_TONE];

/** How many of a numbered list's rows wear their number: the keys 1 to 9. */
export const CHOICE_NUMBERED_ROWS = 9;

/** The keys that step along a pick-one list, and which way. */
const STEP_KEYS = new Map([
  ["ArrowDown", 1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["ArrowLeft", -1],
]);

/**
 * A list's box: a column of rows with no box of its own. Rows across stand
 * side by side, pills wrap onto as many lines as they need, never jumping
 * between a line's end and the line under it, and faces stand in a grid,
 * four to a line. Each look names its own gap, so no two utilities set one.
 */
const LIST = "luke-choice-list min-w-0 m-0 p-0 [border:0] list-none";

const LIST_LOOK = {
  plain: "flex gap-luke-4",
  marked: "flex gap-luke-4",
  pill: "flex flex-row flex-wrap gap-luke-6",
  picture: "grid grid-cols-4 gap-x-luke-8 gap-y-luke-12",
  card: "flex gap-luke-8",
} as const satisfies Record<ChoiceLook, string>;

/**
 * A row's box: a label, its detail, and what stands beside them in a line
 * the width of its column. Note that a row draws the keyboard's ring inside
 * itself, because the list scrolls in a dialog whose edge would cut a ring
 * drawn outside; and that its fill, edge, and ink are `choice-list.css`'s,
 * because a stepped-back region quiets them from the components layer,
 * where a utility would outrank it.
 */
const ROW =
  "luke-choice flex items-center gap-luke-12 min-w-0 m-0 py-luke-8 px-luke-12 [border:0] rounded-control outline-offset-[calc(-1*var(--luke-focus-ring-width))] font-ui text-body text-left cursor-pointer in-data-[luke-profile=desktop]:cursor-default transition-[background-color] duration-(--luke-duration-hover) ease-[ease]";

/**
 * Each look's own row. A pill's corners are half its one-line height
 * rather than a full round, so a long option that wraps in a narrow column
 * stands as a rounded box instead of swelling into an ellipse, while a short
 * one is the same capsule as ever. A face is its picture over its name, in
 * the type of what holds the list; a card's row is its head's radio alone,
 * the card wearing the box.
 */
const ROW_LOOK = {
  plain: "",
  marked: "",
  pill: "gap-icon-gap min-h-control py-luke-4 px-luke-12 rounded-[calc(var(--luke-control-height)/2)] text-caption leading-body",
  picture: "flex-col gap-luke-4 p-0 outline-none text-[length:inherit] leading-body",
  card: "p-0",
} as const satisfies Record<ChoiceLook, string>;

/** A row standing beside the others shares the width, each as tall as the tallest. */
const ROW_ACROSS = "flex-[1_1_0] items-start";

/**
 * A marked row's radio or checkbox, stood on the label's first line (in a
 * card's head, on its centre): a ring at rest, filled once checked, a dot
 * in a radio and a tick in a box.
 */
const CONTROL =
  "luke-choice-control inline-grid flex-none place-items-center size-luke-16 box-border border-[1.5px] border-solid transition-[background-color,border-color] duration-(--luke-duration-hover) ease-[ease]";

/**
 * A checked control's fill: the accent, or what picking it means, going
 * ahead or holding back, its dot or tick in the ground's ink, which reads
 * on either.
 */
const CONTROL_ACCENT_FILL = "border-accent-fill bg-accent-fill";

const CONTROL_FILL = {
  complete: "border-complete bg-complete",
  danger: "border-danger-fill bg-danger-fill",
} as const satisfies Record<ChoiceTone, string>;

const CONTROL_MARK = {
  radio: "after:size-luke-6 after:rounded-[50%] after:content-['']",
  box: "after:w-luke-8 after:h-luke-4 after:mt-[-2px] after:border-b-2 after:border-l-2 after:[transform:rotate(-45deg)] after:content-['']",
} as const;

const CONTROL_INK = {
  radio: { accent: "after:bg-on-accent", toned: "after:bg-ground" },
  box: { accent: "after:border-on-accent", toned: "after:border-ground" },
} as const;

/**
 * A face's picture, round, ringed in the strong hairline, which thickens
 * under the pointer and turns the switch's accent once picked. The
 * keyboard's ring is drawn on the picture, outside the picked ring, since
 * the face itself has no box to ring (`choice-list.css`).
 */
const FACE =
  "overflow-hidden w-full max-w-[88px] aspect-square rounded-[50%] bg-border transition-[box-shadow] duration-(--luke-duration-hover) ease-[ease] [&_img]:block [&_img]:size-full [&_img]:object-cover [&_img]:object-[50%_25%] [:hover:not(:disabled)>&]:[box-shadow:0_0_0_2px_var(--luke-color-border-strong)]";

const FACE_RING = {
  rest: "[box-shadow:inset_0_0_0_1px_var(--luke-color-border-strong)]",
  picked: "[box-shadow:0_0_0_2px_var(--luke-color-switch-on)]",
} as const;

/**
 * A card holds its radio, what it says at the head's end, and controls of
 * its own under them, ringed once picked, and steps back whole while its
 * option is unavailable.
 */
const CARD = "luke-choice-card flex flex-col gap-luke-8 p-luke-12 rounded-control";

const CARD_RING = {
  rest: "[box-shadow:inset_0_0_0_1px_var(--luke-color-border)]",
  picked: "[box-shadow:inset_0_0_0_1px_var(--luke-color-border-selected)]",
} as const;

/** One option: the value it chooses, its words, and what stands beside them. */
export interface ChoiceOption<Value extends string> {
  value: Value;
  label: string;
  /** A line under the label: what the option means, or why it is unavailable. */
  detail?: string | undefined;
  /** A short word at the row's top right, the agent's "Recommended". */
  badge?: string | undefined;
  /**
   * The badge's tone while the list is open: the attention tone of a call to
   * act where none is given, or the neutral one for a word that only says
   * what the option is, as a voice's "Feminine" does.
   */
  badgeTone?: BadgeTone | undefined;
  /** A picture before the words, a workspace's tile; a picture list's face. */
  mark?: ReactNode;
  /** What hangs after the label on its line, a connected credential's check. */
  after?: ReactNode;
  /** A card list's word or link at the head's end, outside the radio. */
  aside?: ReactNode;
  /** A card list's controls under its head, which the card holds. */
  below?: ReactNode;
  /** Whether this option alone cannot be picked. */
  disabled?: boolean | undefined;
  /** What a marked row's control fills with once checked; the accent where none is given. */
  tone?: ChoiceTone | undefined;
}

interface ChoiceListBase<Value extends string> {
  /** The list's accessible name, which a sighted reader has from what stands over it. */
  legend: string;
  options: readonly ChoiceOption<Value>[];
  /** The values picked, at most one where the list picks one. */
  value: readonly Value[];
}

/** A list a reader picks from. */
export interface ChoiceListOpen<Value extends string> extends ChoiceListBase<Value> {
  settled?: false | undefined;
  select?: ChoiceSelect | undefined;
  /** Whether a pick-one list's checked row, pressed again, takes the choice back. */
  clearable?: boolean | undefined;
  /** Hears a press on a pick-one list's checked row that changes nothing, for a row that acts when pressed again. */
  onPressChecked?: ((value: Value) => void) | undefined;
  disabled?: boolean | undefined;
  /** The id of the words that describe the whole group, a settings row's description. */
  describedBy?: string | undefined;
  /** Whether the group's last write was refused. */
  invalid?: boolean | undefined;
  /** Whether a write is in flight, which rests the group without disabling it. */
  busy?: boolean | undefined;
  /** Whether it records a choice made, drawn as it was open and taking nothing. */
  readOnly?: boolean | undefined;
  /** Whether each row leads with its radio or its checkbox. */
  look?: ChoiceLook | undefined;
  /** Whether each of the first nine rows wears its number, the key the caller picks it by. */
  numbered?: boolean | undefined;
  /** Whether the rows stand one under another or side by side. */
  flow?: ChoiceFlow | undefined;
  /** Held by the row the keyboard lands on, so a dialog can focus it as it opens. */
  focusRef?: React.RefObject<HTMLButtonElement | null> | undefined;
  onChange: (value: readonly Value[]) => void;
}

/** The record of a choice made, which no press changes. */
export interface ChoiceListSettled<Value extends string> extends ChoiceListBase<Value> {
  settled: true;
  /** What stands beside a picked row's label after its check: "Your pick". */
  pickedNote: ReactNode;
}

/** The check before a picked row's note, or before a picked pill's words, in the ink around it. */
function PickedCheck({ className }: { className: string }): React.JSX.Element {
  return (
    <svg
      className={cn("luke-choice-check size-luke-12 align-[-1px]", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4.8 12.6 9.6 17.3 19.2 6.9" />
    </svg>
  );
}

/** The values a press on `pressed` leaves picked. */
function afterPress<Value extends string>(
  props: ChoiceListOpen<Value>,
  pressed: Value,
): readonly Value[] | undefined {
  const { value, select = CHOICE_SELECT.ONE } = props;
  const checked = value.includes(pressed);
  if (select === CHOICE_SELECT.MANY) {
    return checked ? value.filter((each) => each !== pressed) : [...value, pressed];
  }
  if (!checked) return [pressed];
  return props.clearable === true ? [] : undefined;
}

/** How a label shares its head with what stands at its end. */
function labelFlex(option: ChoiceOption<string>, look: ChoiceLook | undefined): string {
  // Note that a pill sizes to its words, and that only a badge asks a label for a measure, since a number alone stands beside any label.
  if (look === CHOICE_LOOK.PILL) return "flex-initial";
  return option.badge === undefined ? "flex-[1_1_0]" : "flex-[1_1_10em]";
}

/**
 * A row's words: its label with the badge at its top right, its number after that, and anything the caller hangs after the label, then its detail.
 *
 * The badge stands at the label's top right while the label keeps a
 * readable measure beside it; in a column too narrow for both, a side
 * panel's or a phone's, the badge and the number drop to a line of their
 * own under the label rather than squeezing it to a word a line. A word too
 * long for its line, a path or an identifier, still breaks anywhere rather
 * than pushing past the row's edge. Note that the detail's ink is
 * `choice-list.css`'s, which a stepped-back region quiets.
 */
function ChoiceWords({
  option,
  tone,
  look,
  after,
  number,
}: {
  option: ChoiceOption<string>;
  tone: BadgeTone;
  look?: ChoiceLook | undefined;
  after?: ReactNode;
  number?: number | undefined;
}): React.JSX.Element {
  const hung = after ?? option.after;
  return (
    <span
      className={cn(
        "luke-choice-words flex flex-col gap-luke-2 min-w-0",
        look === CHOICE_LOOK.CARD ? "flex-initial" : "flex-auto",
      )}
    >
      <span className="luke-choice-head flex flex-wrap items-start justify-between gap-x-luke-8 gap-y-luke-4">
        <span
          className={cn(
            "luke-choice-label min-w-0 font-medium wrap-anywhere",
            labelFlex(option, look),
          )}
        >
          {option.label}
          {hung}
        </span>
        {option.badge === undefined && number === undefined ? null : (
          <span className="luke-choice-end inline-flex flex-none items-center gap-luke-8">
            {option.badge === undefined ? null : <Badge tone={tone}>{option.badge}</Badge>}
            {/* The number is the row's key, which the row says to a reader as its key shortcut. */}
            {number === undefined ? null : (
              <span
                className="luke-choice-number min-w-[1ch] text-subtle-foreground text-caption leading-body tabular-nums text-center"
                aria-hidden="true"
              >
                {number}
              </span>
            )}
          </span>
        )}
      </span>
      {option.detail === undefined ? null : (
        <span className="luke-choice-detail text-caption">{option.detail}</span>
      )}
    </span>
  );
}

/** A face's name under its picture, faded where the face is too narrow to hold it, and set in the full ink once picked. */
function PictureName({ name, picked }: { name: string; picked: boolean }): React.JSX.Element {
  const [box, clipped] = useClipped(name);
  return (
    <span
      ref={box}
      className={cn(
        "luke-choice-name overflow-hidden max-w-full text-caption leading-body whitespace-nowrap",
        picked && "text-foreground font-semibold",
      )}
      data-overflow={String(clipped)}
    >
      {name}
    </span>
  );
}

/** A marked row's radio or checkbox, filled in the accent, or in its tone, once checked. */
function ChoiceControl({
  radio,
  checked,
  tone,
  inCard,
}: {
  radio: boolean;
  checked: boolean;
  tone: ChoiceTone | undefined;
  inCard: boolean;
}): React.JSX.Element {
  const shape = radio ? "radio" : "box";
  return (
    <span
      className={cn(
        CONTROL,
        radio ? "rounded-[50%]" : "rounded-choice-box",
        // Note that an unsaved credential's radio in a card cannot be picked, so its ring steps back while its label stays readable.
        inCard
          ? "mt-0 self-center [:disabled>&]:opacity-40"
          : "self-start mt-[calc((var(--luke-type-body-leading)-var(--luke-space-16))/2)]",
        !checked && "border-subtle-foreground",
        checked && (tone === undefined ? CONTROL_ACCENT_FILL : CONTROL_FILL[tone]),
        checked && CONTROL_MARK[shape],
        checked && CONTROL_INK[shape][tone === undefined ? "accent" : "toned"],
      )}
      data-shape={shape}
      aria-hidden="true"
    />
  );
}

/** What a row holds, by its look: a pill's check, a marked row's control, a mark, and its words or a face's name. */
function RowInside({
  radio,
  option,
  checked,
  look,
  number,
  badgeTone,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  look: ChoiceLook;
  number: number | undefined;
  badgeTone: BadgeTone;
}): React.JSX.Element {
  const picture = look === CHOICE_LOOK.PICTURE;
  return (
    <>
      {look === CHOICE_LOOK.PILL ? (
        <PickedCheck className={cn("flex-none m-0", checked ? "block" : "hidden")} />
      ) : null}
      {look === CHOICE_LOOK.MARKED || look === CHOICE_LOOK.CARD ? (
        <ChoiceControl
          radio={radio}
          checked={checked}
          tone={option.tone}
          inCard={look === CHOICE_LOOK.CARD}
        />
      ) : null}
      {option.mark === undefined ? null : (
        <span
          className={cn(
            "luke-choice-mark inline-flex flex-none",
            picture && FACE,
            picture && (checked ? FACE_RING.picked : FACE_RING.rest),
          )}
        >
          {option.mark}
        </span>
      )}
      {picture ? (
        <PictureName name={option.label} picked={checked} />
      ) : (
        <ChoiceWords
          option={option}
          tone={option.badgeTone ?? badgeTone}
          look={look}
          number={number}
        />
      )}
    </>
  );
}

/** One row a reader presses: a radio where the list picks one, a checkbox where it picks several. */
function ChoiceRow({
  radio,
  option,
  checked,
  tabStop,
  disabled,
  dims,
  look,
  across,
  number,
  focusRef,
  badgeTone,
  onPress,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  /** Whether an unavailable row fades, which a read-only list's and a card's do not. */
  dims: boolean;
  look: ChoiceLook;
  across: boolean;
  /** The badge's tone where the option names none. */
  badgeTone: BadgeTone;
  /** The row's key, counted from one, where the list is numbered and the row among its first nine. */
  number: number | undefined;
  focusRef: React.RefObject<HTMLButtonElement | null> | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const card = look === CHOICE_LOOK.CARD;
  const attributes = {
    ref: focusRef,
    render: <button type="button" />,
    nativeButton: true,
    value: option.value,
    tabIndex: tabStop ? 0 : -1,
    className: cn(
      ROW,
      ROW_LOOK[look],
      across && !card && ROW_ACROSS,
      "disabled:cursor-default",
      dims && "disabled:opacity-40",
    ),
    "data-tone": option.tone,
    disabled,
    "aria-keyshortcuts": number === undefined ? undefined : String(number),
    onClick: (event: React.MouseEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      // Note that the list answers the press itself, because Base UI's own takes no choice back.
      event.preventBaseUIHandler();
      // Note that a row's radio or box is what gives, as a checkbox's box does; a pill gives whole, a picture a little.
      const control = event.currentTarget.querySelector<HTMLElement>(
        ":scope > .luke-choice-control",
      );
      if (control !== null) pulsePress(control);
      else
        pulsePress(
          event.currentTarget,
          look === CHOICE_LOOK.PICTURE ? PRESS_PULSE.QUIET : PRESS_PULSE.CONTROL,
        );
      onPress();
    },
    // Note that Enter presses a row as a button's Enter does, which Base UI's radio and checkbox refuse.
    onKeyDown: (event: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      if (event.key === "Enter") event.preventBaseUIHandler();
    },
    // Note that focus landing on a radio chooses nothing, because the arrows choose for themselves.
    onFocus: (event: React.FocusEvent<HTMLElement> & { preventBaseUIHandler: () => void }) => {
      event.preventBaseUIHandler();
    },
  } as const;
  const inside = (
    <RowInside
      radio={radio}
      option={option}
      checked={checked}
      look={look}
      number={number}
      badgeTone={badgeTone}
    />
  );
  const row = radio ? (
    <Radio.Root {...attributes}>{inside}</Radio.Root>
  ) : (
    <Checkbox.Root {...attributes}>{inside}</Checkbox.Root>
  );
  if (!card) return row;
  return (
    <div
      className={cn(
        CARD,
        checked ? CARD_RING.picked : CARD_RING.rest,
        option.detail !== undefined && "opacity-55",
      )}
      data-checked={checked}
      data-unavailable={option.detail === undefined ? undefined : true}
    >
      <div className="luke-choice-card-head flex items-center justify-between gap-luke-8">
        {row}
        {option.aside === undefined ? null : (
          <span className="luke-choice-aside text-caption-inline">{option.aside}</span>
        )}
      </div>
      {option.below === undefined || option.below === null ? null : (
        <div className="luke-choice-card-body flex flex-col gap-luke-6">{option.below}</div>
      )}
    </div>
  );
}

/** The list's own box, by its look and flow. */
function listClass(look: ChoiceLook, flow: ChoiceFlow): string {
  const down = look !== CHOICE_LOOK.PILL && flow === CHOICE_FLOW.DOWN;
  return cn(LIST, LIST_LOOK[look], down ? "flex-col" : "flex-row");
}

/** The rows as a radio group or a group of checkboxes. */
function OpenChoices<Value extends string>(props: ChoiceListOpen<Value>): React.JSX.Element {
  const {
    legend,
    options,
    value,
    disabled = false,
    readOnly = false,
    describedBy,
    invalid,
    busy,
    focusRef,
    select = CHOICE_SELECT.ONE,
    look = CHOICE_LOOK.PLAIN,
    numbered = false,
    flow = CHOICE_FLOW.DOWN,
  } = props;
  const one = select === CHOICE_SELECT.ONE;
  const still = disabled || readOnly;
  const open = options.filter((option) => option.disabled !== true);
  const landing = open.find((option) => value.includes(option.value)) ?? open[0];
  const press = (pressed: Value) => {
    const next = afterPress(props, pressed);
    if (next !== undefined) props.onChange(next);
    else if (one) props.onPressChecked?.(pressed);
  };
  // An arrow chooses the next open row along and takes the keyboard there, wrapping at either end.
  const onKeyDown = (
    event: React.KeyboardEvent<HTMLElement> & { preventBaseUIHandler: () => void },
  ) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined) return;
    // Note that Base UI's own arrows never run, so a key pressed in a card's controls stays theirs.
    event.preventBaseUIHandler();
    if (open.length === 0 || still) return;
    // Note that a key pressed in a card's own controls is theirs, not the group's.
    if (!(event.target instanceof HTMLElement) || event.target.getAttribute("role") !== "radio") {
      return;
    }
    event.preventDefault();
    // Note that the step counts from the focused row, because clearing a pick leaves focus on an unchecked row.
    const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const focused = event.target instanceof HTMLButtonElement ? radios.indexOf(event.target) : -1;
    const from = open.findIndex((option) => option === options[focused]);
    const at = from >= 0 ? from : open.findIndex((option) => value.includes(option.value));
    const next = open[(Math.max(at, 0) + step + open.length) % open.length];
    if (next === undefined) return;
    if (!value.includes(next.value)) props.onChange([next.value]);
    radios[options.indexOf(next)]?.focus();
  };
  // An arrow along a pick-several list moves the keyboard to the next open row and toggles nothing.
  const onBoxKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined || still) return;
    const boxes = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="checkbox"]:not(:disabled)',
      ),
    ];
    const at = event.target instanceof HTMLButtonElement ? boxes.indexOf(event.target) : -1;
    if (at < 0) return;
    event.preventDefault();
    boxes[(at + step + boxes.length) % boxes.length]?.focus();
  };
  const rows = options.map((option, index) => (
    <ChoiceRow
      key={option.value}
      radio={one}
      option={option}
      checked={value.includes(option.value)}
      tabStop={!one || option === landing}
      disabled={still || option.disabled === true}
      dims={!readOnly && look !== CHOICE_LOOK.CARD}
      look={look}
      across={flow === CHOICE_FLOW.ACROSS}
      number={numbered && index < CHOICE_NUMBERED_ROWS ? index + 1 : undefined}
      focusRef={option === landing ? focusRef : undefined}
      badgeTone={readOnly ? BADGE_TONE.NEUTRAL : BADGE_TONE.ATTENTION}
      onPress={() => press(option.value)}
    />
  ));
  const group = {
    "aria-label": legend,
    "aria-describedby": describedBy,
    "aria-invalid": invalid,
    "aria-busy": busy,
    className: listClass(look, flow),
    "data-flow": flow,
    "data-look": look,
    "data-read-only": readOnly || undefined,
  };
  if (!one) {
    return (
      <CheckboxGroup {...group} render={<fieldset />} value={[...value]} onKeyDown={onBoxKeyDown}>
        {rows}
      </CheckboxGroup>
    );
  }
  return (
    <RadioGroup
      {...group}
      value={value[0] ?? null}
      readOnly={readOnly || undefined}
      onKeyDown={onKeyDown}
      // Note that focus landing in a card's own field keeps its caret, which Base UI's group would select across.
      onFocus={(event) => event.preventBaseUIHandler()}
    >
      {rows}
    </RadioGroup>
  );
}

/** The rows as a list no press changes, the picked ones checked and noted. */
function SettledChoices<Value extends string>({
  legend,
  options,
  value,
  pickedNote,
}: ChoiceListSettled<Value>): React.JSX.Element {
  return (
    <ul aria-label={legend} className={listClass(CHOICE_LOOK.PLAIN, CHOICE_FLOW.DOWN)}>
      {options.map((option) => {
        const picked = value.includes(option.value);
        return (
          <li key={option.value} className={ROW} data-picked={picked}>
            {option.mark === undefined ? null : (
              <span className="luke-choice-mark inline-flex flex-none">{option.mark}</span>
            )}
            <ChoiceWords
              option={option}
              tone={BADGE_TONE.NEUTRAL}
              after={
                picked ? (
                  // Note that the note runs inline in the label's line, so its smaller words share the label's baseline rather than a box's centre.
                  <span className="luke-choice-picked ml-luke-8 text-muted-foreground text-caption leading-body font-regular whitespace-nowrap">
                    <PickedCheck className="mr-luke-2" />
                    {pickedNote}
                  </span>
                ) : null
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/** The options of a choice: picked from while open, recorded once settled. */
export function ChoiceList<Value extends string>(
  props: ChoiceListOpen<Value> | ChoiceListSettled<Value>,
): React.JSX.Element {
  return props.settled === true ? <SettledChoices {...props} /> : <OpenChoices {...props} />;
}
