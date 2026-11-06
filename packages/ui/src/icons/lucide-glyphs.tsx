import {
  AudioLines,
  Bold,
  Bot,
  CircleAlert,
  CircleCheck,
  Code,
  Eye,
  EyeOff,
  Heading1,
  Heading2,
  Heading3,
  Inbox,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquare,
  MessageSquarePlus,
  Minus,
  Pin,
  PinOff,
  Plug,
  RotateCw,
  SearchX,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  Type,
  Unlink,
} from "lucide-react";

import { lucideGlyph } from "./lucide-glyph.js";

export const PlugIcon = lucideGlyph(Plug, "settings-icon");

export const PinIcon = lucideGlyph(Pin, "icon-button-glyph");

export const UnpinIcon = lucideGlyph(PinOff, "icon-button-glyph");

export const RetryIcon = lucideGlyph(RotateCw, "icon-button-glyph");

export const AlertIcon = lucideGlyph(CircleAlert, "ui-glyph");

export const NotFoundIcon = lucideGlyph(SearchX, "ui-glyph");

export const CircleCheckIcon = lucideGlyph(CircleCheck, "ui-glyph");

export const InboxIcon = lucideGlyph(Inbox, "ui-glyph");

export const CommentsIcon = lucideGlyph(MessageSquare, "icon-button-glyph");

export const WaveformIcon = lucideGlyph(AudioLines, "icon-button-glyph");

export const AgentPlaceholderIcon = lucideGlyph(Bot, "settings-icon text-muted-foreground");

export const BoldIcon = lucideGlyph(Bold, "icon-button-glyph");

export const ItalicIcon = lucideGlyph(Italic, "icon-button-glyph");

export const StrikethroughIcon = lucideGlyph(Strikethrough, "icon-button-glyph");

export const InlineCodeIcon = lucideGlyph(Code, "icon-button-glyph");

export const LinkIcon = lucideGlyph(Link, "icon-button-glyph");

export const UnlinkIcon = lucideGlyph(Unlink, "icon-button-glyph");

export const TextBlockIcon = lucideGlyph(Type, "icon-button-glyph");

export const Heading1Icon = lucideGlyph(Heading1, "icon-button-glyph");

export const Heading2Icon = lucideGlyph(Heading2, "icon-button-glyph");

export const Heading3Icon = lucideGlyph(Heading3, "icon-button-glyph");

export const BulletedListIcon = lucideGlyph(List, "icon-button-glyph");

export const NumberedListIcon = lucideGlyph(ListOrdered, "icon-button-glyph");

export const TodoListIcon = lucideGlyph(ListChecks, "icon-button-glyph");

export const QuoteIcon = lucideGlyph(TextQuote, "icon-button-glyph");

export const CodeBlockIcon = lucideGlyph(SquareCode, "icon-button-glyph");

export const DividerIcon = lucideGlyph(Minus, "icon-button-glyph");

export const TableIcon = lucideGlyph(Table, "icon-button-glyph");

export const CommentAddIcon = lucideGlyph(MessageSquarePlus, "icon-button-glyph");

export const ShowSecretIcon = lucideGlyph(Eye, "icon-button-glyph");

export const HideSecretIcon = lucideGlyph(EyeOff, "icon-button-glyph");
