import type { UIMessage } from "ai";
import { type ComponentProps, type HTMLAttributes, memo, type ReactNode } from "react";
import { type Components, Streamdown } from "streamdown";
import { cn } from "./utils";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: the developer's turn stands at the right in a
 * raised bubble, Luke's at the left in plain text across the whole column,
 * as the voice captions draw them. The registry's actions, branches,
 * attachments, and toolbar are not here, because nothing draws them yet;
 * each arrives with the surface that first does.
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
        "group flex w-full flex-col gap-1",
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
        "min-w-0 max-w-full space-y-2 overflow-hidden text-[13px] leading-normal text-foreground",
        "group-[.is-user]:w-fit group-[.is-user]:rounded-xl group-[.is-user]:bg-secondary group-[.is-user]:px-[11px] group-[.is-user]:py-[7px]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
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
