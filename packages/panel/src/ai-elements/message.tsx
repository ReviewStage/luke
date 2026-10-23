import { useAtomValue } from "@effect/atom-react";
import { BUTTON_SIZE, cn, IconButton, MessageFrame, Tooltip } from "@luke/ui";
import { QUOTE_CLASS } from "@luke/ui/quote-face";
import type { UIMessage } from "ai";
import { AsyncResult } from "effect/reactivity";
import { type ComponentProps, type HTMLAttributes, memo, type ReactNode } from "react";
import { type Components, Streamdown } from "streamdown";
import { markdownHtmlParserAtom } from "../markdown-html-parser.js";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: the developer's turn stands at the right in a
 * raised bubble, Luke's at the left in plain text across the whole column,
 * as a chat app draws them. The actions on a message are the
 * registry's, each one a quiet icon button in `@luke/ui`'s `MessageActions`,
 * which shows while the pointer or the keyboard is on the message, floated
 * to its corner rather than drawn in a row under it, with the window's own
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

/**
 * Markdown drawn at the panel's own scale. Streamdown's headings and lists
 * are a page's, sized for a document a reader sits down to; a transcript's
 * are a note's, a step above the words around them and no more, a
 * list keeps to the column's own indent, and a quote is the one every
 * Markdown in the window draws (`@luke/ui/quote-face`) rather than
 * Streamdown's, which stood the browser's 40px in from the column. Each is
 * drawn by its class in tasks.css, a heading by its level.
 */
export const PANEL_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="transcript-heading" data-level={1}>
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="transcript-heading" data-level={2}>
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="transcript-heading" data-level={3}>
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="transcript-heading" data-level={4}>
      {children}
    </h4>
  ),
  h5: ({ children }) => (
    <h5 className="transcript-heading" data-level={5}>
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="transcript-heading" data-level={6}>
      {children}
    </h6>
  ),
  ul: ({ children }) => <ul className="transcript-list">{children}</ul>,
  ol: ({ children }) => <ol className="transcript-list">{children}</ol>,
  li: ({ children }) => <li className="transcript-list-item">{children}</li>,
  blockquote: ({ children }) => <blockquote className={QUOTE_CLASS}>{children}</blockquote>,
};

export type MessageResponseProps = Omit<ComponentProps<typeof Streamdown>, "className">;

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
  return <Streamdown className="transcript-markdown" {...props} />;
});

MessageResponse.displayName = "MessageResponse";
