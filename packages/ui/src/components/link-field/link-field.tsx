import { type Ref, useState } from "react";
import { ExternalIcon, UnlinkIcon } from "../../face/glyphs.js";
import { IconButton } from "../button/button.js";
import { MENU_SURFACE_FLOW, MenuSurface } from "../menu/menu-surface.js";
import { TEXT_FIELD_TYPE, TextField } from "../text-field/text-field.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * link-field.tsx -- the small popover a link is written in over selected words: a field for its address, and Open and Remove beside it where a link is already there.
 *
 * It stands on the menu's surface, laid in a row as a find bar is, and its
 * owner places it under the words, in a box of its own, and shows it. The field takes the caret
 * as it opens, holding the link already there selected, so typing or a
 * paste replaces it. Enter hands the owner the address as it stands
 * (`onApply`), and Escape gives up (`onCancel`); what either does to the
 * words, and where the caret goes after, is the owner's. Open and Remove
 * act on the link that was there when it opened, never on half-typed words.
 */

/** The popover's own words. */
const LINK_FIELD_WORDS = {
  LABEL: "Link",
  PLACEHOLDER: "Paste or type a link",
  OPEN: "Open link",
  REMOVE: "Remove link",
} as const;

/** The link field over words linked to `href`, or none where they are not linked yet. */
export function LinkField({
  href,
  onApply,
  onCancel,
  onOpen,
  onRemove,
  ref,
}: {
  /** The link already on the words, which the field opens holding. */
  href?: string | undefined;
  /** Enter in the field: the address typed, its ends trimmed. */
  onApply: (href: string) => void;
  /** Escape in the field. */
  onCancel: () => void;
  /** Open's press, offered where a link is already there. */
  onOpen?: (() => void) | undefined;
  /** Remove's press, offered where a link is already there. */
  onRemove?: (() => void) | undefined;
  ref?: Ref<HTMLDivElement> | undefined;
}): React.JSX.Element {
  const [typed, setTyped] = useState(href ?? "");
  // Note that a field handed another link starts over from it, so Enter never applies the last one's words to it.
  const [opened, setOpened] = useState(href);
  if (opened !== href) {
    setOpened(href);
    setTyped(href ?? "");
  }
  const linked = href !== undefined;
  return (
    <MenuSurface ref={ref} className="luke-link-field" flow={MENU_SURFACE_FLOW.ROW}>
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
