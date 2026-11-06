import { type Ref, useState } from "react";
import { ExternalIcon } from "../../face/glyphs.js";
import { UnlinkIcon } from "../../icons/lucide-glyphs.js";
import { IconButton } from "../button/button.js";
import { MENU_SURFACE_FLOW, MenuSurface } from "../menu/menu-surface.js";
import { TEXT_FIELD_TYPE, TextField } from "../text-field/text-field.js";
import { Tooltip } from "../tooltip/hint.js";

const LINK_FIELD_WORDS = {
  LABEL: "Link",
  PLACEHOLDER: "Paste or type a link",
  OPEN: "Open link",
  REMOVE: "Remove link",
} as const;

export function LinkField({
  href,
  onApply,
  onCancel,
  onOpen,
  onRemove,
  ref,
}: {
  href?: string | undefined;
  onApply: (href: string) => void;
  onCancel: () => void;
  onOpen?: (() => void) | undefined;
  onRemove?: (() => void) | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const [typed, setTyped] = useState(href ?? "");
  const [opened, setOpened] = useState(href);
  if (opened !== href) {
    setOpened(href);
    setTyped(href ?? "");
  }
  const linked = href !== undefined;
  return (
    <MenuSurface ref={ref} className="ui-link-field" flow={MENU_SURFACE_FLOW.ROW}>
      <TextField
        label={LINK_FIELD_WORDS.LABEL}
        type={TEXT_FIELD_TYPE.URL}
        placeholder={LINK_FIELD_WORDS.PLACEHOLDER}
        value={typed}
        onChange={setTyped}
        autoFocus
        selectOnFocus
        autoCorrect={false}
        onEnter={() => onApply(typed.trim())}
        onEscape={onCancel}
      />
      {linked && onOpen !== undefined ? (
        <Tooltip label={LINK_FIELD_WORDS.OPEN}>
          <IconButton icon={<ExternalIcon />} label={LINK_FIELD_WORDS.OPEN} onClick={onOpen} />
        </Tooltip>
      ) : null}
      {linked && onRemove !== undefined ? (
        <Tooltip label={LINK_FIELD_WORDS.REMOVE}>
          <IconButton icon={<UnlinkIcon />} label={LINK_FIELD_WORDS.REMOVE} onClick={onRemove} />
        </Tooltip>
      ) : null}
    </MenuSurface>
  );
}
