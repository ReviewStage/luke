import { cn, IconButton } from "@luke/ui";
import { ArrowDownIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
 *
 * The log itself is a block that scrolls, not a flex column. A flex item
 * of a container with a definite height has a definite height of its own
 * once flexed, so a percentage height anywhere inside a message would
 * resolve against the message rather than fall back to its content; a
 * block child of a scroll box keeps the height it draws, whatever is
 * inside it. `planning/transcript-layout.test.ts` holds the rule.
 */

/** How far from the bottom, in pixels, the list still counts as following the newest line: a rounding's worth, since any wider snapped a reader scrolling up through it back down on the next render. */
const FOLLOW_SLACK_PX = 1;

/** Whether a list scrolled this far is at its newest line, so a new line should keep it there. */
function followsNewest(list: {
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
  // A line can shrink without the list scrolling or this rendering, a card
  // or a group closed, so one observer watches the log and its lines, and
  // puts the log back at its bottom once nothing is left below to scroll to.
  const [resized] = useState(
    () =>
      new ResizeObserver(() => {
        const element = list.current;
        if (element === null || following.current || !followsNewest(element)) return;
        following.current = true;
        setAtBottom(true);
      }),
  );
  useEffect(() => () => resized.disconnect(), [resized]);
  // Note that this runs after every render, because a line growing a word
  // changes the height as much as a new line does. Observing a box already
  // observed leaves it as it was, so a render adds only its new lines.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    if (following.current) element.scrollTop = element.scrollHeight;
    resized.observe(element);
    for (const line of element.children) resized.observe(line);
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
      <div className={cn("conversation", className)} {...props}>
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
      className={cn("conversation-log", className)}
      onScroll={onScroll}
      {...props}
    >
      {children}
    </div>
  );
}

/** What the log says instead of messages: a wait, or the one line the caller draws. */
export function ConversationEmptyState({ children }: { children: ReactNode }): ReactNode {
  return <div className="conversation-empty">{children}</div>;
}

/**
 * The way back to the newest line, shown while the reader has scrolled away
 * from it: the shared icon button, floating over the lines on a ground of
 * its own (`.conversation-scroll` in tasks.css).
 */
export function ConversationScrollButton(): ReactNode {
  const { isAtBottom, scrollToBottom } = useConversation();
  if (isAtBottom) return null;
  return (
    <div className="conversation-scroll">
      <IconButton
        label="Scroll to the newest line"
        icon={<ArrowDownIcon aria-hidden="true" />}
        onClick={scrollToBottom}
      />
    </div>
  );
}
