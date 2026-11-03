import { countWords, TERM } from "@luke/features/words";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useImperativeHandle, useRef } from "react";
import { cn } from "../../cn.js";
import { isComposingKey } from "../../composing-key.js";
import { CloseIcon, SearchIcon } from "../../face/glyphs.js";
import { pulseOnPress } from "../../press-pulse.js";
import { ShadcnInput } from "../../shadcn/input.js";
import { useDisclosure } from "../../use-disclosure.js";
import { ANNOUNCE, useAnnounce } from "../announcer/announcer.js";
import type { ComboboxField } from "../combobox/use-combobox-field.js";

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
 * results the query found, and which one is current, while a query stands,
 * said politely through the window's `Announcer` as it changes, and read in
 * place rather than drawn under an element whose
 * `--luke-fold` is `folded`, so a narrow bar gives the field its room; or
 * `trailing` is any words of the caller's. A chord
 * (`shortcut`) says how to summon the field while it is empty and the caret
 * elsewhere. And where the caller can clear the query (`onClear`), a clear
 * button stands at the very end while a query does, handing the caret back.
 * The clear fades and grows in as the first character arrives and fades and
 * shrinks out once the field is empty again, held through its exit
 * (`useDisclosure`) and out of reach while it leaves; the chord takes the
 * end back once it is gone.
 *
 * Its keys are the caller's: Enter, Shift-Enter, and Escape each answer
 * their callback where one is given, and never while an input method is
 * composing, whose Enter commits the composition and whose Escape dismisses
 * its candidates. Note that an Escape the caller answers is kept from the
 * surface behind the field even mid-composition, because that surface's own
 * Escape (a dialog's, a pane's) would close it out from under the field.
 * A search that steers a list under it while the caret stays in it, as a
 * searchable menu's does, hands over its combobox (`useComboboxField`)
 * instead, whose names the field wears and whose handler hears its keys.
 *
 * It stands as a well of its own, or as the head row of a menu it filters:
 * no edge but a hairline under it, and no ring, since the caret is always
 * in it while the menu stands.
 *
 * Its field is shadcn/ui's input (`../../shadcn/input.tsx`, on Base UI),
 * bare inside the well, which stays a `<label>` so a press anywhere on it
 * hands the caret to the field. Note that shadcn's input group is not used,
 * because its addons take the press by a handler of their own where the
 * label already does, and its button is another component's to vendor. The
 * parts are drawn in Tailwind utilities over the theme's field roles, and
 * the well, its field, and its clear keep the `luke-search-field` names a
 * test finds them by.
 */

/** How a search stands: a well among other controls, or a menu's head row. */
export const SEARCH_FIELD_LOOK = {
  WELL: "well",
  MENU: "menu",
} as const;

export type SearchFieldLook = (typeof SEARCH_FIELD_LOOK)[keyof typeof SEARCH_FIELD_LOOK];

/** The well: a control tall on the hover fill inside a hairline, the magnifier leading at a control's glyph size. */
const SEARCH_WELL =
  "luke-search-field group/search box-border flex h-control min-w-0 cursor-text items-center gap-icon-gap rounded-control border border-border bg-muted pr-luke-2 pl-search-lead text-muted-foreground transition-[border-color] duration-(--luke-duration-hover) ease-plain [&>svg]:size-control-icon [&>svg]:flex-none";

/** Each look's classes over the well's: a menu's head row is a menu row tall, with only a hairline under it and no ring. */
const SEARCH_LOOK_CLASS = {
  [SEARCH_FIELD_LOOK.WELL]: undefined,
  [SEARCH_FIELD_LOOK.MENU]:
    "h-menu-search rounded-none border-0 border-b bg-transparent px-luke-12 outline-none [&>svg]:size-menu-glyph",
} as const satisfies Record<SearchFieldLook, string | undefined>;

/** The field, bare in the well and taking the room left. */
const SEARCH_INPUT =
  "luke-search-field-input h-full flex-1 rounded-none border-0 bg-transparent p-0 outline-none focus:bg-transparent";

/** The tally in a caption's tabular figures, said rather than drawn where the bar is folded. */
const SEARCH_TALLY =
  "luke-search-field-tally flex-none pr-luke-6 text-caption tabular-nums [@container_style(--luke-fold:folded)]:sr-only";

/** The chord, standing until the caret arrives, and never under a finger, which has no key to summon with. */
const SEARCH_SHORTCUT =
  "inline-flex flex-none pr-luke-6 group-focus-within/search:hidden [@media(hover:none)_and_(pointer:coarse)]:hidden";

/**
 * The clear, nested in the well as far inside its edge on every side as from the end; it grows in and shrinks out.
 * Note that it runs neither inside a container that is itself leaving, whose own exit
 * is what it rides, since a utility would outrank that rule.
 */
const SEARCH_CLEAR =
  "luke-search-field-clear m-0 inline-flex size-search-clear flex-none not-in-data-[leaving=true]:animate-pop-in cursor-default items-center justify-center rounded-control-compact border-0 bg-transparent p-0 text-muted-foreground transition-[background-color] duration-(--luke-duration-hover) ease-plain hover:bg-fill-selected hover:text-foreground active:bg-fill-pressed not-in-data-[leaving=true]:data-[leaving=true]:animate-pop-out [&>svg]:size-control-icon";

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
  if (tally.at !== undefined) return `${tally.at + 1} of ${count}`;
  return tally.more === true
    ? `${count} ${TERM.RESULT.many}`
    : countWords(tally.count, TERM.RESULT);
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
  look = SEARCH_FIELD_LOOK.WELL,
  combobox,
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
  look?: SearchFieldLook | undefined;
  /** The list the field steers, whose names it wears and whose handler hears its keys in its own callbacks' place. */
  combobox?: ComboboxField | undefined;
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
  const clear = useDisclosure(onClear !== undefined && !empty);
  const tallied = tally === undefined || empty ? undefined : tallyLine(tally);
  useAnnounce(ANNOUNCE.POLITE, tallied ?? "");

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (combobox !== undefined) {
      combobox.onKeyDown(event);
      return;
    }
    if (event.key === "Escape" && onEscape !== undefined) event.stopPropagation();
    if (isComposingKey(event)) return;
    if (event.key === "Escape") onEscape?.();
    if (event.key !== "Enter") return;
    const answer = event.shiftKey ? onShiftEnter : onEnter;
    if (answer === undefined) return;
    event.preventDefault();
    answer();
  };

  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the well holds its field, shadcn's input, which the rule cannot see is one.
    <label className={cn(SEARCH_WELL, SEARCH_LOOK_CLASS[look])} data-look={look}>
      <SearchIcon />
      <ShadcnInput
        ref={field}
        id={id}
        className={SEARCH_INPUT}
        type="text"
        {...combobox?.field}
        aria-label={label}
        aria-keyshortcuts={keyShortcuts}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {tallied === undefined ? null : <span className={SEARCH_TALLY}>{tallied}</span>}
      {trailing}
      {clear.mounted ? (
        <button
          ref={clear.ref}
          type="button"
          className={SEARCH_CLEAR}
          aria-label="Clear search"
          data-leaving={clear.leaving ? "true" : undefined}
          inert={clear.leaving}
          onClick={pulseOnPress(() => {
            onClear?.();
            field.current?.focus();
          })}
        >
          <CloseIcon />
        </button>
      ) : empty && shortcut !== undefined ? (
        <span className={SEARCH_SHORTCUT}>{shortcut}</span>
      ) : null}
    </label>
  );
}
