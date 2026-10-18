import { useAtomValue } from "@effect/atom-react";
import { BUTTON_SIZE, cn, IconButton } from "@luke/ui";
import { QUOTE_CLASS } from "@luke/ui/quote-face";
import type { UIMessage } from "ai";
import { AsyncResult } from "effect/reactivity";
import { type ComponentProps, type HTMLAttributes, memo, type ReactNode } from "react";
import { type Components, Streamdown } from "streamdown";
import { markdownHtmlParserAtom } from "../markdown-html-parser";
import { Tooltip } from "../tooltip";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: the developer's turn stands at the right in a
 * raised bubble, Luke's at the left in plain text across the whole column,
 * as the voice captions draw them. The actions on a message are the
 * registry's, each one a quiet icon button that shows while the pointer or
 * the keyboard is on the message, floated to its corner rather than drawn
 * in a row under it, with the window's own hover hint in place of the
 * registry's tooltip. The registry's branches, attachments, and toolbar are
 * not here, because nothing draws them yet; each arrives with the surface
 * that first does.
 *
 * One change of substance from the registry: nothing in a message sets a
 * percentage height. The registry's Response is `size-full`, and in a
 * panel of fixed height, where the log and the messages are flex items of
 * definite size, that `height: 100%` resolved against the message's own
 * column, so every text part asked for the whole column and the parts
 * beside it were shrunk to slivers. The content stacks as blocks here, and
 * `apps/desktop/src/renderer/planning/transcript-layout.test.ts` holds the
 * rule. And one more: the registry's content clips with `overflow-hidden`,
 * which cut the keyboard's ring off every fold, tool line, picture, and chip
 * a reply holds, so it clips past the ring instead (base.css's room).
 */

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <div
      className={cn(
        "group relative flex w-full flex-col gap-1",
        from === "user" ? "is-user ml-auto max-w-[95%] items-end justify-end" : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export function MessageContent({ children, className, ...props }: MessageContentProps): ReactNode {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full space-y-2 overflow-clip [overflow-clip-margin:var(--focus-ring-room)] text-[13px] leading-relaxed text-foreground",
        "group-[.is-user]:w-fit group-[.is-user]:rounded-xl group-[.is-user]:bg-secondary group-[.is-user]:px-[11px] group-[.is-user]:py-[7px]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageActionsProps = ComponentProps<"div">;

/**
 * The actions on a message, shown while the pointer rests on the message
 * or the keyboard is on one of them, and hidden the rest of the time so a
 * transcript of hundreds of lines is not a column of buttons. The registry
 * draws them in a row under the message; here they float at the message's
 * top right corner on a small raised card, as a comment's toolbar does, so
 * a turn takes no room for a bar nobody is looking at and the column keeps
 * one rhythm whether a turn offers actions or not. Hidden, the bar takes no
 * pointer either, so the words under it stay selectable. A sent message
 * sets them back in a line under its bubble, beside who sent it
 * (`agent-tab.tsx`'s `AgentMessage`).
 */
export function MessageActions({ className, children, ...props }: MessageActionsProps): ReactNode {
  return (
    <div
      className={cn(
        "pointer-events-none absolute -top-2 right-0 z-10 flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5 opacity-0 shadow-md transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageActionProps = {
  /** What the action does, which is its accessible name and, when `tooltip` is set, the hint it shows. */
  label: string;
  /** Whether it hangs a hint: its label, or the words given here in its place. */
  tooltip?: boolean | string;
  onClick: () => void;
  /** Its glyph. */
  children: ReactNode;
};

/** One action: the shared compact glyph button, as a row's marks are. */
export function MessageAction({
  label,
  tooltip = false,
  onClick,
  children,
}: MessageActionProps): ReactNode {
  const button = (
    <IconButton icon={children} label={label} size={BUTTON_SIZE.COMPACT} onClick={onClick} />
  );
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
