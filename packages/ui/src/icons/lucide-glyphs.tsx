import {
  AudioLines,
  Bold,
  CircleAlert,
  CircleCheck,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Inbox,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MessageSquare,
  MessageSquarePlus,
  Pin,
  PinOff,
  Plug,
  RotateCw,
  SquareCode,
  Strikethrough,
  Table,
  TextQuote,
  Type,
  Unlink,
} from "lucide-react";

import { lucideGlyph } from "./lucide-glyph.js";

/**
 * lucide-glyphs.tsx -- the glyphs `glyphs.tsx` once drew as copies of
 * Lucide's, now Lucide's own, under the names their call sites already import.
 *
 * Twenty-four were Lucide's paths redrawn in our stroke and three were
 * Tabler's (the plug and both pins), each beside a Lucide glyph of the same
 * meaning. They are Lucide's drawing now, in our stroke (`lucide-glyph.tsx`),
 * so there is one drawing of each. A name here goes when the last screen that
 * imports it draws the glyph through `GLYPH` instead.
 */

/** Two halves of a plug joined, for the services an account connects: Settings' Integrations page. */
export const PlugIcon = lucideGlyph(Plug, "settings-icon");

/** A push pin: keeps a task at the head of the sidebar. */
export const PinIcon = lucideGlyph(Pin, "icon-button-glyph");

/** The pin struck through: lets a pinned task back among the rest. */
export const UnpinIcon = lucideGlyph(PinOff, "icon-button-glyph");

/** An arrow turning round to where it began: tries again what did not land. */
export const RetryIcon = lucideGlyph(RotateCw, "icon-button-glyph");

/** A ring round a mark of exclamation: something did not land. */
export const AlertIcon = lucideGlyph(CircleAlert, "luke-glyph");

/** A ring round a check: something was done. */
export const CircleCheckIcon = lucideGlyph(CircleCheck, "luke-glyph");

/** An in-tray: something was posted to the Inbox. */
export const InboxIcon = lucideGlyph(Inbox, "luke-glyph");

/** A speech bubble, for a plan's comments: the side panel's Comments tab and the summary's row. */
export const CommentsIcon = lucideGlyph(MessageSquare, "icon-button-glyph");

/** A sound wave's bars: a call into an agent, which starts one where none is up. */
export const WaveformIcon = lucideGlyph(AudioLines, "icon-button-glyph");

/*
 * The writing glyphs: what the format toolbar, Turn into, and the `/` menu
 * draw for each mark and block, the same set the pull request box's toolbar
 * draws.
 */

/** Bold words. */
export const BoldIcon = lucideGlyph(Bold, "icon-button-glyph");

/** Italic words. */
export const ItalicIcon = lucideGlyph(Italic, "icon-button-glyph");

/** Words struck through. */
export const StrikethroughIcon = lucideGlyph(Strikethrough, "icon-button-glyph");

/** Code among words, two angle brackets. */
export const InlineCodeIcon = lucideGlyph(Code, "icon-button-glyph");

/** Two links of a chain: a link on words. */
export const LinkIcon = lucideGlyph(Link, "icon-button-glyph");

/** The chain broken: a link taken off words. */
export const UnlinkIcon = lucideGlyph(Unlink, "icon-button-glyph");

/** A line of plain text. */
export const TextBlockIcon = lucideGlyph(Type, "icon-button-glyph");

/** A first-level heading. */
export const Heading1Icon = lucideGlyph(Heading1, "icon-button-glyph");

/** A second-level heading. */
export const Heading2Icon = lucideGlyph(Heading2, "icon-button-glyph");

/** A third-level heading. */
export const Heading3Icon = lucideGlyph(Heading3, "icon-button-glyph");

/** A bulleted list. */
export const BulletedListIcon = lucideGlyph(List, "icon-button-glyph");

/** A numbered list. */
export const NumberedListIcon = lucideGlyph(ListOrdered, "icon-button-glyph");

/** A list of things to do, each ticked. */
export const TodoListIcon = lucideGlyph(ListChecks, "icon-button-glyph");

/** Quoted words under a bar. */
export const QuoteIcon = lucideGlyph(TextQuote, "icon-button-glyph");

/** A block of code, brackets in a frame. */
export const CodeBlockIcon = lucideGlyph(SquareCode, "icon-button-glyph");

/** A rule across the page between blocks. */
export const DividerIcon = lucideGlyph(Minus, "icon-button-glyph");

/** A grid of cells under a header row: a table laid into a document. */
export const TableIcon = lucideGlyph(Table, "icon-button-glyph");

/** A speech bubble with a plus: a comment begun on words. */
export const CommentAddIcon = lucideGlyph(MessageSquarePlus, "icon-button-glyph");
