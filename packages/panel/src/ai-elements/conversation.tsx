import {
  cn,
  Fill,
  IconButton,
  SCROLL_FADE,
  ScrollArea,
  type ScrollFade,
  type ScrollFadeInset,
  Tooltip,
} from "@luke/ui";
import { VIRTUAL_ROWS_ATTRIBUTE, VirtualRows, type VirtualRowsHandle } from "@luke/ui/virtual-rows";
import { ArrowDownIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
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
 * inside it. A long log hands its lines to `ConversationRows`, which draws
 * only those near the view and keeps the reader's place itself as lines
 * land before the first, so the log leaves that to it.
 */

/** How far from the bottom, in pixels, the list still counts as following the newest line: a rounding's worth, since any wider snapped a reader scrolling up through it back down on the next render. */
const FOLLOW_SLACK_PX = 1;

/** How near its top, in screens of the box, a log asks for the lines older than its first (`onNearTop`): one, so they land before the reader reaches them. */
const NEAR_TOP_SCREENS = 1;

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
  /** Whether the log follows its newest line now, read as it is asked rather than as last drawn. */
  readonly following: () => boolean;
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
  /** Hears a press inside the log, a fold's among them. */
  readonly onFold: (event: MouseEvent<HTMLDivElement>) => void;
}

const ConversationContext = createContext<ConversationScroll | undefined>(undefined);

function useConversation(): ConversationScroll {
  const context = useContext(ConversationContext);
  if (context === undefined)
    throw new Error("Conversation components must be used within Conversation");
  return context;
}

export type ConversationProps = ComponentProps<"div"> & {
  /** What the log is of, such as an Inbox item: a new one opens the log at its newest line again, as a log drawn anew opens. */
  subject?: string | undefined;
  /** The scroll box's ref, where the caller reads the box too; one of the log's own where none is handed. */
  list?: RefObject<HTMLDivElement | null> | undefined;
  /**
   * Asked for the lines older than its first, once the reader nears its top
   * or its lines do not fill it; none where no older lines stand. Lines put
   * before the first keep the reader's place.
   */
  onNearTop?: (() => void) | undefined;
};

export function Conversation({
  className,
  children,
  subject,
  list: handed,
  onNearTop,
  ...props
}: ConversationProps): ReactNode {
  const own = useRef<HTMLDivElement>(null);
  const list = handed ?? own;
  const following = useRef(true);
  const [isAtBottom, setAtBottom] = useState(true);
  const opened = useRef(subject);
  // Where the log last stood, its own writes among it, so a scroll is read as the reader's up or down from there.
  const lastTop = useRef(0);
  const toEnd = useCallback((element: HTMLDivElement) => {
    element.scrollTop = element.scrollHeight;
    lastTop.current = element.scrollTop;
  }, []);
  // What the last render left observed: the scroll box, and how many lines
  // stood in it ending in which, so a render that changed none of them
  // touches no layout.
  const observed = useRef<{
    box: HTMLDivElement;
    count: number;
    first: HTMLElement | null;
    last: Element | null;
    /** The rows a virtualized run holds (`VIRTUAL_ROWS_ATTRIBUTE`), where the log's lines are one; none otherwise. */
    rows: string | null;
  }>(undefined);
  // Where the first line stood from the top of the box as the reader last
  // left it, so lines put before it keep it where it was: measured here
  // rather than left to the browser's scroll anchoring, which anchors on
  // nothing at the very top, where older lines are asked for.
  const firstFromTop = useRef(0);
  const nearTop = useRef(onNearTop);
  nearTop.current = onNearTop;
  /** Asks for older lines where the reader is near the top, or the lines do not fill the box. */
  const askOlder = useCallback((element: HTMLDivElement) => {
    if (element.scrollTop <= element.clientHeight * NEAR_TOP_SCREENS) nearTop.current?.();
  }, []);
  // A line can grow a word or shrink, a card or a group closed, without the
  // list scrolling or this rendering, so one observer watches the scroll box
  // and the block its lines stand in: it keeps a log that follows its newest
  // line at its bottom, and puts one back there once nothing is left below
  // to scroll to. Note that it watches no line of its own, because the block
  // is as tall as its lines, so any line resizing resizes it, and a line
  // replaced or removed is then never held by the observer.
  const [resized] = useState(
    () =>
      new ResizeObserver(() => {
        const element = list.current;
        if (element === null) return;
        if (following.current) {
          toEnd(element);
          return;
        }
        if (!followsNewest(element)) {
          setAtBottom(false);
          return;
        }
        following.current = true;
        setAtBottom(true);
      }),
  );
  useEffect(() => () => resized.disconnect(), [resized]);
  // Note that a new subject reuses the box, scrolled wherever the reader
  // left the last, so it is taken to its newest line here, before the paint,
  // even where its lines happen to number and end as the last subject's did.
  useLayoutEffect(() => {
    if (opened.current === subject) return;
    opened.current = subject;
    following.current = true;
    setAtBottom(true);
    const element = list.current;
    if (element !== null) toEnd(element);
  }, [subject, list, toEnd]);
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
    const first = lines?.firstElementChild instanceof HTMLElement ? lines.firstElementChild : null;
    const last = lines?.lastElementChild ?? null;
    // A virtualized run (`@luke/ui/virtual-rows`) says on its block which rows it holds, and keeps the reader's place itself as rows land before them.
    const rows = first?.getAttribute(VIRTUAL_ROWS_ATTRIBUTE) ?? null;
    const held = observed.current;
    if (
      held?.box === element &&
      held.count === count &&
      held.first === first &&
      held.last === last &&
      held.rows === rows
    ) {
      return;
    }
    observed.current = { box: element, count, first, last, rows };
    if (following.current) {
      toEnd(element);
    } else if (
      rows === null &&
      held?.box === element &&
      held.first !== first &&
      held.first?.isConnected === true
    ) {
      // Lines put before the first: the line that was first goes back where the reader left it.
      element.scrollTop = held.first.offsetTop - firstFromTop.current;
      lastTop.current = element.scrollTop;
    }
    if (first !== null) firstFromTop.current = first.offsetTop - element.scrollTop;
    resized.observe(element);
    if (lines !== null) resized.observe(lines);
    askOlder(element);
  });
  const scrollToBottom = useCallback(() => {
    following.current = true;
    setAtBottom(true);
    const element = list.current;
    if (element !== null) toEnd(element);
  }, [list, toEnd]);
  // Note that a scroll down short of the end, or one that moved nothing,
  // leaves a following log following, because only the reader scrolling up
  // takes it off its newest line: the browser shifts a log down of its own accord to hold its place
  // as lines above grow (scroll anchoring), a message's words drawn late
  // among them, and the observer then takes it the rest of the way down.
  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const down = element.scrollTop >= lastTop.current;
      lastTop.current = element.scrollTop;
      following.current = followsNewest(element) || (following.current && down);
      setAtBottom(following.current);
      const first = observed.current?.first;
      if (first !== null && first !== undefined) {
        firstFromTop.current = first.offsetTop - element.scrollTop;
      }
      if (!down) askOlder(element);
    },
    [askOlder],
  );
  // Note that a fold the reader opens or closes takes the log off its newest line, because what they opened grows under them, and following would scroll it, and every line above it, out from under the press.
  const onFold = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element) || event.target.closest("summary") === null) return;
    following.current = false;
  }, []);
  const follows = useCallback(() => following.current, []);
  const scroll = useMemo<ConversationScroll>(
    () => ({ isAtBottom, list, following: follows, scrollToBottom, onScroll, onFold }),
    [isAtBottom, list, follows, scrollToBottom, onScroll, onFold],
  );
  return (
    <ConversationContext.Provider value={scroll}>
      <Fill className={cn("conversation relative", className)} {...props}>
        {children}
      </Fill>
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
  /**
   * Whether its lines are written as they stream in, as an agent's reply is,
   * so the log is no live region: a reader would hear each chunk as it
   * landed, and its owner says the line once it is whole instead.
   */
  streams?: boolean | undefined;
  children?: ReactNode;
}

/** The scroll box, a log of what follows, its lines in one block inside it. */
export function ConversationContent({
  className,
  fade = SCROLL_FADE.BOTH,
  fadeInset,
  streams = false,
  children,
}: ConversationContentProps): ReactNode {
  const { list, onScroll, onFold } = useConversation();
  return (
    <ScrollArea
      ref={list}
      role="log"
      aria-live={streams ? "off" : undefined}
      fade={fade}
      fadeInset={fadeInset}
      onScroll={onScroll}
      onClickCapture={onFold}
    >
      <div
        className={cn(
          "conversation-log px-content-inset pt-section-gap pb-luke-20",
          className,
        )}
      >
        {children}
      </div>
    </ScrollArea>
  );
}

/**
 * A long run of the log's lines drawn only near the view
 * (`@luke/ui/virtual-rows`), in the log's own scroll box, as one line of
 * the log: lines after it, a working line's, stand after the run. The log
 * goes on following its newest line as it does, the run leaving it at its
 * end while it does, and the run keeps the reader's place as lines land
 * before its first.
 */
export function ConversationRows({
  keys,
  estimate,
  gap,
  rowClassName,
  handle,
  children,
}: {
  keys: readonly string[];
  /** The height a line is taken to have before it is drawn, in pixels. */
  estimate: number;
  /** The room between two lines, in pixels. */
  gap: number;
  rowClassName?: string | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  children: (index: number) => ReactNode;
}): ReactNode {
  const { list, following } = useConversation();
  return (
    <VirtualRows
      scroller={list}
      pinned={following}
      keys={keys}
      estimate={estimate}
      gap={gap}
      rowClassName={rowClassName}
      handle={handle}
    >
      {children}
    </VirtualRows>
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
    <div
      className={cn(
        "m-auto flex max-w-conversation-empty flex-col items-center justify-center gap-block-gap p-card text-center text-body text-muted-foreground",
        wide && "max-w-conversation-empty-wide",
      )}
    >
      {children}
    </div>
  );
}

/**
 * What floats over a log in a slot of its own, centred across it, on a
 * ground of its own ringed and lifted off the lines: the way back to the
 * newest line over its foot, and the line saying earlier lines could not be
 * read over its top, so neither moves a row of the log as it comes and goes.
 */
export const FLOATING_OVER_LOG_CLASS =
  "absolute left-1/2 -translate-x-1/2 rounded-control shadow-floating-edge";

/** What the way back to the newest line is called, as its hint and its name. */
const SCROLL_LABEL = "Scroll to the newest line";

/**
 * The way back to the newest line, shown while the reader has scrolled away
 * from it: the shared icon button, floating over the lines on a ground of
 * its own (`.conversation-scroll` in tasks.css).
 */
export function ConversationScrollButton(): ReactNode {
  const { isAtBottom, scrollToBottom } = useConversation();
  if (isAtBottom) return null;
  return (
    // Its ground is the button's own (`--luke-button-ground`), which the button's lit fill is laid over as a title bar's is.
    <div
      className={`conversation-scroll ${FLOATING_OVER_LOG_CLASS} bottom-luke-16 flex bg-button-ground [--luke-button-ground:var(--luke-color-well)]`}
    >
      <Tooltip label={SCROLL_LABEL}>
        <IconButton
          label={SCROLL_LABEL}
          icon={<ArrowDownIcon aria-hidden="true" />}
          onClick={scrollToBottom}
        />
      </Tooltip>
    </div>
  );
}
