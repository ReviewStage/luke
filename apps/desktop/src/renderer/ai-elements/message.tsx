import type { UIMessage } from "ai";
import { type ComponentProps, type HTMLAttributes, memo, type ReactNode } from "react";
import { type Components, Streamdown } from "streamdown";
import { Tooltip } from "../tooltip";
import { cn } from "./utils";

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
 * rule.
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
        "min-w-0 max-w-full space-y-2 overflow-hidden text-[13px] leading-relaxed text-foreground",
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
 * pointer either, so the words under it stay selectable.
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

export type MessageActionProps = Omit<ComponentProps<"button">, "aria-label"> & {
  /** What the action does, which is its accessible name and, when `tooltip` is set, the hint it shows. */
  label: string;
  tooltip?: boolean;
};

/** One action: a 24px ghost button around a 16px icon. */
export function MessageAction({
  label,
  tooltip = false,
  className,
  children,
  ...props
}: MessageActionProps): ReactNode {
  const button = (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "flex size-6 cursor-default items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&>svg]:size-4",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
}

/**
 * Markdown drawn at the panel's own scale. Streamdown's headings and lists
 * are a page's, sized for a document a reader sits down to; a transcript's
 * are a note's, a step above the words around them and no more, and a
 * list keeps to the column's own indent.
 */
export const PANEL_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="mt-3 mb-1 text-[15px] font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1 text-[14px] font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-[13px] font-semibold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 mb-1 text-[13px] font-medium">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 mb-1 text-[13px] font-medium">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 mb-1 text-[13px] font-medium">{children}</h6>,
  ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
  li: ({ children }) => <li className="my-0.5">{children}</li>,
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

/**
 * A reply's markdown, drawn as it streams. Note that it is memoised on every
 * prop rather than on the words alone, as the registry has it, because a
 * mode or a class changed under the same words has to be drawn too.
 */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps): ReactNode => (
    <Streamdown
      className={cn(
        "select-text [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    />
  ),
);

MessageResponse.displayName = "MessageResponse";
