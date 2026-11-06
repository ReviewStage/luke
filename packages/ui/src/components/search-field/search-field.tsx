import { countWords, TERM } from "@repo/features/words";
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

export const SEARCH_FIELD_LOOK = {
  WELL: "well",
  MENU: "menu",
} as const;

export type SearchFieldLook = (typeof SEARCH_FIELD_LOOK)[keyof typeof SEARCH_FIELD_LOOK];

const SEARCH_WELL =
  "ui-search-field group/search box-border flex h-control min-w-0 cursor-text items-center gap-icon-gap rounded-control border border-border bg-muted pr-ui-2 pl-search-lead text-muted-foreground transition-[border-color] duration-(--ui-duration-hover) ease-plain [&>svg]:size-control-icon [&>svg]:flex-none";

const SEARCH_LOOK_CLASS = {
  [SEARCH_FIELD_LOOK.WELL]: undefined,
  [SEARCH_FIELD_LOOK.MENU]:
    "h-menu-search rounded-none border-0 border-b bg-transparent px-ui-12 outline-none [&>svg]:size-menu-glyph",
} as const satisfies Record<SearchFieldLook, string | undefined>;

const SEARCH_INPUT =
  "ui-search-field-input h-full flex-1 rounded-none border-0 bg-transparent p-0 outline-none focus:bg-transparent";

const SEARCH_TALLY =
  "ui-search-field-tally flex-none pr-ui-6 text-caption tabular-nums [@container_style(--ui-fold:folded)]:sr-only";

const SEARCH_SHORTCUT =
  "inline-flex flex-none pr-ui-6 group-focus-within/search:hidden [@media(hover:none)_and_(pointer:coarse)]:hidden";

const SEARCH_CLEAR =
  "ui-search-field-clear m-0 inline-flex size-search-clear flex-none not-in-data-[leaving=true]:animate-pop-in cursor-default items-center justify-center rounded-control-compact border-0 bg-transparent p-0 text-muted-foreground transition-[background-color] duration-(--ui-duration-hover) ease-plain hover:bg-fill-selected hover:text-foreground active:bg-fill-pressed not-in-data-[leaving=true]:data-[leaving=true]:animate-pop-out [&>svg]:size-control-icon";

export interface SearchTally {
  readonly count: number;
  readonly at?: number | undefined;
  readonly more?: boolean | undefined;
}

type SearchEnd =
  | { tally?: SearchTally | undefined; trailing?: undefined }
  | { tally?: undefined; trailing?: ReactNode };

function tallyLine(tally: SearchTally): string {
  if (tally.count === 0) return "No results";
  const count = tally.more === true ? `${tally.count}+` : String(tally.count);
  if (tally.at !== undefined) return `${tally.at + 1} of ${count}`;
  return tally.more === true
    ? `${count} ${TERM.RESULT.many}`
    : countWords(tally.count, TERM.RESULT);
}

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
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string | undefined;
  id?: string | undefined;
  keyShortcuts?: string | undefined;
  shortcut?: ReactNode;
  onClear?: (() => void) | undefined;
  onEnter?: (() => void) | undefined;
  onShiftEnter?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  look?: SearchFieldLook | undefined;
  combobox?: ComboboxField | undefined;
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
        autoCorrect="off"
        autoCapitalize="off"
        enterKeyHint="search"
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
