import {
  cn,
  IconButton,
  SCROLL_FADE,
  ScrollArea,
  type ScrollFade,
  type ScrollFadeInset,
} from "@luke/ui";
import { ArrowDownIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
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
 * The log scrolls in `@luke/ui`'s `ScrollArea`, which fades its edges as
 * the caller asks, and holds its lines in one block of its own inside it
 * (`.conversation-log`), which carries the log's padding. That block is
 * not a flex column. A flex item of a container with a definite height has
 * a definite height of its own once flexed, so a percentage height anywhere
 * inside a message would resolve against the message rather than fall back
 * to its content; a block child keeps the height it draws, whatever is
 * inside it.
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
  // What the last render left observed: the scroll box, and how many lines
  // stood in it ending in which, so a render that changed none of them
  // touches no layout.
  const observed = useRef<{ box: HTMLDivElement; count: number; last: Element | null }>(undefined);
  // A line can grow a word or shrink, a card or a group closed, without the
  // list scrolling or this rendering, so one observer watches the log and
  // its lines: it keeps a log that follows its newest line at its bottom,
  // and puts one back there once nothing is left below to scroll to.
  const [resized] = useState(
    () =>
      new ResizeObserver(() => {
        const element = list.current;
        if (element === null) return;
        if (following.current) {
          element.scrollTop = element.scrollHeight;
          return;
        }
        if (!followsNewest(element)) return;
        following.current = true;
        setAtBottom(true);
      }),
  );
  useEffect(() => () => resized.disconnect(), [resized]);
  // Note that this runs after every render but reads no layout unless the
  // lines changed, because a re-render with the same lines (any app-state
  // patch) has nothing new to scroll to, and a line that grew is the
  // observer's. Observing a box already observed leaves it as it was.
  useLayoutEffect(() => {
    const element = list.current;
    if (element === null) return;
    // The lines stand in the one block inside the area.
    const lines = element.firstElementChild;
    const count = lines?.childElementCount ?? 0;
    const last = lines?.lastElementChild ?? null;
    const held = observed.current;
    if (held?.box === element && held.count === count && held.last === last) return;
    observed.current = { box: element, count, last };
    if (following.current) element.scrollTop = element.scrollHeight;
    resized.observe(element);
    if (lines === null) return;
    resized.observe(lines);
    for (const line of lines.children) resized.observe(line);
  });
  const scrollToBottom = useCallback(() => {
    following.current = true;
    setAtBottom(true);
    const element = list.current;
    if (element !== null) element.scrollTop = element.scrollHeight;
  }, []);
  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    following.current = followsNewest(event.currentTarget);
    setAtBottom(following.current);
  }, []);
  const scroll = useMemo<ConversationScroll>(
    () => ({ isAtBottom, list, scrollToBottom, onScroll }),
    [isAtBottom, scrollToBottom, onScroll],
  );
  return (
    <ConversationContext.Provider value={scroll}>
      <div className={cn("conversation", className)} {...props}>
        {children}
      </div>
    </ConversationContext.Provider>
  );
}

export interface ConversationContentProps {
  /** The pane's own class on the block the lines stand in, which holds the log's padding. */
  className?: string | undefined;
  /** Which of the log's edges fade where lines run past them; both where none is named. */
  fade?: ScrollFade | undefined;
  /** Where its start fade begins: beneath a band stuck at its top, as a call's checkpoint is. */
  fadeInset?: ScrollFadeInset | undefined;
  children?: ReactNode;
}

/** The scroll box, a log of what follows, its lines in one block inside it. */
export function ConversationContent({
  className,
  fade = SCROLL_FADE.BOTH,
  fadeInset,
  children,
}: ConversationContentProps): ReactNode {
  const { list, onScroll } = useConversation();
  return (
    <ScrollArea ref={list} role="log" fade={fade} fadeInset={fadeInset} onScroll={onScroll}>
      <div className={cn("conversation-log", className)}>{children}</div>
    </ScrollArea>
  );
}

/** What the log says instead of messages: a wait, or the line the caller draws, on a wider measure where `wide` says so. */
export function ConversationEmptyState({
  wide = false,
  children,
}: {
  wide?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <div className={cn("conversation-empty", wide && "conversation-empty-wide")}>{children}</div>
  );
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
