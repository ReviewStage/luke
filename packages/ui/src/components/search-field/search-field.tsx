import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useImperativeHandle, useRef } from "react";
import { CloseIcon, SearchIcon } from "../../face/glyphs.js";

/**
 * search-field.tsx -- a search: a magnifier, the query its caller holds, and at its end a tally, a chord, or a clear.
 *
 * The field is controlled, as a TextField is: the caller owns the query and
 * answers every change. It stands in a well a control tall, the magnifier
 * leading and the field taking the room left, and every part has a fixed
 * size, so typing, clearing, and focusing never move what stands beneath it.
 * The well rings, not the field, while the caret is in it.
 *
 * Its end holds what the caller gives it. A tally (`tally`) says how many
 * results the query found, and which one is current, in a polite live region,
 * while a query stands; or `trailing` is any words of the caller's. A chord
 * (`shortcut`) says how to summon the field while it is empty and the caret
 * elsewhere. And where the caller can clear the query (`onClear`), a clear
 * button stands at the very end while a query does, handing the caret back.
 *
 * Its keys are the caller's: Enter, Shift-Enter, and Escape each answer
 * their callback where one is given, and never while an input method is
 * composing, whose Enter commits the composition and whose Escape dismisses
 * its candidates. Note that an Escape the caller answers is kept from the
 * surface behind the field even mid-composition, because that surface's own
 * Escape (a dialog's, a pane's) would close it out from under the field.
 */

/** How many results a query found, and which is current, where one is. */
export interface SearchTally {
  readonly count: number;
  /** The current result, from zero, where the caller steps through them. */
  readonly at?: number | undefined;
  /** Whether more matched than `count`, where the caller stopped counting. */
  readonly more?: boolean | undefined;
}

/** What stands at the field's end before its clear: a tally of the caller's results, or words of its own. */
type SearchEnd =
  | { tally?: SearchTally | undefined; trailing?: undefined }
  | { tally?: undefined; trailing?: ReactNode };

/** A tally as it is said: none found, how many, or which of how many. */
function tallyLine(tally: SearchTally): string {
  if (tally.count === 0) return "No results";
  const count = tally.more === true ? `${tally.count}+` : String(tally.count);
  return tally.at === undefined ? `${count} results` : `${tally.at + 1} of ${count}`;
}

/** Whether a key went to an input method composing text rather than to the field. */
function composing(event: KeyboardEvent): boolean {
  // Note that Safari reports the composition's last key with `isComposing`
  // already false, and code 229 still, so both are read.
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/** A search named `label`, holding `value`, answering its keys with the callbacks given. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
  id,
  keyShortcuts,
  shortcut,
  tally,
  trailing,
  onClear,
  onEnter,
  onShiftEnter,
  onEscape,
  ref,
}: SearchEnd & {
  /** The accessible name, which the magnifier says to a sighted reader. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  /** The field's id, for a summons that finds it by one. */
  id?: string | undefined;
  /** The chord that summons the field, as `aria-keyshortcuts` names it. */
  keyShortcuts?: string | undefined;
  /** The chord drawn while the field is empty and the caret elsewhere. */
  shortcut?: ReactNode;
  /** What clearing the query does; a clear button stands while a query does where this is given. */
  onClear?: (() => void) | undefined;
  /** What an Enter does, pressed while no input method is composing. */
  onEnter?: (() => void) | undefined;
  /** What a Shift-Enter does, pressed while no input method is composing. */
  onShiftEnter?: (() => void) | undefined;
  /** What an Escape does, pressed while no input method is composing. */
  onEscape?: (() => void) | undefined;
  /** The field itself, for a caller that moves the caret. */
  ref?: Ref<HTMLInputElement | null> | undefined;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  useImperativeHandle<HTMLInputElement | null, HTMLInputElement | null>(
    ref,
    () => field.current,
    [],
  );
  const empty = value.length === 0;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && onEscape !== undefined) event.stopPropagation();
    if (composing(event)) return;
    if (event.key === "Escape") onEscape?.();
    if (event.key !== "Enter") return;
    const answer = event.shiftKey ? onShiftEnter : onEnter;
    if (answer === undefined) return;
    event.preventDefault();
    answer();
  };

  return (
    <label className="luke-search-field">
      <SearchIcon />
      <input
        ref={field}
        id={id}
        className="luke-search-field-input"
        type="text"
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {tally === undefined || empty ? null : (
        <span className="luke-search-field-tally" aria-live="polite">
          {tallyLine(tally)}
        </span>
      )}
      {trailing}
      {onClear !== undefined && !empty ? (
        <button
          type="button"
          className="luke-search-field-clear"
          aria-label="Clear search"
          onClick={() => {
            onClear();
            field.current?.focus();
          }}
        >
          <CloseIcon />
        </button>
      ) : empty && shortcut !== undefined ? (
        <span className="luke-search-field-shortcut">{shortcut}</span>
      ) : null}
    </label>
  );
}
