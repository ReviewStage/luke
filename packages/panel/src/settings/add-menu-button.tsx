import {
  BUTTON_VARIANT,
  Button,
  type MenuRow,
  POPOVER_ALIGN,
  POPOVER_WIDTH,
  SearchableMenu,
} from "@repo/ui";
import { PlusIcon } from "@repo/ui/icons";
import { useDisclosure } from "@repo/ui/use-disclosure";
import { useId, useRef, useState } from "react";

/**
 * add-menu-button.tsx -- a Settings row's Add press that picks what to add from the app's searched menu: GitHub's Add repository, the Slack bot's Add channel.
 *
 * The outline `Button` with its plus, and under it `@repo/ui`'s
 * `SearchableMenu` hung from its end at a Settings picker's width. The menu
 * reads what it lists as it opens (`onOpen`), so a list that failed is asked
 * for again; it closes on a pick, on Escape, and on focus leaving it, and a
 * close hands the keyboard back to the button, as a picker's chip takes it.
 */

/** What the press is handed: its words, the menu's rows or what stands in their place, and what a pick does. */
interface AddMenuButtonProps {
  /** The press's words, which name the menu too. */
  label: string;
  placeholder: string;
  noMatch: string;
  rows: readonly MenuRow[];
  /** Drawn in place of the rows while they are read, could not be, or are none; handed the menu's close where it holds a link that leaves. */
  note?: React.ReactNode | ((close: () => void) => React.ReactNode);
  onOpen?: (() => void) | undefined;
  onPick: (id: string) => void;
  /** Whether its menu's words are the app's own, which a screen recording shows as they read, but for a row that is `replayMasked` (`SearchableMenu`'s `replayUnmasked`). */
  replayUnmasked?: boolean | undefined;
}

/** The Add press and its menu, as above. */
export function AddMenuButton({
  label,
  placeholder,
  noMatch,
  rows,
  note,
  onOpen,
  onPick,
  replayUnmasked,
}: AddMenuButtonProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const drawn = useDisclosure(open);
  const menuId = useId();
  const holder = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span
      className="settings-picker relative inline-flex min-w-0 flex-initial items-center"
      ref={holder}
    >
      <Button
        ref={button}
        variant={BUTTON_VARIANT.OUTLINE}
        icon={<PlusIcon aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {label}
      </Button>
      {drawn.mounted ? (
        <SearchableMenu
          leaving={drawn.leaving}
          ref={drawn.ref}
          id={menuId}
          label={label}
          placeholder={placeholder}
          rows={rows}
          value={undefined}
          note={typeof note === "function" ? note(close) : note}
          noMatch={noMatch}
          align={POPOVER_ALIGN.END}
          width={POPOVER_WIDTH.NARROW}
          replayUnmasked={replayUnmasked}
          onPick={(id) => {
            close();
            onPick(id);
          }}
          onClose={close}
          onLeave={(left) => {
            if (!(left instanceof Node && holder.current?.contains(left))) setOpen(false);
          }}
        />
      ) : null}
    </span>
  );
}
