import { noMatchWords, TERM } from "@repo/features/words";
import { Command } from "cmdk";
import { memo, type ReactNode, type Ref, useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { SearchIcon } from "../../face/glyphs.js";
import { searchHit } from "../../search-score.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { COMBOBOX_HEADING } from "../../shadcn/combobox.js";
import { DialogContent, Dialog as ShadcnDialog } from "../../shadcn/dialog.js";
import {
  COMBOBOX_LIST_HEIGHT,
  ComboboxListBox,
  type ComboboxOption,
  ComboboxOptionItem,
} from "../combobox/combobox.js";
import { useHeldFocus } from "../dialog/held-focus.js";
import { NoteLine } from "../note-line/note-line.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { Tooltip } from "../tooltip/hint.js";

export const COMMAND_FILTER = {
  WORDS: "words",
  NONE: "none",
} as const;

export type CommandFilter = (typeof COMMAND_FILTER)[keyof typeof COMMAND_FILTER];

export interface CommandItem extends ComboboxOption {
  readonly words: string;
  readonly keywords?: readonly string[] | undefined;
  readonly onSelect: () => void;
  readonly replayMasked?: boolean | undefined;
}

export interface CommandGroup {
  readonly id: string;
  readonly label?: string | undefined;
  readonly items: readonly CommandItem[];
  readonly note?: ReactNode;
}

const ROOM =
  "grid-cols-[minmax(0,1fr)] items-start pt-dialog-command-top room-narrow:p-ui-12 room-narrow:pt-[max(var(--ui-space-12),env(safe-area-inset-top,0px))]";

const CARD =
  "w-dialog-command max-h-dialog-command-room gap-0 overflow-clip p-0 focus:outline-none room-narrow:w-full room-narrow:max-h-dialog-command-sheet";

const ROOT = "flex min-h-0 flex-1 flex-col outline-none";

const SEARCH =
  "flex h-touch flex-none items-center gap-icon-gap border-b border-border px-ui-16 text-muted-foreground [&_svg]:size-menu-glyph [&_svg]:flex-none";

const FIELD =
  "h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-sans text-body text-foreground outline-none placeholder:text-muted-foreground";

const BAND = "min-w-0 flex-none border-b border-border px-ui-12 py-ui-8";

const FOOT =
  "flex min-w-0 flex-none items-center gap-ui-16 border-t border-border px-ui-16 py-ui-8 text-caption text-muted-foreground [@media(hover:none)_and_(pointer:coarse)]:hidden";

const NOTE = "px-row-inset pt-ui-4 pb-ui-8 text-caption text-muted-foreground";

const HEADING = cn("block", COMBOBOX_HEADING);

function matching(groups: readonly CommandGroup[], typed: string): readonly CommandGroup[] {
  if (typed === "") return groups;
  return groups.map((group) => ({
    ...group,
    items: group.items
      .map((item) => ({
        item,
        score: searchHit({ label: item.words, keywords: item.keywords }, typed)?.score ?? 0,
      }))
      .filter((scored) => scored.score > 0)
      .sort((first, second) => second.score - first.score)
      .map((scored) => scored.item),
  }));
}

const CommandRow = memo(function CommandRow({
  item,
  unmasked,
}: {
  item: CommandItem;
  unmasked: boolean;
}): React.JSX.Element {
  const marked = (words: ReactNode) =>
    words === undefined ? undefined : (
      <ReplayWords unmasked={unmasked} masked={item.replayMasked}>
        {words}
      </ReplayWords>
    );
  const option =
    unmasked || item.replayMasked === true
      ? {
          ...item,
          label: marked(item.label),
          detail: marked(item.detail),
          detailWords: typeof item.detail === "string" ? item.detail : undefined,
          hint: marked(item.hint),
        }
      : item;
  const row = (
    <Command.Item
      asChild
      value={item.id}
      {...(item.keywords === undefined ? {} : { keywords: [...item.keywords] })}
      disabled={item.disabled === true}
      onSelect={item.onSelect}
      onMouseDown={(event) => event.preventDefault()}
    >
      <ComboboxOptionItem option={option} />
    </Command.Item>
  );
  if (item.card === undefined) return row;
  return (
    <Tooltip label={item.words} card={item.card} cardBeside>
      {row}
    </Tooltip>
  );
});

export function raiseKeyboard(): void {
  const standIn = document.createElement("input");
  standIn.className = "ui-visually-hidden";
  standIn.style.fontSize = "16px";
  standIn.setAttribute("aria-hidden", "true");
  standIn.tabIndex = -1;
  standIn.addEventListener("blur", () => standIn.remove(), { once: true });
  document.body.append(standIn);
  standIn.focus({ preventScroll: true });
}

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  placeholder: string;
  groups: readonly CommandGroup[];
  filter?: CommandFilter | undefined;
  query?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
  selected?: string | undefined;
  onSelectedChange?: ((id: string) => void) | undefined;
  empty?: string | undefined;
  loading?: string | undefined;
  band?: ReactNode;
  foot?: ReactNode;
  inputRef?: Ref<HTMLInputElement> | undefined;
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  replayUnmasked?: boolean | undefined;
  keepMounted?: boolean | undefined;
}

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
  keepMounted = false,
  replayUnmasked = false,
}: CommandDialogProps): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const [drawn, setDrawn] = useState(false);
  useHeldFocus(field, open && drawn);
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
        keepMounted={keepMounted}
        className={CARD}
        aria-label={label}
        initialFocus={field}
        finalFocus={false}
        onKeyDown={(event) => event.stopPropagation()}
        viewport={{
          className: ROOM,
          onClick: (event) => event.stopPropagation(),
        }}
      >
        <Command
          label={label}
          className={ROOT}
          shouldFilter={false}
          {...(selected === undefined ? {} : { value: selected })}
          {...(onSelectedChange === undefined ? {} : { onValueChange: onSelectedChange })}
          loop
          onKeyDown={(event) => {
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
              autoCorrect="off"
              autoCapitalize="off"
              enterKeyHint="search"
              spellCheck={false}
              value={words}
              onValueChange={changeQuery}
            />
          </div>
          {band === undefined ? null : <div className={BAND}>{band}</div>}
          <Command.List asChild label={label}>
            <ComboboxListBox height={COMBOBOX_LIST_HEIGHT.FILL}>
              {loading !== undefined && rows === 0 ? (
                <NoteLine status>
                  <ReplayWords unmasked={replayUnmasked}>{loading}</ReplayWords>
                </NoteLine>
              ) : standing.length === 0 ? (
                <NoteLine>
                  <ReplayWords unmasked={replayUnmasked}>{empty}</ReplayWords>
                </NoteLine>
              ) : null}
              {standing.map((group) => (
                <Command.Group
                  key={group.id}
                  heading={
                    group.label === undefined ? undefined : (
                      <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.GROUP} className={HEADING}>
                        <ReplayWords unmasked={replayUnmasked}>{group.label}</ReplayWords>
                      </Text>
                    )
                  }
                >
                  {group.items.map((item) => (
                    <CommandRow key={item.id} item={item} unmasked={replayUnmasked} />
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
