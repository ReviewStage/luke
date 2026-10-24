import { useAtomValue } from "@effect/atom-react";
import {
  BUTTON_SIZE,
  cn,
  IconButton,
  MessageFrame,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
} from "@luke/ui";
import {
  MARKDOWN_LOOK,
  Markdown,
  type MarkdownComponents,
  type MarkdownProps,
} from "@luke/ui/markdown";
import { QUOTE_CLASS } from "@luke/ui/quote-face";
import type { UIMessage } from "ai";
import { AsyncResult } from "effect/reactivity";
import { type HTMLAttributes, memo, type ReactNode } from "react";
import { markdownHtmlParserAtom } from "../markdown-html-parser.js";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: the developer's turn stands at the right in a
 * raised bubble, Luke's at the left in plain text across the whole column,
 * as a chat app draws them. The actions on a message are the
 * registry's, each one a quiet icon button in `@luke/ui`'s `MessageActions`,
 * which shows while the pointer or the keyboard is on the message, in the
 * line under it (`MessageLine`), with the window's own
 * hover hint in place of the registry's tooltip. The registry's branches, attachments, and toolbar are
 * not here, because nothing draws them yet; each arrives with the surface
 * that first does.
 *
 * One change of substance from the registry: nothing in a message sets a
 * percentage height. The registry's Response is `size-full`, and in a
 * panel of fixed height, where the log and the messages are flex items of
 * definite size, that `height: 100%` resolved against the message's own
 * column, so every text part asked for the whole column and the parts
 * beside it were shrunk to slivers. The content stacks as blocks here.
 * And one more: the registry's content clips with `overflow-hidden`,
 * which cut the keyboard's ring off every fold, tool line, picture, and chip
 * a reply holds, so it clips past the ring instead (base.css's room).
 */

export type MessageProps = Omit<HTMLAttributes<HTMLDivElement>, "onClick"> & {
  from: UIMessage["role"];
};

/**
 * A turn, `@luke/ui`'s `MessageFrame` in the transcript's skin
 * (`.transcript-message`, tasks.css), whose actions a tap shows on a screen
 * with no hover.
 */
export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <MessageFrame
      revealActionsOnTap
      className={cn("transcript-message", from === "user" ? "is-user" : "is-assistant", className)}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

/** The words of a turn, in `.message-content` (tasks.css): plain across the column, or the developer's raised bubble. */
export function MessageContent({ children, className, ...props }: MessageContentProps): ReactNode {
  return (
    <div className={cn("message-content", className)} {...props}>
      {children}
    </div>
  );
}

export type MessageActionProps = {
  /** What the action does, which is its accessible name and, when `tooltip` is set, the hint it shows. */
  label: string;
  /** Whether it hangs a hint: its label, or the words given here in its place. */
  tooltip?: boolean | string;
  /** A hover card hung in the hint's place, saying more about the action than its label (`@luke/ui`'s `Tooltip`'s `card`). */
  card?: ReactNode;
  onClick: () => void;
  /** Its glyph. */
  children: ReactNode;
};

/** One action: the shared compact glyph button, as a row's marks are. */
export function MessageAction({
  label,
  tooltip = false,
  card,
  onClick,
  children,
}: MessageActionProps): ReactNode {
  const button = (
    <IconButton icon={children} label={label} size={BUTTON_SIZE.COMPACT} onClick={onClick} />
  );
  if (card !== undefined) {
    return (
      <Tooltip label={label} card={card}>
        {button}
      </Tooltip>
    );
  }
  if (tooltip === false) return button;
  return <Tooltip label={tooltip === true ? label : tooltip}>{button}</Tooltip>;
}

/** A message's heading levels, each with the type role that sets it; h4 to h6 take the section role, never a label's, which the web draws smaller than the body. */
const TRANSCRIPT_HEADING = {
  1: TEXT_VARIANT.DIALOG,
  2: TEXT_VARIANT.SECTION,
  3: TEXT_VARIANT.SECTION,
  4: TEXT_VARIANT.SECTION,
  5: TEXT_VARIANT.SECTION,
  6: TEXT_VARIANT.SECTION,
} as const;

/**
 * A heading of a rendered message: its look from the role its level maps to,
 * its spacing from tasks.css, and no heading element. Note that a model's `#`
 * line is words in a conversation, not a part of the window's outline, so it
 * is a paragraph, as a note's headings are (`@luke/ui/markdown`).
 */
function TranscriptHeading({
  level,
  children,
}: {
  level: keyof typeof TRANSCRIPT_HEADING;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.P}
      variant={TRANSCRIPT_HEADING[level]}
      className="transcript-heading"
      data-level={level}
    >
      {children}
    </Text>
  );
}

/**
 * Markdown drawn at the panel's own scale (`@luke/ui/markdown`'s transcript look). Streamdown's headings and lists
 * are a page's, sized for a document a reader sits down to; a transcript's
 * are a note's, a step above the words around them and no more, a
 * list keeps to the column's own indent, and a quote is the one every
 * Markdown in the window draws (`@luke/ui/quote-face`) rather than
 * Streamdown's, which stood the browser's 40px in from the column. A list and
 * a quote are drawn by their class in tasks.css; a heading is `Text`, its role
 * chosen by its level and its spacing by its class.
 */
export const PANEL_MARKDOWN_COMPONENTS: MarkdownComponents = {
  h1: ({ children }) => <TranscriptHeading level={1}>{children}</TranscriptHeading>,
  h2: ({ children }) => <TranscriptHeading level={2}>{children}</TranscriptHeading>,
  h3: ({ children }) => <TranscriptHeading level={3}>{children}</TranscriptHeading>,
  h4: ({ children }) => <TranscriptHeading level={4}>{children}</TranscriptHeading>,
  h5: ({ children }) => <TranscriptHeading level={5}>{children}</TranscriptHeading>,
  h6: ({ children }) => <TranscriptHeading level={6}>{children}</TranscriptHeading>,
  ul: ({ children }) => <ul className="transcript-list">{children}</ul>,
  ol: ({ children }) => <ol className="transcript-list">{children}</ol>,
  li: ({ children }) => <li className="transcript-list-item">{children}</li>,
  blockquote: ({ children }) => <blockquote className={QUOTE_CLASS}>{children}</blockquote>,
};

export type MessageResponseProps = Omit<MarkdownProps, "look" | "className">;

/**
 * A reply's markdown, drawn as it streams, in `.transcript-markdown`
 * (tasks.css). Note that it is memoised on every prop rather than on the
 * words alone, as the registry has it, because a mode changed under the same
 * words has to be drawn too. Nothing is drawn until the HTML parser has
 * landed (`markdown-html-parser.ts`), because a reply drawn without it is not
 * the reply drawn with it.
 */
export const MessageResponse = memo((props: MessageResponseProps): ReactNode => {
  const parser = useAtomValue(markdownHtmlParserAtom);
  if (AsyncResult.isInitial(parser)) return null;
  return <Markdown look={MARKDOWN_LOOK.TRANSCRIPT} className="transcript-markdown" {...props} />;
});

MessageResponse.displayName = "MessageResponse";
