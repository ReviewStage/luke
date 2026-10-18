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
 * checkboxes in a fieldset, each its own Tab stop, toggled by a press, Space, or Enter.
 * A row may be unavailable on its own, saying why in its detail, and the
 * keyboard steps past it.
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

/** A row's words: its label with the badge at its top right and anything the caller hangs after it, then its detail. */
function ChoiceWords({
  option,
  tone,
  after,
}: {
  option: ChoiceOption<string>;
  tone: BadgeTone;
  after?: ReactNode;
}): React.JSX.Element {
  return (
    <span className="luke-choice-words">
      <span className="luke-choice-head">
        <span className="luke-choice-label">
          {option.label}
          {after}
        </span>
        {option.badge === undefined ? null : <Badge tone={tone}>{option.badge}</Badge>}
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
  focusRef,
  onPress,
}: {
  radio: boolean;
  option: ChoiceOption<string>;
  checked: boolean;
  tabStop: boolean;
  disabled: boolean;
  focusRef: React.RefObject<HTMLButtonElement | null> | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const attributes = {
    ref: focusRef,
    type: "button",
    tabIndex: tabStop ? 0 : -1,
    className: "luke-choice",
    disabled,
    onClick: onPress,
  } as const;
  const words = (
    <>
      {option.mark === undefined ? null : <span className="luke-choice-mark">{option.mark}</span>}
      <ChoiceWords option={option} tone={BADGE_TONE.ATTENTION} />
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
  const { legend, options, value, disabled = false, focusRef, select = CHOICE_SELECT.ONE } = props;
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
    const at = open.findIndex((option) => value.includes(option.value));
    const next = open[(Math.max(at, 0) + step + open.length) % open.length];
    if (next === undefined) return;
    if (!value.includes(next.value)) props.onChange([next.value]);
    event.currentTarget
      .querySelectorAll<HTMLButtonElement>('[role="radio"]')
      [options.indexOf(next)]?.focus();
  };
  const rows = options.map((option) => (
    <ChoiceRow
      key={option.value}
      radio={one}
      option={option}
      checked={value.includes(option.value)}
      tabStop={!one || option === landing}
      disabled={disabled || option.disabled === true}
      focusRef={option === landing ? focusRef : undefined}
      onPress={() => press(option.value)}
    />
  ));
  if (!one) {
    return (
      <fieldset aria-label={legend} className="luke-choice-list">
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
