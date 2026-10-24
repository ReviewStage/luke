import type { ReactNode } from "react";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { useClipped } from "../../use-clipped.js";
import { Badge } from "../badge/badge.js";

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

/** How many of a numbered list's rows wear their number: the keys 1 to 9. */
export const CHOICE_NUMBERED_ROWS = 9;

/** The keys that step along a pick-one list, and which way. */
const STEP_KEYS = new Map([
  ["ArrowDown", 1],
  ["ArrowRight", 1],
  ["ArrowUp", -1],
  ["ArrowLeft", -1],
]);

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
  badgeTone?: StatusTone | undefined;
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
  tone?: StatusTone | undefined;
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

/** The check before a picked row's note, in the note's own ink. */
function PickedCheck(): React.JSX.Element {
  return (
    <svg
      className="luke-choice-check"
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

/** A row's words: its label with the badge at its top right, its number after that, and anything the caller hangs after the label, then its detail. */
function ChoiceWords({
  option,
  tone,
  after,
  number,
}: {
  option: ChoiceOption<string>;
  tone: StatusTone;
  after?: ReactNode;
  number?: number | undefined;
}): React.JSX.Element {
  const hung = after ?? option.after;
  return (
    <span className="luke-choice-words">
      <span className="luke-choice-head">
        <span className="luke-choice-label">
          {option.label}
          {hung}
        </span>
        {option.badge === undefined && number === undefined ? null : (
          <span className="luke-choice-end">
            {option.badge === undefined ? null : <Badge tone={tone}>{option.badge}</Badge>}
            {/* The number is the row's key, which the row says to a reader as its key shortcut. */}
            {number === undefined ? null : (
              <span className="luke-choice-number" aria-hidden="true">
                {number}
              </span>
            )}
          </span>
        )}
      </span>
      {option.detail === undefined ? null : (
        <span className="luke-choice-detail">{option.detail}</span>
      )}
    </span>
  );
}

/** A face's name under its picture, faded where the face is too narrow to hold it. */
function PictureName({ name }: { name: string }): React.JSX.Element {
  const [box, clipped] = useClipped(name);
  return (
    <span ref={box} className="luke-choice-name" data-overflow={String(clipped)}>
      {name}
    </span>
  );
}

/** One row a reader presses: a radio where the list picks one, a checkbox where it picks several. */
function ChoiceRow({
  radio,
  option,
  checked,
  tabStop,
  disabled,
  look,
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
  look: ChoiceLook;
  /** The badge's tone where the option names none. */
  badgeTone: StatusTone;
  /** The row's key, counted from one, where the list is numbered and the row among its first nine. */
  number: number | undefined;
  focusRef: React.RefObject<HTMLButtonElement | null> | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const attributes = {
    ref: focusRef,
    type: "button",
    tabIndex: tabStop ? 0 : -1,
    className: "luke-choice",
    "data-tone": option.tone,
    disabled,
    "aria-keyshortcuts": number === undefined ? undefined : String(number),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
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
  } as const;
  const words = (
    <>
      {look === CHOICE_LOOK.PILL ? <PickedCheck /> : null}
      {look === CHOICE_LOOK.MARKED || look === CHOICE_LOOK.CARD ? (
        <span
          className="luke-choice-control"
          data-shape={radio ? "radio" : "box"}
          aria-hidden="true"
        />
      ) : null}
      {option.mark === undefined ? null : <span className="luke-choice-mark">{option.mark}</span>}
      {look === CHOICE_LOOK.PICTURE ? (
        <PictureName name={option.label} />
      ) : (
        <ChoiceWords option={option} tone={option.badgeTone ?? badgeTone} number={number} />
      )}
    </>
  );
  // Note that each role is spelled out, because a role read off a value is one the accessibility lint cannot check.
  const row = radio ? (
    // biome-ignore lint/a11y/useSemanticElements: a row is drawn as a button holding a label, a detail, and a badge, which a native radio cannot be, and speaks as the radio it behaves as.
    <button role="radio" aria-checked={checked} {...attributes}>
      {words}
    </button>
  ) : (
    // biome-ignore lint/a11y/useSemanticElements: a row is drawn as a button holding a label, a detail, and a badge, which a native checkbox cannot be, and speaks as the checkbox it behaves as.
    <button role="checkbox" aria-checked={checked} {...attributes}>
      {words}
    </button>
  );
  if (look !== CHOICE_LOOK.CARD) return row;
  return (
    <div
      className="luke-choice-card"
      data-checked={checked}
      data-unavailable={option.detail === undefined ? undefined : true}
    >
      <div className="luke-choice-card-head">
        {row}
        {option.aside === undefined ? null : (
          <span className="luke-choice-aside">{option.aside}</span>
        )}
      </div>
      {option.below === undefined || option.below === null ? null : (
        <div className="luke-choice-card-body">{option.below}</div>
      )}
    </div>
  );
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
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined || open.length === 0 || still) return;
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
  const onBoxKeyDown = (event: React.KeyboardEvent<HTMLFieldSetElement>) => {
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
      look={look}
      number={numbered && index < CHOICE_NUMBERED_ROWS ? index + 1 : undefined}
      focusRef={option === landing ? focusRef : undefined}
      badgeTone={readOnly ? STATUS_TONE.NEUTRAL : STATUS_TONE.ATTENTION}
      onPress={() => press(option.value)}
    />
  ));
  if (!one) {
    return (
      <fieldset
        aria-label={legend}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-busy={busy}
        className="luke-choice-list"
        data-flow={flow}
        data-look={look}
        data-read-only={readOnly || undefined}
        onKeyDown={onBoxKeyDown}
      >
        {rows}
      </fieldset>
    );
  }
  return (
    <div
      role="radiogroup"
      aria-label={legend}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      aria-busy={busy}
      aria-readonly={readOnly || undefined}
      className="luke-choice-list"
      data-flow={flow}
      data-look={look}
      data-read-only={readOnly || undefined}
      onKeyDown={onKeyDown}
    >
      {rows}
    </div>
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
    <ul aria-label={legend} className="luke-choice-list">
      {options.map((option) => {
        const picked = value.includes(option.value);
        return (
          <li key={option.value} className="luke-choice" data-picked={picked}>
            {option.mark === undefined ? null : (
              <span className="luke-choice-mark">{option.mark}</span>
            )}
            <ChoiceWords
              option={option}
              tone={STATUS_TONE.NEUTRAL}
              after={
                picked ? (
                  <span className="luke-choice-picked">
                    <PickedCheck />
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
