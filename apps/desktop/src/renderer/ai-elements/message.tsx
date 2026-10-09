import type { UIMessage } from "ai";
import { type ComponentProps, type HTMLAttributes, memo, type ReactNode } from "react";
import { Streamdown } from "streamdown";
import { cn } from "./utils";

/**
 * message.tsx -- AI Elements' Message: one turn of a conversation, by who said it, and the markdown of a reply.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: the developer's turn stands at the right in a
 * raised bubble, Luke's at the left in plain text, as the voice captions
 * draw them. The registry's actions, branches, attachments, and toolbar are
 * not here, because nothing draws them yet; each arrives with the surface
 * that first does.
 */

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export function Message({ className, from, ...props }: MessageProps): ReactNode {
  return (
    <div
      className={cn(
        "group flex w-full max-w-[95%] flex-col gap-1",
        from === "user" ? "is-user ml-auto items-end justify-end" : "is-assistant",
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
        "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-[13px] leading-normal",
        "group-[.is-user]:ml-auto group-[.is-user]:rounded-xl group-[.is-user]:bg-secondary group-[.is-user]:px-[11px] group-[.is-user]:py-[7px] group-[.is-user]:text-foreground",
        "group-[.is-assistant]:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

/** A reply's markdown, drawn as it streams; redrawn only when its words change. */
export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps): ReactNode => (
    <Streamdown
      className={cn(
        "size-full select-text [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    />
  ),
  (previous, next) => previous.children === next.children,
);

MessageResponse.displayName = "MessageResponse";
