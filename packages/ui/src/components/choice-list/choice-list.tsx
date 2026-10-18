import type { ReactNode } from "react";
import { BADGE_TONE, Badge, type BadgeTone } from "../badge/badge.js";

/**
 * choice-list.tsx -- a list of options a reader picks from, each a row the width of its column holding a label, a line of detail, and a badge: one of them, or any that apply, and once settled, what was offered with what was picked.
 *
 * Picking one is a radio group: the group is named by its legend, each row
 * is a radio checked while its value is, Tab lands on the checked row (the
 * first open one while none is) and leaves the group in one press, and the
 * arrow keys move along the open rows and choose as they go, wrapping at
 * either end. A press on the checked row does nothing, unless the list is
 * `clearable`, where it takes the choice back. Picking several is a group of
 * checkboxes in a fieldset, each its own Tab stop, toggled by a press or
 * Space, the arrow keys moving the keyboard along them without toggling.
 * Enter presses no row: it is left to what holds the list, a form's send,
 * so a reader's Enter on a picked row never takes the pick back. A row may
 * be unavailable on its own, saying why in its detail, and the keyboard
 * steps past it.
 *
 * A `marked` list leads each row with the control it behaves as, a radio's
 * round mark or a checkbox's square, filled in the accent once checked, so
 * one pick or several reads before a word does. A `numbered` list wears each
 * of its first nine rows' number at the row's right, after the badge, and
 * says it to a reader as the row's key; the caller answers the keys, since
 * a number picks a row from wherever the caller lets it.
 *
 * A settled list is the record of a choice made: the same rows as a list a
 * reader cannot press, the picked ones in the checked look with a check and
 * the caller's words for whose pick it was, and the rest stepped back to an
 * outline. A badge (the agent's "Recommended") stands at the row's top
 * right however the label wraps, in the attention tone while the choice
 * waits on the reader and the neutral one once settled, when it is history
 * rather than a call to act.
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

/** How an open list's rows lead: with their words alone, or with the radio or checkbox each behaves as. */
export const CHOICE_LOOK = {
  PLAIN: "plain",
  MARKED: "marked",
} as const;

export type ChoiceLook = (typeof CHOICE_LOOK)[keyof typeof CHOICE_LOOK];

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
  /** A picture before the words, a workspace's tile. */
  mark?: ReactNode;
  /** Whether this option alone cannot be picked. */
  disabled?: boolean | undefined;
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
  disabled?: boolean | undefined;
  /** Whether each row leads with its radio or its checkbox. */
  look?: ChoiceLook | undefined;
  /** Whether each of the first nine rows wears its number, the key the caller picks it by. */
  numbered?: boolean | undefined;
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
  tone: BadgeTone;
  after?: ReactNode;
  number?: number | undefined;
}): React.JSX.Element {
  return (
    <span className="luke-choice-words">
      <span className="luke-choice-head">
        <span className="luke-choice-label">
          {option.label}
          {after}
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

/** One row a reader presses: a radio where the list picks one, a checkbox where it picks several. */
function ChoiceRow({
  radio,
  option,
  checked,
  tabStop,
  disabled,
  marked,
  number,
  focusRef,
  onPress,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  marked: boolean;
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
    disabled,
    "aria-keyshortcuts": number === undefined ? undefined : String(number),
    onClick: onPress,
    // Note that Enter presses no row, because it is the send of whatever holds the list.
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Enter") event.preventDefault();
    },
  } as const;
  const words = (
    <>
      {marked ? (
        <span
          className="luke-choice-control"
          data-shape={radio ? "radio" : "box"}
          aria-hidden="true"
        />
      ) : null}
      {option.mark === undefined ? null : <span className="luke-choice-mark">{option.mark}</span>}
      <ChoiceWords option={option} tone={BADGE_TONE.ATTENTION} number={number} />
    </>
  );
  // Note that each role is spelled out, because a role read off a value is one the accessibility lint cannot check.
  return radio ? (
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
}

/** The rows as a radio group or a group of checkboxes. */
function OpenChoices<Value extends string>(props: ChoiceListOpen<Value>): React.JSX.Element {
  const {
    legend,
    options,
    value,
    disabled = false,
    focusRef,
    select = CHOICE_SELECT.ONE,
    look = CHOICE_LOOK.PLAIN,
    numbered = false,
  } = props;
  const one = select === CHOICE_SELECT.ONE;
  const open = options.filter((option) => option.disabled !== true);
  const landing = open.find((option) => value.includes(option.value)) ?? open[0];
  const press = (pressed: Value) => {
    const next = afterPress(props, pressed);
    if (next !== undefined) props.onChange(next);
  };
  // An arrow chooses the next open row along and takes the keyboard there, wrapping at either end.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = STEP_KEYS.get(event.key);
    if (step === undefined || open.length === 0 || disabled) return;
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
    if (step === undefined || disabled) return;
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
      disabled={disabled || option.disabled === true}
      marked={look === CHOICE_LOOK.MARKED}
      number={numbered && index < CHOICE_NUMBERED_ROWS ? index + 1 : undefined}
      focusRef={option === landing ? focusRef : undefined}
      onPress={() => press(option.value)}
    />
  ));
  if (!one) {
    return (
      <fieldset aria-label={legend} className="luke-choice-list" onKeyDown={onBoxKeyDown}>
        {rows}
      </fieldset>
    );
  }
  return (
    <div role="radiogroup" aria-label={legend} className="luke-choice-list" onKeyDown={onKeyDown}>
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
              tone={BADGE_TONE.NEUTRAL}
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
