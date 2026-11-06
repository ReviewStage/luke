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

const NEAR_TOP_SCREENS = 1;

interface ConversationScroll {
  readonly isAtBottom: boolean;
  readonly atBottom: (atEnd: boolean) => void;
  readonly scrollToBottom: () => void;
  readonly list: RefObject<HTMLDivElement | null>;
  readonly hold: (rows: RefObject<VirtualRowsHandle | null>) => () => void;
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
  list?: RefObject<HTMLDivElement | null> | undefined;
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
  const rows = useRef<RefObject<VirtualRowsHandle | null> | undefined>(undefined);
  const hold = useCallback((run: RefObject<VirtualRowsHandle | null>) => {
    rows.current = run;
    return () => {
      if (rows.current === run) rows.current = undefined;
    };
  }, []);
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
  className?: string | undefined;
  fade?: ScrollFade | undefined;
  fadeInset?: ScrollFadeInset | undefined;
  streams?: boolean | undefined;
  children?: ReactNode;
}

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
  estimate: number;
  gap: number;
  overscan?: number | undefined;
  listItems?: boolean;
  className?: string | undefined;
  rowClassName?: string | ((index: number) => string) | undefined;
  "aria-label"?: string | undefined;
  handle?: RefObject<VirtualRowsHandle | null> | undefined;
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
      keys: () => now()?.keys() ?? [],
      scrollToEnd: () => now()?.scrollToEnd(),
    };
  }, []);
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

export const FLOATING_OVER_LOG_CLASS =
  "absolute left-1/2 -translate-x-1/2 rounded-control shadow-floating-edge";

const SCROLL_LABEL = "Scroll to the newest line";

export function ConversationScrollButton(): ReactNode {
  const { isAtBottom, scrollToBottom } = useConversation();
  if (isAtBottom) return null;
  return (
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
