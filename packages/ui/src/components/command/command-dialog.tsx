import { noMatchWords, TERM } from "@luke/features/words";
import { Command, defaultFilter } from "cmdk";
import { type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { SearchIcon } from "../../face/glyphs.js";
import { COMBOBOX_LABEL } from "../../shadcn/combobox.js";
import { DialogContent, Dialog as ShadcnDialog } from "../../shadcn/dialog.js";
import {
  COMBOBOX_LIST_HEIGHT,
  ComboboxListBox,
  type ComboboxOption,
  ComboboxOptionItem,
} from "../combobox/combobox.js";
import { useHeldFocus } from "../dialog/held-focus.js";
import { NoteLine } from "../note-line/note-line.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * command-dialog.tsx -- a search field over a list of commands in a card over the dimmed window, found by typing and chosen with the arrows and Return: ⌘K's frame, and every palette's.
 *
 * It is the one place cmdk is drawn, so no caller imports it: the field,
 * the list's keys (↑ and ↓ wrapping, Home and End, Return choosing), and
 * the scoring of typed words are cmdk's, and everything seen is this
 * component's. The rows are narrowed here by that scoring, each group in
 * the caller's order with its rows best first, so a group's note stays
 * after its rows, and stays when none of them match. shadcn/ui's command pattern is the reference: cmdk's root
 * inside shadcn's dialog (`../../shadcn/dialog.tsx`, on Base UI), which
 * traps focus, hears Escape and a press on the dimmed window as asking the
 * dialog away, and hands focus back to whatever held it once it has gone.
 * The card stands high in the window rather than in its middle, so the
 * field stays where it is while the rows under it come and go, and it
 * fades out over `--luke-duration-exit` as it closes, inert while it does,
 * as every dialog does.
 * In a narrow room, a phone's, it is a sheet hung from the top of what is
 * seen rather than a card floating in it: the screen's whole width, its
 * corners rounded only where it ends. Under a finger its foot, whose keys
 * are none to press, is not drawn.
 *
 * Each row is a menu's row (`ComboboxOptionItem`), its lead, its glyph,
 * its name and detail fading where they are cut, its hint (a chord) and its
 * end marks, lit by the `aria-selected` cmdk sets as the arrows or the
 * pointer move; one with a card hangs it beside the row while the pointer
 * rests on it. Rows stand in groups under a heading, each with a note after
 * its rows (a source still reading, or one that failed), and where no row
 * stands the list says so, or says it is reading.
 *
 * A row is matched by its `words`, never its `id`: cmdk writes the id into
 * an attribute, which the session recording does not mask
 * (`packages/panel/src/session-replay.ts`), so an id is the caller's key and
 * never words a reader would see. A caller that ranks its own rows, as ⌘K
 * does, turns the matching off (`COMMAND_FILTER.NONE`) and hands the rows
 * already narrowed. Choosing a row runs its `onSelect` and nothing else:
 * whether the dialog closes, or opens a further list in place, is the
 * caller's. No key pressed in the card goes on to the window.
 */

/** Whether the dialog narrows its rows to the words typed, or shows them as the caller handed them. */
export const COMMAND_FILTER = {
  /** cmdk matches each row's words against the field and ranks what matches. */
  WORDS: "words",
  /** The caller narrows and ranks its rows itself, from the query it is told. */
  NONE: "none",
} as const;

export type CommandFilter = (typeof COMMAND_FILTER)[keyof typeof COMMAND_FILTER];

/** One command: a menu row, the words typing finds it by, and what choosing it does. */
export interface CommandItem extends ComboboxOption {
  /** What typing is matched against: the row's name and any words it is known by. */
  readonly words: string;
  /** Further words that find the row and are never drawn, such as a setting's older name. */
  readonly keywords?: readonly string[] | undefined;
  /** Choosing it, by Return or a press. */
  readonly onSelect: () => void;
}

/** A run of commands under a heading, or under none, and what is said after them. */
export interface CommandGroup {
  /** The caller's own key for the group, stable while it stands. */
  readonly id: string;
  /** The heading over the run, which names it to a reader too. */
  readonly label?: string | undefined;
  readonly items: readonly CommandItem[];
  /** Said after the group's rows: that more are being read, or why they could not be. */
  readonly note?: ReactNode;
}

/** The dimmed window: the card stands a fifth of the way down it rather than in its middle; in a narrow room, against its top and sides. */
const ROOM = "items-start pt-dialog-command-top room-narrow:p-0";

/** The card: the palette's measure, unpadded, its field, band, list, and foot edge to edge; in a narrow room, a sheet across the screen, edged and rounded only along its foot. */
const CARD =
  "w-dialog-command max-h-dialog-command-room gap-0 overflow-clip p-0 focus:outline-none room-narrow:w-full room-narrow:max-h-dialog-command-sheet room-narrow:rounded-t-none room-narrow:border-x-0 room-narrow:border-t-0";

/** cmdk's root: a column that gives way to the card's height, so the list scrolls inside it. */
const ROOT = "flex min-h-0 flex-1 flex-col outline-none";

/** The search row: a magnifier, then the field, over a hairline. */
const SEARCH =
  "flex h-touch flex-none items-center gap-icon-gap border-b border-border px-luke-16 text-muted-foreground [&_svg]:size-menu-glyph [&_svg]:flex-none";

/** The field: borderless and ringless, since it always holds the caret, at the body's size. */
const FIELD =
  "h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body text-foreground outline-none placeholder:text-muted-foreground";

/** A band under the field the caller fills, such as a row of filters. */
const BAND = "min-w-0 flex-none border-b border-border px-luke-12 py-luke-8";

/** The foot the caller fills, such as the keys' hints, in a caption's words; not drawn under a finger, which has no keys to press. */
const FOOT =
  "flex min-w-0 flex-none items-center gap-luke-16 border-t border-border px-luke-16 py-luke-8 text-caption text-muted-foreground [@media(hover:none)_and_(pointer:coarse)]:hidden";

/** A group's note after its rows: a quiet caption at the rows' inset. */
const NOTE = "px-row-inset pt-luke-4 pb-luke-8 text-caption text-muted-foreground";

/** A group's heading, as a list's group heading is drawn. */
const HEADING = cn("block", COMBOBOX_LABEL);

/**
 * How well `words`, and any `keywords` beside them, answer `typed`: 0 where
 * they do not, up to 1 where they are it, by cmdk's own scoring, which every
 * palette ranks by. A caller that ranks its own rows (`COMMAND_FILTER.NONE`)
 * scores them with this, so its order and the dialog's agree.
 */
export function commandScore(
  words: string,
  typed: string,
  keywords?: readonly string[] | undefined,
): number {
  return defaultFilter(words, typed, keywords === undefined ? undefined : [...keywords]);
}

/**
 * The `groups` narrowed to the rows whose words match `typed`, best first
 * within each group, by `commandScore`; every row where nothing is typed.
 * Note that the groups keep the caller's order, each its note.
 */
function matching(groups: readonly CommandGroup[], typed: string): readonly CommandGroup[] {
  if (typed === "") return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items
      .map((item) => ({ item, score: commandScore(item.words, typed, item.keywords) }))
      .filter((scored) => scored.score > 0)
      .sort((first, second) => second.score - first.score)
      .map((scored) => scored.item),
  }));
}

/** One row, handed through cmdk's item, hanging its card beside it where it has one. */
function CommandRow({ item }: { item: CommandItem }): React.JSX.Element {
  const row = (
    <Command.Item
      asChild
      value={item.id}
      {...(item.keywords === undefined ? {} : { keywords: [...item.keywords] })}
      disabled={item.disabled === true}
      onSelect={item.onSelect}
    >
      <ComboboxOptionItem option={item} />
    </Command.Item>
  );
  if (item.card === undefined) return row;
  return (
    <Tooltip label={item.words} card={item.card} cardBeside>
      {row}
    </Tooltip>
  );
}

/** What a command dialog is told: whether it stands, what it lists, and what it says around the list. */
export interface CommandDialogProps {
  open: boolean;
  /** Escape, a press on the dimmed window, or the owner's own close: the owner sets `open`. */
  onOpenChange: (open: boolean) => void;
  /** The card's accessible name, what it is for: "Command palette". */
  label: string;
  /** The field's placeholder, what typing finds. */
  placeholder: string;
  groups: readonly CommandGroup[];
  /** Whether cmdk narrows the rows to the words typed; the caller's own ranking turns it off. */
  filter?: CommandFilter | undefined;
  /** The words typed, where the owner holds them; the dialog holds its own where none are given, cleared each time it opens. */
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  /** The row lit, by its id, where the owner holds it. */
  selected?: string | undefined;
  onSelectedChange?: ((id: string) => void) | undefined;
  /** What the list says where no row stands. */
  empty?: string | undefined;
  /** What the list says while its rows are still read, in place of `empty`: "Reading tasks". */
  loading?: string | undefined;
  /** Drawn under the field, such as a row of filters. */
  band?: ReactNode;
  /** Drawn along the card's foot, such as the keys' hints. */
  foot?: ReactNode;
  /** The field, for an owner that moves the caret or focus back to it. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  /** The owner's own keys, heard before cmdk's, which a key the owner prevents never reaches. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
}

/**
 * The palette: the dimmed window, the card high in it, the field taking
 * focus as it opens, an optional band, the `groups` of rows, and an
 * optional foot. Note that the dialog stays mounted while closed, so it
 * can fade out; Base UI draws its card only while it stands or leaves.
 */
export function CommandDialog({
  open,
  onOpenChange,
  label,
  placeholder,
  groups,
  filter = COMMAND_FILTER.WORDS,
  query,
  onQueryChange,
  selected,
  onSelectedChange,
  empty = noMatchWords(TERM.RESULT),
  loading,
  band,
  foot,
  inputRef,
  onKeyDown,
}: CommandDialogProps): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  // Note that the card stands a render after the dialog opens, because Base UI's portal makes its node first, so the field takes focus once it does.
  const [drawn, setDrawn] = useState(false);
  useHeldFocus(field, open && drawn);
  // What held focus as the palette opened, which takes it back as the palette closes, if it still stands.
  const invoker = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) {
      invoker.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return;
    }
    if (invoker.current?.isConnected) invoker.current.focus({ preventScroll: true });
    invoker.current = null;
  }, [open]);
  const [ownQuery, setOwnQuery] = useState("");
  // Note that the words the dialog holds itself are cleared each time it opens, so a palette opens on every row.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setOwnQuery("");
  }
  const words = query ?? ownQuery;
  const changeQuery = (next: string) => {
    setOwnQuery(next);
    onQueryChange?.(next);
  };
  const shown = filter === COMMAND_FILTER.WORDS ? matching(groups, words.trim()) : groups;
  // Note that a group's note stands whatever is typed, so a source that failed or is still reading is never taken for no match.
  const standing = shown.filter((group) => group.items.length > 0 || group.note !== undefined);
  const rows = groups.reduce((count, group) => count + group.items.length, 0);

  return (
    <ShadcnDialog
      open={open}
      modal="trap-focus"
      onOpenChange={(next) => {
        if (next !== open) onOpenChange(next);
      }}
    >
      <DialogContent
        ref={(node: HTMLDivElement | null) => setDrawn(node !== null)}
        className={CARD}
        aria-label={label}
        initialFocus={field}
        // Note that focus goes back to what opened the palette as it starts to close, not once its fade ends.
        finalFocus={false}
        // Note that no key pressed in the card goes on to the window, as no dialog's does.
        onKeyDown={(event) => event.stopPropagation()}
        viewport={{
          className: ROOM,
          // Note that a press goes no further than the dialog, because the surface that opened it is its parent in React's tree and may take presses of its own.
          onClick: (event) => event.stopPropagation(),
        }}
      >
        <Command
          label={label}
          className={ROOT}
          // Note that the rows are matched here rather than by cmdk, which would hide a group's note with its rows and move rows past it in the page.
          shouldFilter={false}
          {...(selected === undefined ? {} : { value: selected })}
          {...(onSelectedChange === undefined ? {} : { onValueChange: onSelectedChange })}
          loop
          onKeyDown={(event) => {
            // A key an input method is composing with is the method's, not the list's.
            if (event.nativeEvent.isComposing) return;
            onKeyDown?.(event);
          }}
        >
          <div className={SEARCH}>
            <SearchIcon />
            <Command.Input
              ref={(node) => {
                field.current = node;
                if (typeof inputRef === "function") inputRef(node);
                else if (inputRef !== undefined && inputRef !== null) inputRef.current = node;
              }}
              className={FIELD}
              placeholder={placeholder}
              value={words}
              onValueChange={changeQuery}
            />
          </div>
          {band === undefined ? null : <div className={BAND}>{band}</div>}
          <Command.List asChild label={label}>
            <ComboboxListBox height={COMBOBOX_LIST_HEIGHT.FILL}>
              {loading !== undefined && rows === 0 ? (
                <NoteLine status>{loading}</NoteLine>
              ) : standing.length === 0 ? (
                <NoteLine>{empty}</NoteLine>
              ) : null}
              {standing.map((group) => (
                <Command.Group
                  key={group.id}
                  heading={
                    group.label === undefined ? undefined : (
                      <span className={HEADING}>{group.label}</span>
                    )
                  }
                >
                  {group.items.map((item) => (
                    <CommandRow key={item.id} item={item} />
                  ))}
                  {group.note === undefined ? null : <div className={NOTE}>{group.note}</div>}
                </Command.Group>
              ))}
            </ComboboxListBox>
          </Command.List>
          {foot === undefined ? null : <div className={FOOT}>{foot}</div>}
        </Command>
      </DialogContent>
    </ShadcnDialog>
  );
}
