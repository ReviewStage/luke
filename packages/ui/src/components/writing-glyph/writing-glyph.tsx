import {
  WRITING_BLOCK,
  WRITING_INSERT,
  WRITING_MARK,
  type WritingAction,
} from "@luke/settings/shortcuts";
import {
  BoldIcon,
  BulletedListIcon,
  CodeBlockIcon,
  DividerIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  InlineCodeIcon,
  ItalicIcon,
  LinkIcon,
  NumberedListIcon,
  QuoteIcon,
  StrikethroughIcon,
  TextBlockIcon,
  TodoListIcon,
} from "../../icons/lucide-glyphs.js";

/**
 * writing-glyph.tsx -- the glyph of each writing action, a mark or a block, as the format toolbar, Turn into, and the `/` menu all draw it.
 *
 * The vocabulary names each action's words and chord
 * (`@luke/settings/shortcuts`' `WRITING_SHORTCUTS`); this names its glyph,
 * once, so every surface that offers an action shows it alike.
 */

/** Each writing action's glyph. */
const WRITING_GLYPH = {
  [WRITING_MARK.BOLD]: BoldIcon,
  [WRITING_MARK.ITALIC]: ItalicIcon,
  [WRITING_MARK.STRIKE]: StrikethroughIcon,
  [WRITING_MARK.CODE]: InlineCodeIcon,
  [WRITING_MARK.LINK]: LinkIcon,
  [WRITING_BLOCK.TEXT]: TextBlockIcon,
  [WRITING_BLOCK.HEADING_1]: Heading1Icon,
  [WRITING_BLOCK.HEADING_2]: Heading2Icon,
  [WRITING_BLOCK.HEADING_3]: Heading3Icon,
  [WRITING_BLOCK.BULLETED_LIST]: BulletedListIcon,
  [WRITING_BLOCK.NUMBERED_LIST]: NumberedListIcon,
  [WRITING_BLOCK.TODO_LIST]: TodoListIcon,
  [WRITING_BLOCK.QUOTE]: QuoteIcon,
  [WRITING_BLOCK.CODE_BLOCK]: CodeBlockIcon,
  [WRITING_INSERT.DIVIDER]: DividerIcon,
} as const satisfies Record<WritingAction, () => React.JSX.Element>;

/** The glyph `action` is drawn with wherever it is offered. */
export function WritingGlyph({ action }: { action: WritingAction }): React.JSX.Element {
  const Glyph = WRITING_GLYPH[action];
  return <Glyph />;
}
