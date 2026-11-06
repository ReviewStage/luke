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

interface AddMenuButtonProps {
  label: string;
  placeholder: string;
  noMatch: string;
  rows: readonly MenuRow[];
  note?: React.ReactNode | ((close: () => void) => React.ReactNode);
  onOpen?: (() => void) | undefined;
  onPick: (id: string) => void;
  replayUnmasked?: boolean | undefined;
}

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
