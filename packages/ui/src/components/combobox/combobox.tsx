import type { ComponentPropsWithRef, ReactNode, Ref } from "react";
import { useId, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { cn } from "../../cn.js";
import { CheckIcon, ChevronRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import {
  COMBOBOX_EMPTY,
  COMBOBOX_HEADING,
  COMBOBOX_ITEM,
  COMBOBOX_ITEM_DETAIL,
  COMBOBOX_ITEM_END,
  COMBOBOX_ITEM_GLYPH,
  COMBOBOX_ITEM_HINT,
  COMBOBOX_ITEM_LABEL,
  COMBOBOX_ITEM_LEAD,
  COMBOBOX_LIST,
  COMBOBOX_WELL,
} from "../../shadcn/combobox.js";
import { OneLine } from "../one-line/one-line.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";
import { type ComboboxField, useComboboxField } from "./use-combobox-field.js";

/**
 * combobox.tsx -- a text field whose words narrow a list of options under it, which the keys move through while the caret stays in the field.
 *
 * The field is controlled, as a TextField is: the caller owns the words and
 * answers every change. The caller owns the list too: which options stand,
 * whether the list is open, and which option is active, so a list that
 * filters, searches a service, or offers the words as typed as an option of
 * their own is the caller's to build and this control's to draw and steer.
 *
 * The caret never leaves the field. The active option is named to a reader
 * by the field's `aria-activedescendant` and the option's `aria-selected`,
 * and a press on an option is kept from taking focus, so the keys go on
 * arriving where the words are typed. While the list is open, ↑ and ↓ move
 * the active option, wrapping at either end, Home and End take it to the
 * first and the last, Enter chooses it, and Escape is handed to the caller
 * to shut the list, kept from the surface behind the field (a dialog's own
 * Escape would close it out from under the list). An Enter held with
 * Command or Control, or one pressed while the list is shut, chooses no
 * option and answers `onEnter` instead, for the words as typed.
 *
 * Keys an input method is composing with are its own: the Enter that
 * commits a composition and the Escape that dismisses its candidates never
 * reach the list, though an Escape is still kept from the surface behind.
 * The keys and the field's names are `useComboboxField`'s, which the
 * desktop's searchable menu steers its own rows with too.
 *
 * Options stand in groups, each with an optional heading, and the active
 * option counts across them, so a caller's index is one list's. Each option
 * draws a leading glyph, its name, a detail that gives way first, a hint
 * at its end, such as the chord that chooses it or why it cannot be chosen
 * now, and a chevron where choosing it opens a further list, or a check
 * where it is the one chosen now. An option that cannot be chosen now is
 * dimmed, and the pointer, a press, and the keys (where the caller skips
 * it) all pass it over.
 *
 * The list stands on its own too (`ComboboxList`), for a caller whose words
 * are typed in an editor of its own rather than a field this control owns:
 * the caller reads the keys, steers the active option, and places the list,
 * which draws the options as above, a note where none stands, and keeps
 * every press from taking the caret out of the editor. With no field at all,
 * as a list too short to search, the list takes the keys itself (`steer`):
 * it holds the focus and names the active option as a field would.
 *
 * Where a list engine of the app's (cmdk) owns the list box as well as its
 * rows, the box is drawn as `ComboboxListBox`, handed through the engine's
 * `asChild` as each row is drawn as `ComboboxOptionItem`: the engine's
 * role, names, keys, and ref pass through, its rows and headings stand
 * inside, and the box scrolls up and down as every list here does. It
 * stands at a list's capped height, or fills the column its caller gives
 * it, as a palette's results fill the card under its field.
 */

/** How tall a list engine's box stands: capped as every list is, or filling the column it stands in. */
export const COMBOBOX_LIST_HEIGHT = {
  /** At most `--luke-combobox-list-max`, as a list under a field stands. */
  CAPPED: "capped",
  /** Whatever room is left in the flex column it stands in, as a palette's results fill its card. */
  FILL: "fill",
} as const;

export type ComboboxListHeight = (typeof COMBOBOX_LIST_HEIGHT)[keyof typeof COMBOBOX_LIST_HEIGHT];

/** One option: what it is called, and what is drawn around its name. */
export interface ComboboxOption {
  /** The caller's own key for the option, stable while it stands. */
  readonly id: string;
  readonly label: ReactNode;
  /** Its name in plain words, where `label` draws them marked, which names its card to a reader. */
  readonly words?: string | undefined;
  /** Before its glyph, in a column the options leading with one line up in, as a task's key leads its row in the Tasks list. */
  readonly lead?: ReactNode;
  readonly icon?: ReactNode;
  /** Words after the name, quieter, which give way to it in a narrow list. */
  readonly detail?: ReactNode;
  /** At the option's end: the chord that chooses it, or any short mark. */
  readonly hint?: ReactNode;
  /** Whether choosing it opens a further list rather than choosing it, which a chevron at its end says. */
  readonly opens?: boolean | undefined;
  /** Whether it cannot be chosen now: dimmed, and passed over by the pointer and a press. */
  readonly disabled?: boolean | undefined;
  /**
   * Whether it is the one chosen now, which a check at its end says; false
   * keeps the check's room, so the hints of a list that has a chosen
   * option end in one line down it.
   */
  readonly current?: boolean | undefined;
  /** The card hung beside the option while the pointer rests on it, as a row of ⌘K hangs its agent's; none hangs nothing. */
  readonly card?: ReactNode;
}

/** A run of options under a heading, or under none. */
export interface ComboboxGroup {
  /** The heading drawn over the run, which names it to a reader too. */
  readonly label?: string | undefined;
  readonly options: readonly ComboboxOption[];
}

/** What a list engine hands the row it owns: its role, names, data, handlers, and ref, and never a class or a style. */
export type ComboboxOptionEngineProps = Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children"
>;

/**
 * One option as every list draws it: its lead, its glyph, its name, its
 * detail, its hint, and its end, lit while it is `aria-selected`. It is the row to use
 * where a list engine of the app's (cmdk) owns the item, handed through the
 * engine's `asChild`: the engine's role, names, handlers, and ref pass
 * through, and no class or style does, so the row is drawn only as here.
 * One that cannot be chosen now passes no press on to the engine.
 */
export function ComboboxOptionItem({
  option,
  ...engine
}: { option: ComboboxOption } & ComboboxOptionEngineProps): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field or the engine reads the keys and names this option active.
    <div
      role="option"
      // Note that an option is focusable by a press alone, which the list keeps from taking focus.
      tabIndex={-1}
      aria-disabled={option.disabled === true ? "true" : undefined}
      aria-current={option.current === true ? "true" : undefined}
      {...engine}
      // Note that an option that cannot be chosen now takes no press, whatever the engine handed it.
      onClick={
        option.disabled === true ? undefined : pulseOnPress(engine.onClick, PRESS_PULSE.QUIET)
      }
      className={cn("luke-combobox-option", COMBOBOX_ITEM)}
      style={undefined}
    >
      {option.lead === undefined ? null : (
        <span className={cn("luke-combobox-option-lead", COMBOBOX_ITEM_LEAD)}>{option.lead}</span>
      )}
      {option.icon === undefined ? null : (
        <span className={cn("luke-combobox-option-glyph", COMBOBOX_ITEM_GLYPH)}>{option.icon}</span>
      )}
      {/* Note that the name and its detail fade where the row cuts them short, as every cut line of the app does, rather than ending in an ellipsis. */}
      <span className={cn("luke-combobox-option-label", COMBOBOX_ITEM_LABEL)}>
        <OneLine>{option.label}</OneLine>
      </span>
      {/* Note that the first of the detail, the hint, and the end to stand pushes the rest to the row's end. */}
      {option.detail === undefined ? null : (
        <span className={cn("luke-combobox-option-detail", COMBOBOX_ITEM_DETAIL, "ml-auto")}>
          <OneLine>{option.detail}</OneLine>
        </span>
      )}
      {option.hint === undefined ? null : (
        <span
          className={cn(
            "luke-combobox-option-hint",
            COMBOBOX_ITEM_HINT,
            option.detail === undefined && "ml-auto",
          )}
        >
          {option.hint}
        </span>
      )}
      {option.opens === true || option.current !== undefined ? (
        <span
          className={cn(
            "luke-combobox-option-end",
            COMBOBOX_ITEM_END,
            option.detail === undefined && option.hint === undefined && "ml-auto",
          )}
        >
          {option.opens === true ? <ChevronRightIcon /> : option.current ? <CheckIcon /> : null}
        </span>
      ) : null}
    </div>
  );
}

/** One option's row: a press chooses it and keeps the caret in the field, a pointer moving over it makes it active. */
function OptionRow({
  id,
  option,
  active,
  onActive,
  onChoose,
}: {
  id: string;
  option: ComboboxOption;
  active: boolean;
  onActive: () => void;
  onChoose: () => void;
}): React.JSX.Element {
  const row = (
    <ComboboxOptionItem
      id={id}
      option={option}
      aria-selected={active}
      onMouseMove={active || option.disabled === true ? undefined : onActive}
      onClick={option.disabled === true ? undefined : onChoose}
    />
  );
  if (option.card === undefined) return row;
  return (
    <Tooltip
      label={option.words ?? (typeof option.label === "string" ? option.label : undefined)}
      card={option.card}
      cardBeside
    >
      {row}
    </Tooltip>
  );
}

/** The id of the option at `index` in the list `listId`, which a field names as the active one. */
export function comboboxOptionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/**
 * A list box as every list draws it, around rows a list engine of the
 * app's (cmdk) owns, handed through the engine's `asChild`: the engine's
 * role, names, keys, and ref pass through, no class or style does, and
 * the rows the engine hands it stand inside. It scrolls up and down and
 * never sideways, at the `height` its caller chose. Note that it calls no
 * hook, because an engine may draw it by calling it as a function.
 */
export function ComboboxListBox({
  height = COMBOBOX_LIST_HEIGHT.CAPPED,
  children,
  ...engine
}: {
  height?: ComboboxListHeight | undefined;
  children?: ReactNode;
} & ComboboxOptionEngineProps): React.JSX.Element {
  return (
    <div
      role="listbox"
      tabIndex={-1}
      {...engine}
      className={cn("luke-combobox-list", COMBOBOX_LIST)}
      style={undefined}
      data-slot="combobox-list"
      data-height={height}
    >
      {children}
    </div>
  );
}

/**
 * The `groups` of options as a listbox named `label`, `active` the one
 * washed: a pointer moving over an option makes it active, a press chooses
 * it, and no press anywhere on the list takes the caret from where the keys
 * are read. The active option is kept in the list's own view.
 */
export function ComboboxList({
  id,
  label,
  groups,
  active,
  onActiveChange,
  onChoose,
  headed = true,
  empty,
  note,
  steer,
  ref,
}: {
  /** The listbox's id, which a field names in `aria-controls`; one is minted where none is given. */
  id?: string | undefined;
  /** The list's accessible name, what its options are. */
  label: string;
  groups: readonly ComboboxGroup[];
  /** The active option, from zero across every group; none where it stands outside them. */
  active: number;
  onActiveChange: (active: number) => void;
  /** What a press on an option does, with its index across every group. */
  onChoose: (index: number, option: ComboboxOption) => void;
  /** Whether each group's heading is drawn; a list standing under a title that names its one group draws none, its group still named to a reader. */
  headed?: boolean | undefined;
  /** What the list says where it holds no option; nothing is said where none is given. */
  empty?: string | undefined;
  /** Said after the options, whether or not any stand: that more are being read, or why they could not be. */
  note?: ReactNode;
  /** The keys and names of a list with no field, which then holds the focus and names the active option itself. */
  steer?: ComboboxField | undefined;
  /** The list itself, for a caller that hands it the focus. */
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const minted = useId();
  const listId = id ?? minted;
  const list = useRef<HTMLDivElement>(null);
  useImperativeHandle<HTMLDivElement | null, HTMLDivElement | null>(ref, () => list.current, []);
  const options = groups.flatMap((group) => group.options);
  // Note that an active index outside the options washes none, because a
  // caller's highlight may stand past them, on a row of its own.
  const at = active >= 0 && active < options.length ? active : -1;
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) onChoose(index, option);
  };

  // Note that the active option is scrolled into the list's own view by
  // hand, because the caret stays where the keys are read, which no
  // browser scrolls the list for, and `scrollIntoView` would scroll every
  // box around it; one the pointer made active is where the pointer is, so
  // the list stands still under it rather than scroll the row away, and
  // the card the row hangs with it.
  const pointed = useRef(false);
  useLayoutEffect(() => {
    if (pointed.current) {
      pointed.current = false;
      return;
    }
    const box = list.current;
    const row = at < 0 ? null : document.getElementById(comboboxOptionId(listId, at));
    if (box === null || row === null) return;
    if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    const bottom = row.offsetTop + row.offsetHeight - box.clientHeight;
    if (bottom > box.scrollTop) box.scrollTop = bottom;
  });

  let offset = 0;
  const runs = groups.map((group) => {
    const start = offset;
    offset += group.options.length;
    return { group, start };
  });

  return (
    // Note that a press anywhere on the list keeps the caret where the keys are read.
    <div
      ref={list}
      id={listId}
      className={cn("luke-combobox-list", COMBOBOX_LIST)}
      data-slot="combobox-list"
      role="listbox"
      aria-label={label}
      aria-activedescendant={steer?.field["aria-activedescendant"]}
      tabIndex={steer === undefined ? undefined : -1}
      onKeyDown={steer?.onKeyDown}
      onMouseDown={(event) => event.preventDefault()}
    >
      {runs.map(({ group, start }) => {
        const rows = group.options.map((option, index) => (
          <OptionRow
            key={option.id}
            id={comboboxOptionId(listId, start + index)}
            option={option}
            active={start + index === at}
            onActive={() => {
              pointed.current = true;
              onActiveChange(start + index);
            }}
            onChoose={() => choose(start + index)}
          />
        ));
        if (group.label === undefined) return rows;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a listbox's section is a group of options, which a <fieldset> of form controls is not.
          <div key={start} role="group" aria-label={group.label}>
            {headed ? (
              <Text
                as={TEXT_ELEMENT.DIV}
                variant={TEXT_VARIANT.GROUP}
                className={cn("luke-combobox-heading", COMBOBOX_HEADING)}
                aria-hidden="true"
              >
                {group.label}
              </Text>
            ) : null}
            {rows}
          </div>
        );
      })}
      {options.length === 0 && empty !== undefined ? (
        <p className={cn("luke-combobox-empty", COMBOBOX_EMPTY)}>{empty}</p>
      ) : null}
      {note === undefined || note === null ? null : (
        <div className={cn("luke-combobox-note", COMBOBOX_EMPTY, "flex-col gap-luke-4")}>
          {note}
        </div>
      )}
    </div>
  );
}

/** A field named `label`, holding `value`, over the `groups` of options it narrows while `open`. */
export function Combobox({
  label,
  listLabel,
  value,
  onChange,
  groups,
  open,
  active,
  onActiveChange,
  onChoose,
  onEnter,
  onEscape,
  placeholder,
  disabled,
  maxLength,
  spellCheck,
  keyShortcuts,
  ref,
}: {
  /** The field's accessible name. */
  label: string;
  /** The list's accessible name, what its options are. */
  listLabel: string;
  value: string;
  onChange: (value: string) => void;
  groups: readonly ComboboxGroup[];
  /** Whether the list stands under the field; it is drawn only while it holds an option. */
  open: boolean;
  /** The active option, from zero across every group. */
  active: number;
  onActiveChange: (active: number) => void;
  /** What choosing an option does, by Enter or a press, with its index across every group. */
  onChoose: (index: number, option: ComboboxOption) => void;
  /** What an Enter that chooses no option does: one held with Command or Control, or pressed while the list is shut. */
  onEnter?: (() => void) | undefined;
  /** What an Escape does while the list stands: shutting it, as a rule. */
  onEscape?: (() => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  maxLength?: number | undefined;
  /** Whether the system's spell check marks the words. */
  spellCheck?: boolean | undefined;
  /** The chord the caller answers from the field, as `aria-keyshortcuts` names it. */
  keyShortcuts?: string | undefined;
  /** The field itself, for a caller that moves the caret. */
  ref?: Ref<HTMLInputElement> | undefined;
}): React.JSX.Element {
  const listId = useId();
  const options = groups.flatMap((group) => group.options);
  const shown = open && options.length > 0;
  const at = Math.min(Math.max(active, 0), options.length - 1);
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) onChoose(index, option);
  };

  const keys = useComboboxField({
    open: shown,
    active: at,
    count: options.length,
    controls: listId,
    activeId: comboboxOptionId(listId, at),
    onActiveChange,
    onChoose: choose,
    onEnter,
    onEscape,
  });

  return (
    <div className={cn("luke-combobox", COMBOBOX_WELL)} data-open={shown}>
      <input
        ref={ref}
        type="text"
        // Note that the field's foot is square while the list stands, so the two read as one well.
        className={cn("luke-text-field", shown && "rounded-b-none")}
        {...keys.field}
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        spellCheck={spellCheck}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys.onKeyDown}
      />
      {shown ? (
        <ComboboxList
          id={listId}
          label={listLabel}
          groups={groups}
          active={at}
          onActiveChange={onActiveChange}
          onChoose={onChoose}
        />
      ) : null}
    </div>
  );
}
