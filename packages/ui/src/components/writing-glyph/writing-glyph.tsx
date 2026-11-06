import {
  WRITING_BLOCK,
  WRITING_INSERT,
  WRITING_MARK,
  type WritingAction,
} from "@repo/settings/shortcuts";
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

export function WritingGlyph({ action }: { action: WritingAction }): React.JSX.Element {
  const Glyph = WRITING_GLYPH[action];
  return <Glyph />;
}
