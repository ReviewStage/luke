import type { ReactNode } from "react";
import { COMBOBOX_ITEM_GLYPH, COMBOBOX_ITEM_LABEL } from "../../shadcn/combobox.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";

export type MenuNoteRowEnd =
  | { readonly action: string; readonly onClick: () => void }
  | { readonly words: string };

const ROW =
  "ui-menu-note-row -mx-list-inset flex min-h-menu-row min-w-0 items-center gap-icon-gap self-stretch px-row-inset text-start text-body whitespace-nowrap text-foreground";

const END = "ui-menu-note-row-end ml-auto flex min-w-0 flex-[0_1000_auto] items-center";

const WORDS = "py-ui-4 pl-ui-12 text-end text-caption whitespace-normal text-muted-foreground";

export function MenuNoteRow({
  glyph,
  label,
  end,
}: {
  glyph: ReactNode;
  label: string;
  end: MenuNoteRowEnd;
}): React.JSX.Element {
  return (
    <div className={ROW}>
      <span className={COMBOBOX_ITEM_GLYPH} aria-hidden="true">
        {glyph}
      </span>
      <span className={COMBOBOX_ITEM_LABEL}>{label}</span>
      <span className={END}>
        {"action" in end ? (
          <Button variant={BUTTON_VARIANT.QUIET} onClick={end.onClick}>
            {end.action}
          </Button>
        ) : (
          <span className={WORDS}>{end.words}</span>
        )}
      </span>
    </div>
  );
}
