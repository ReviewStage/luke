import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useId, useLayoutEffect, useRef } from "react";
import { ChevronRightIcon } from "../../face/glyphs.js";

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
 *
 * Options stand in groups, each with an optional heading, and the active
 * option counts across them, so a caller's index is one list's. Each option
 * draws a leading glyph, its name, a detail that gives way first, a hint
 * at its end, such as the chord that chooses it, and a chevron where
 * choosing it opens a further list.
 *
 * The list stands on its own too (`ComboboxList`), for a caller whose words
 * are typed in an editor of its own rather than a field this control owns:
 * the caller reads the keys, steers the active option, and places the list,
 * which draws the options as above, a note where none stands, and keeps
 * every press from taking the caret out of the editor.
 */

/** One option: what it is called, and what is drawn around its name. */
export interface ComboboxOption {
  /** The caller's own key for the option, stable while it stands. */
  readonly id: string;
  readonly label: ReactNode;
  readonly icon?: ReactNode;
  /** Words after the name, quieter, which give way to it in a narrow list. */
  readonly detail?: ReactNode;
  /** At the option's end: the chord that chooses it, or any short mark. */
  readonly hint?: ReactNode;
  /** Whether choosing it opens a further list rather than choosing it, which a chevron at its end says. */
  readonly opens?: boolean | undefined;
}

/** A run of options under a heading, or under none. */
export interface ComboboxGroup {
  /** The heading drawn over the run, which names it to a reader too. */
  readonly label?: string | undefined;
  readonly options: readonly ComboboxOption[];
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** Where the active option moves for a key, among `count`, or undefined for a key that moves none. */
function movedTo(key: string, active: number, count: number): number | undefined {
  if (key === "ArrowDown") return (active + 1) % count;
  if (key === "ArrowUp") return (active - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
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
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the field reads the keys and names this option active.
    <div
      id={id}
      role="option"
      // Note that an option is focusable by a press alone, which the list keeps from taking focus.
      tabIndex={-1}
      className="luke-combobox-option"
      aria-selected={active}
      onMouseMove={active ? undefined : onActive}
      onClick={onChoose}
    >
      {option.icon === undefined ? null : (
        <span className="luke-combobox-option-glyph">{option.icon}</span>
      )}
      <span className="luke-combobox-option-label">{option.label}</span>
      {option.detail === undefined ? null : (
        <span className="luke-combobox-option-detail">{option.detail}</span>
      )}
      {option.hint === undefined ? null : (
        <span className="luke-combobox-option-hint">{option.hint}</span>
      )}
      {option.opens === true ? (
        <span className="luke-combobox-option-end">
          <ChevronRightIcon />
        </span>
      ) : null}
    </div>
  );
}

/** The id of the option at `index` in the list `listId`. */
function optionIdOf(listId: string, index: number): string {
  return `${listId}-option-${index}`;
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
}: {
  /** The listbox's id, which a field names in `aria-controls`; one is minted where none is given. */
  id?: string | undefined;
  /** The list's accessible name, what its options are. */
  label: string;
  groups: readonly ComboboxGroup[];
  /** The active option, from zero across every group. */
  active: number;
  onActiveChange: (active: number) => void;
  /** What a press on an option does, with its index across every group. */
  onChoose: (index: number, option: ComboboxOption) => void;
  /** Whether each group's heading is drawn; a list standing under a title that names its one group draws none, its group still named to a reader. */
  headed?: boolean | undefined;
  /** What the list says where it holds no option; nothing is said where none is given. */
  empty?: string | undefined;
}): React.JSX.Element {
  const minted = useId();
  const listId = id ?? minted;
  const list = useRef<HTMLDivElement>(null);
  const options = groups.flatMap((group) => group.options);
  const at = Math.min(Math.max(active, 0), options.length - 1);
  const choose = (index: number) => {
    const option = options[index];
    if (option !== undefined) onChoose(index, option);
  };

  // Note that the active option is scrolled into the list's own view by
  // hand, because the caret stays where the keys are read, which no
  // browser scrolls the list for, and `scrollIntoView` would scroll every
  // box around it.
  useLayoutEffect(() => {
    const box = list.current;
    const row = at < 0 ? null : document.getElementById(optionIdOf(listId, at));
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
      className="luke-combobox-list"
      role="listbox"
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
    >
      {runs.map(({ group, start }) => {
        const rows = group.options.map((option, index) => (
          <OptionRow
            key={option.id}
            id={optionIdOf(listId, start + index)}
            option={option}
            active={start + index === at}
            onActive={() => onActiveChange(start + index)}
            onChoose={() => choose(start + index)}
          />
        ));
        if (group.label === undefined) return rows;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a listbox's section is a group of options, which a <fieldset> of form controls is not.
          <div key={start} role="group" aria-label={group.label}>
            {headed ? (
              <div className="luke-combobox-heading" aria-hidden="true">
                {group.label}
              </div>
            ) : null}
            {rows}
          </div>
        );
      })}
      {options.length === 0 && empty !== undefined ? (
        <p className="luke-combobox-empty">{empty}</p>
      ) : null}
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

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Note that an Escape an input method is composing with is kept from the
    // surface behind even with the list shut, because it cancels candidates.
    const ime = composing(event);
    if (event.key === "Escape" && (shown || ime)) event.stopPropagation();
    if (ime) return;
    const moved = shown ? movedTo(event.key, at, options.length) : undefined;
    if (moved !== undefined) {
      event.preventDefault();
      onActiveChange(moved);
      return;
    }
    if (shown && event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (shown && !event.metaKey && !event.ctrlKey) choose(at);
    else onEnter?.();
  };

  return (
    <div className="luke-combobox" data-open={shown}>
      <input
        ref={ref}
        type="text"
        className="luke-text-field"
        role="combobox"
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        aria-expanded={shown}
        aria-controls={shown ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={shown ? optionIdOf(listId, at) : undefined}
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        spellCheck={spellCheck}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
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
