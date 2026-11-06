import { useAtomSet } from "@effect/atom-react";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { BUTTON_SIZE, Button, IconButton, MENU_SURFACE_FLOW, MenuSurface, Tooltip } from "@repo/ui";
import { replyOf } from "@repo/ui/reply-quote";
import { visibleViewport } from "@repo/ui/visible-viewport";
import { Duration, Effect } from "effect";
import { ReplyIcon, XIcon } from "lucide-react";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import { coarsePointerNow, FINGER_SELECTION_GAP } from "../coarse-pointer.js";
import type { ComposerQuote } from "../description-editor/contract.js";
import { rendererRuntime } from "../renderer-runtime.js";

export const REPLY_SCOPE = "data-reply-scope";

const SCOPE_SELECTOR = `[${REPLY_SCOPE}]`;

const ReplyDoorContext = createContext<((reply: string) => void) | undefined>(undefined);

export const ReplyDoorProvider = ReplyDoorContext.Provider;

export function useReplyDoor(): ((reply: string) => void) | undefined {
  return useContext(ReplyDoorContext);
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

const REPLY_WORDS = {
  REPLY: "Reply",
  REMOVE: "Remove quote",
} as const;

const PRESS_GAP = 6;
const PRESS_MARGIN = 48;

const PRESS_ROOM = 40;

const SELECTION_SETTLE = Duration.millis(300);

const selectionSettleAtom = () =>
  rendererRuntime.fn(({ offer }: { readonly offer: () => void }) =>
    Effect.andThen(Effect.sleep(SELECTION_SETTLE), Effect.sync(offer)),
  );

interface Picked extends PressPlace {
  readonly reply: string;
  readonly words: Element;
}

function reachesField(words: Element, range: Range): boolean {
  const common = range.commonAncestorContainer;
  const at = common instanceof Element ? common : common.parentElement;
  if (at !== null && at.closest(EDITABLE_SELECTOR) !== null) return true;
  return [...words.querySelectorAll(EDITABLE_SELECTOR)].some((field) =>
    range.intersectsNode(field),
  );
}

function scopeOf(node: Node): Element | null {
  return (node instanceof Element ? node : node.parentElement)?.closest(SCOPE_SELECTOR) ?? null;
}

function takesWords(text: Text, range: Range): boolean {
  const from = text === range.startContainer ? range.startOffset : 0;
  const to = text === range.endContainer ? range.endOffset : text.length;
  if (text.data.slice(from, to).trim() === "" || text.parentElement === null) return false;
  const style = getComputedStyle(text.parentElement);
  return (style.userSelect || style.webkitUserSelect) !== "none";
}

function cutTo(words: Element, range: Range): Range | undefined {
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Text && !words.contains(node) && range.intersectsNode(node)) {
      if (takesWords(node, range)) return undefined;
    }
  }
  const cut = range.cloneRange();
  if (!words.contains(range.endContainer)) cut.setEnd(words, words.childNodes.length);
  return cut;
}

function pickedIn(scope: HTMLElement): Picked | undefined {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined;
  const whole = selection.getRangeAt(0);
  const words = scopeOf(whole.commonAncestorContainer) ?? scopeOf(whole.startContainer);
  if (words === null || !scope.contains(words)) return undefined;
  const range = cutTo(words, whole);
  if (range === undefined) return undefined;
  if (words.closest("[hidden]") !== null) return undefined;
  if (reachesField(words, range)) return undefined;
  const reply = replyOf(selection.toString());
  if (reply === "") return undefined;
  return { reply, words, ...pressPlace(range.getBoundingClientRect()) };
}

export interface PressPlace {
  readonly left: number;
  readonly top: number;
  readonly below: boolean;
}

export function pressPlace(box: {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}): PressPlace {
  const seen = visibleViewport();
  const finger =
    coarsePointerNow() && box.bottom + FINGER_SELECTION_GAP + PRESS_ROOM <= seen.bottom;
  const below = finger || box.top - seen.top < PRESS_ROOM;
  const center = (box.left + box.right) / 2;
  return {
    left: Math.min(Math.max(center, seen.left + PRESS_MARGIN), seen.right - PRESS_MARGIN),
    top: below ? box.bottom + (finger ? FINGER_SELECTION_GAP : PRESS_GAP) : box.top - PRESS_GAP,
    below,
  };
}

export function ReplyToSelection({
  scope,
  onReply,
}: {
  scope: RefObject<HTMLElement | null>;
  onReply: (reply: string, words: Element) => void;
}): ReactNode {
  const [picked, setPicked] = useState<Picked | undefined>(undefined);
  const shown = picked !== undefined;
  const [settleAtom] = useState(selectionSettleAtom);
  const settle = useAtomSet(settleAtom);

  useEffect(() => {
    const element = scope.current;
    if (element === null) return undefined;
    const offer = () => setPicked(pickedIn(element));
    const changed = () => {
      if (coarsePointerNow() && pickedIn(element) !== undefined) settle({ offer });
    };
    element.addEventListener("pointerup", offer);
    element.addEventListener("keyup", offer);
    document.addEventListener("selectionchange", changed);
    return () => {
      element.removeEventListener("pointerup", offer);
      element.removeEventListener("keyup", offer);
      document.removeEventListener("selectionchange", changed);
    };
  }, [scope, settle]);

  useEffect(() => {
    const element = scope.current;
    if (!shown || element === null) return undefined;
    const follow = () => setPicked(pickedIn(element));
    const hiding = new MutationObserver(follow);
    hiding.observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });
    document.addEventListener("selectionchange", follow);
    document.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      hiding.disconnect();
      document.removeEventListener("selectionchange", follow);
      document.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [scope, shown]);

  const reply =
    picked === undefined
      ? undefined
      : () => {
          setPicked(undefined);
          window.getSelection()?.removeAllRanges();
          onReply(picked.reply, picked.words);
        };
  useAppCommand(APP_COMMAND.REPLY_TO_SELECTION, reply);

  if (picked === undefined || reply === undefined) return null;
  return <ReplyPress place={picked} onReply={reply} />;
}

export function ReplyPress({
  place,
  onReply,
  layer,
}: {
  place: PressPlace;
  onReply: () => void;
  layer?: RefObject<HTMLDivElement | null> | undefined;
}): React.JSX.Element {
  return createPortal(
    <MenuSurface
      ref={layer}
      flow={MENU_SURFACE_FLOW.TOOLBAR}
      className="reply-to-selection fixed z-menu -translate-x-1/2 -translate-y-full data-below:translate-y-0"
      data-below={place.below ? "" : undefined}
      style={{ left: place.left, top: place.top }}
    >
      <Tooltip label={REPLY_WORDS.REPLY} command={APP_COMMAND.REPLY_TO_SELECTION}>
        <Button
          icon={<ReplyIcon aria-hidden="true" />}
          keepFocus
          onPointerDown={(event) => event.preventDefault()}
          onClick={onReply}
        >
          {REPLY_WORDS.REPLY}
        </Button>
      </Tooltip>
    </MenuSurface>,
    document.body,
  );
}

export function ComposerQuoteView({
  quote,
  held,
}: {
  quote: ComposerQuote;
  held: boolean;
}): React.JSX.Element {
  return (
    <div className="composer-quote my-tight-gap mx-0 flex select-none items-start gap-control-gap border-l-3 border-border-strong pl-[0.8em] text-caption leading-body text-muted-foreground">
      <span className="composer-quote-words m-0 min-w-0 flex-auto whitespace-pre-line wrap-anywhere line-clamp-3">
        {quote.words}
      </span>
      <Tooltip label={REPLY_WORDS.REMOVE}>
        <IconButton
          icon={<XIcon aria-hidden="true" />}
          label={REPLY_WORDS.REMOVE}
          size={BUTTON_SIZE.COMPACT}
          disabled={held}
          keepFocus
          onClick={quote.remove}
        />
      </Tooltip>
    </div>
  );
}
