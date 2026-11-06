import {
  cn,
  Fill,
  IconButton,
  SCROLL_FADE,
  ScrollArea,
  type ScrollFade,
  type ScrollFadeInset,
  Tooltip,
} from "@repo/ui";
import { type VirtualRowPlace, VirtualRows, type VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { ArrowDownIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  type RefObject,
  type UIEvent,
  useCallback,
  useContext,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * conversation.tsx -- AI Elements' Conversation: a log of messages that keeps to its newest line while the reader is there.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to our tokens. One change of substance: the registry's
 * Conversation scrolls on `use-stick-to-bottom`, which animates the scroll
 * on timings of its own, where docs/DESIGN.md has content land at once. So
 * the log here draws its lines through `ConversationRows`, TanStack
 * Virtual's run (`@repo/ui/virtual-rows`), which keeps to the newest line
 * as the library's chat guide does: it opens at the end, a line appended
 * follows on to it while the reader stands near the end, a line growing at
 * the end keeps them there, and lines put before the first leave the
 * reader's place where it was. The context the children read is the
 * registry's: whether the log is at its bottom (`isAtEnd()`), and a way to
 * go there (`scrollToEnd()`).
 *
 * The log scrolls in `@repo/ui`'s `ScrollArea`, which fades its edges as
 * the caller asks, and holds its lines in one block of its own inside it
 * (`.conversation-log`), which carries the log's padding. That block is
 * not a flex column. A flex item of a container with a definite height has
 * a definite height of its own once flexed, so a percentage height anywhere
 * inside a message would resolve against the message rather than fall back
 * to its content; a block child keeps the height it draws, whatever is
 * inside it.
 */

/** How near its top, in screens of the box, a log asks for the lines older than its first (`onNearTop`): one, so they land before the reader reaches them. */
const NEAR_TOP_SCREENS = 1;

interface ConversationScroll {
  readonly isAtBottom: boolean;
  /** Hears whether the log stands at its end, as its run of lines says (`isAtEnd()`). */
  readonly atBottom: (atEnd: boolean) => void;
  readonly scrollToBottom: () => void;
  /** The scroll box, which `ConversationContent` is. */
  readonly list: RefObject<HTMLDivElement | null>;
  /** Holds the log's run of lines while it stands (`ConversationRows`); the answer lets it go. */
  readonly hold: (rows: RefObject<VirtualRowsHandle | null>) => () => void;
  /** Asks for older lines where the reader is near the top, or the lines do not fill the box. */
  readonly askOlder: () => void;
  readonly onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

const ConversationContext = createContext<ConversationScroll | undefined>(undefined);

function useConversation(): ConversationScroll {
  const context = useContext(ConversationContext);
  if (context === undefined)
    throw new Error("Conversation components must be used within Conversation");
  return context;
}

export type ConversationProps = ComponentProps<"div"> & {
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
  list: handed,
  onNearTop,
  ...props
}: ConversationProps): ReactNode {
  const own = useRef<HTMLDivElement>(null);
  const list = handed ?? own;
  const [isAtBottom, setAtBottom] = useState(true);
  // The log's run of lines, while one stands.
  const rows = useRef<RefObject<VirtualRowsHandle | null> | undefined>(undefined);
  const hold = useCallback((run: RefObject<VirtualRowsHandle | null>) => {
    rows.current = run;
    return () => {
      if (rows.current === run) rows.current = undefined;
    };
  }, []);
  // Where the log last stood, so a scroll is read as up or down from there.
  const lastTop = useRef(0);
  const nearTop = useRef(onNearTop);
  nearTop.current = onNearTop;
  const askOlder = useCallback(() => {
    const element = list.current;
    if (element === null) return;
    if (element.scrollTop <= element.clientHeight * NEAR_TOP_SCREENS) nearTop.current?.();
  }, [list]);
  const scrollToBottom = useCallback(() => {
    rows.current?.current?.scrollToEnd();
  }, []);
  const onScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget;
      const up = element.scrollTop < lastTop.current;
      lastTop.current = element.scrollTop;
      if (up) askOlder();
    },
    [askOlder],
  );
  const scroll = useMemo<ConversationScroll>(
    () => ({ isAtBottom, atBottom: setAtBottom, list, hold, askOlder, scrollToBottom, onScroll }),
    [isAtBottom, list, hold, askOlder, scrollToBottom, onScroll],
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
  const { list, onScroll } = useConversation();
  return (
    <ScrollArea
      ref={list}
      role="log"
      aria-live={streams ? "off" : undefined}
      fade={fade}
      fadeInset={fadeInset}
      onScroll={onScroll}
    >
      <div className={cn("conversation-log px-content-inset pt-section-gap pb-ui-20", className)}>
        {children}
      </div>
    </ScrollArea>
  );
}

/**
 * The log's lines, drawn only near the view (`@repo/ui/virtual-rows`), in
 * the log's own scroll box, as one line of the log: lines after it, a
 * working line's, stand after the run. The run keeps to the newest line
 * as the log's header says, and keeps the reader's place as lines land
 * before its first.
 */
export function ConversationRows({
  keys,
  estimate,
  gap,
  overscan,
  listItems = false,
  className,
  rowClassName,
  "aria-label": label,
  handle,
  children,
}: {
  keys: readonly string[];
  /** The height a line is taken to have before it is drawn, in pixels. */
  estimate: number;
  /** The room between two lines, in pixels. */
  gap: number;
  /** How many lines past each edge of the view are drawn. */
  overscan?: number | undefined;
  /** Whether each line is a list item of the caller's own, wearing the place it is handed (`VirtualRows`' `listItems`). */
  listItems?: boolean;
  className?: string | undefined;
  /** The class each line wears, or the class the line at an index wears. */
  rowClassName?: string | ((index: number) => string) | undefined;
  /** What the lines are called, to a reader. */
  "aria-label"?: string | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
  /** Draws the line at an index, which wears `place` where the lines are list items of the caller's own. */
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): ReactNode {
  const { list, hold, askOlder, atBottom } = useConversation();
  const run = useRef<VirtualRowsHandle>(null);
  useLayoutEffect(() => hold(run), [hold]);
  useImperativeHandle(handle, () => {
    const now = () => run.current;
    return {
      bringIn: (key, then) => now()?.bringIn(key, then) ?? false,
      rowElement: (key) => now()?.rowElement(key),
      drawnKeys: () => now()?.drawnKeys() ?? [],
      scrollToEnd: () => now()?.scrollToEnd(),
    };
  }, []);
  // Note that the lines changing may leave the box unfilled, which no scroll would say.
  useLayoutEffect(() => {
    askOlder();
  }, [keys, askOlder]);
  return (
    <VirtualRows
      scroller={list}
      keys={keys}
      estimate={estimate}
      gap={gap}
      overscan={overscan}
      listItems={listItems}
      className={className}
      rowClassName={rowClassName}
      aria-label={label}
      handle={run}
      onAtEnd={atBottom}
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
        "conversation-empty m-auto flex max-w-conversation-empty flex-col items-center justify-center gap-block-gap p-card text-center text-body text-muted-foreground",
        wide && "max-w-conversation-empty-wide",
      )}
    >
      {children}
    </div>
  );
}

/**
 * What floats over a log in a slot of its own, centered across it, on a
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
 * its own.
 */
export function ConversationScrollButton(): ReactNode {
  const { isAtBottom, scrollToBottom } = useConversation();
  if (isAtBottom) return null;
  return (
    // Its ground is the button's own (`--ui-button-ground`), which the button's lit fill is laid over as a title bar's is.
    <div
      className={`conversation-scroll ${FLOATING_OVER_LOG_CLASS} bottom-ui-16 flex bg-button-ground [--ui-button-ground:var(--ui-color-well)]`}
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
