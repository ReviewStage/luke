import { ArrowDownIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "./utils";

/**
 * conversation.tsx -- AI Elements' Conversation: a log of messages that keeps to its newest line while the reader is there.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens. One change of substance: the registry's
 * Conversation scrolls on `use-stick-to-bottom`, which animates the scroll
 * on timings of its own, where docs/DESIGN.md has content land at once and
 * every duration come from a motion token. So the log here follows its
 * newest line on the renderer's own rule (`followsNewest`): it keeps to the
 * bottom while it is scrolled there, and scrolling up to read an earlier
 * line leaves it where it is until the reader scrolls back down, or presses
 * the button that takes them there. The context the children read is the
 * registry's: whether the log is at its bottom, and a way to go there.
 */

/** How far from the bottom, in pixels, the list still counts as following the newest line. */
const FOLLOW_SLACK_PX = 24;

/** Whether a list scrolled this far is at its newest line, so a new line should keep it there. */
export function followsNewest(list: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): boolean {
  return list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_SLACK_PX;
}

interface ConversationScroll {
  readonly isAtBottom: boolean;
  readonly scrollToBottom: () => void;
  /** The scroll box, which `ConversationContent` is. */
  readonly list: RefObject<HTMLDivElement | null>;
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const ConversationContext = createContext<ConversationScroll | undefined>(undefined);

function useConversation(): ConversationScroll {
  const context = useContext(ConversationContext);
  if (context === undefined)
    throw new Error("Conversation components must be used within Conversation");
  return context;
}

export type ConversationProps = ComponentProps<"div">;

export function Conversation({ className, children, ...props }: ConversationProps): ReactNode {
  const list = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [isAtBottom, setAtBottom] = useState(true);
  // Note that this runs after every render, because a line growing a word
  // changes the height as much as a new line does.
  useLayoutEffect(() => {
    const element = list.current;
    if (element !== null && following.current) element.scrollTop = element.scrollHeight;
  });
  const scroll: ConversationScroll = {
    isAtBottom,
    list,
    scrollToBottom: () => {
      following.current = true;
      setAtBottom(true);
      const element = list.current;
      if (element !== null) element.scrollTop = element.scrollHeight;
    },
    onScroll: (event) => {
      following.current = followsNewest(event.currentTarget);
      setAtBottom(following.current);
    },
  };
  return (
    <ConversationContext.Provider value={scroll}>
      <div className={cn("relative flex min-h-0 flex-1 flex-col", className)} {...props}>
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export type ConversationContentProps = ComponentProps<"div">;

/** The scroll box, a log of what follows. */
export function ConversationContent({
  className,
  children,
  ...props
}: ConversationContentProps): ReactNode {
  const { list, onScroll } = useConversation();
  return (
    <div
      ref={list}
      role="log"
      className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 pb-5", className)}
      onScroll={onScroll}
      {...props}
    >
      {children}
    </div>
  );
}

export type ConversationEmptyStateProps = ComponentProps<"div"> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
};

/** What the log says instead of messages: a title and a line, or whatever the caller draws. */
export function ConversationEmptyState({
  className,
  title = "No messages yet",
  description = "Start a conversation to see messages here",
  icon,
  children,
  ...props
}: ConversationEmptyStateProps): ReactNode {
  return (
    <div
      className={cn(
        "m-auto flex max-w-[280px] flex-col items-center justify-center gap-3 p-6 text-center text-[12.5px] leading-normal text-muted-foreground",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          {icon !== undefined ? <div className="text-muted-foreground">{icon}</div> : null}
          <div className="space-y-1">
            <h3 className="m-0 font-medium text-foreground">{title}</h3>
            {description !== "" ? <p className="m-0">{description}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}

export type ConversationScrollButtonProps = ComponentProps<"button">;

/**
 * The way back to the newest line, shown while the reader has scrolled away
 * from it: the window's icon button, floating over the lines on a ground of
 * its own (`.conversation-scroll` in desktop.css).
 */
export function ConversationScrollButton({
  className,
  ...props
}: ConversationScrollButtonProps): ReactNode {
  const { isAtBottom, scrollToBottom } = useConversation();
  if (isAtBottom) return null;
  return (
    <button
      type="button"
      aria-label="Scroll to the newest line"
      className={cn("icon-button conversation-scroll", className)}
      onClick={scrollToBottom}
      {...props}
    >
      <ArrowDownIcon aria-hidden="true" />
    </button>
  );
}
