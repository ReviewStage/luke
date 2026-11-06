import { LINK_PLACE, type LinkPlace } from "@repo/features/link-grammar";
import { land } from "@repo/ui/landed";
import { createContext, useContext, useEffect, useRef } from "react";
import { centerWithin, scrollerOf } from "../scroll-within.js";

export interface MessageReveal {
  readonly agentId: string;
  readonly messageId: string;
  readonly ask: number;
}

const MESSAGE_ID_ATTRIBUTE = "data-message-id";

export const MESSAGE_GONE = "That message is no longer in the agent's transcript.";

const MessagePlaceContext = createContext<
  ((messageId: string) => LinkPlace | undefined) | undefined
>(undefined);

export const MessagePlaceProvider = MessagePlaceContext.Provider;

export function useMessagePlace(messageId: string): LinkPlace | undefined {
  return useContext(MessagePlaceContext)?.(messageId);
}

export function agentMessagePlace(
  agentId: string,
  read: readonly { readonly id: string }[],
): (messageId: string) => LinkPlace | undefined {
  const ids = new Set(read.map((message) => message.id));
  return (messageId) =>
    ids.has(messageId) ? { kind: LINK_PLACE.MESSAGE, agentId, messageId } : undefined;
}

const MessageRevealContext = createContext<
  | { readonly reveal: MessageReveal | undefined; readonly onRevealed: (ask: number) => void }
  | undefined
>(undefined);

export const MessageRevealProvider = MessageRevealContext.Provider;

function messageElement(root: ParentNode, messageId: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(`[${MESSAGE_ID_ATTRIBUTE}]`)].find(
    (each) => each.getAttribute(MESSAGE_ID_ATTRIBUTE) === messageId,
  );
}

export function useMessageReveal(input: {
  agentId: string;
  shown: boolean;
  caughtUp: boolean;
  whole: boolean;
  olderFailed: boolean;
  loadOlder: () => void;
  pages: number;
  settled: boolean;
  drawn: (messageId: string) => boolean;
  bringIn?: ((messageId: string, then: (row: HTMLElement) => void) => boolean) | undefined;
  gone: () => void;
}): void {
  const { agentId, shown, caughtUp, pages, settled } = input;
  const standing = useContext(MessageRevealContext);
  const asked = standing?.reveal?.agentId === agentId ? standing.reveal : undefined;
  const seen = useRef(new Map<number, number>());
  const bringing = useRef<number | undefined>(undefined);
  const answered = useRef<number | undefined>(undefined);
  if (asked !== undefined && !seen.current.has(asked.ask)) seen.current.set(asked.ask, pages);
  useEffect(() => {
    if (asked === undefined || !shown || answered.current === asked.ask) return;
    const lit = (element: HTMLElement) => {
      answered.current = asked.ask;
      const scroller = scrollerOf(element);
      if (scroller !== undefined) {
        centerWithin(scroller, element);
        scroller.dispatchEvent(new Event("scroll"));
      }
      land(element);
      standing?.onRevealed(asked.ask);
    };
    const held = input.drawn(asked.messageId);
    const element = held ? messageElement(document, asked.messageId) : undefined;
    const since = seen.current.get(asked.ask) ?? pages;
    if (element !== undefined) {
      lit(element);
      return;
    }
    if (held && input.bringIn !== undefined) {
      if (bringing.current === asked.ask) return;
      const brought = input.bringIn(asked.messageId, (row) => {
        bringing.current = undefined;
        lit(messageElement(row, asked.messageId) ?? row);
      });
      if (brought) {
        bringing.current = asked.ask;
        return;
      }
    }
    if (held) return;
    if (!input.whole) {
      if (!input.olderFailed) input.loadOlder();
      return;
    }
    if (caughtUp && (settled || pages > since)) {
      answered.current = asked.ask;
      input.gone();
      standing?.onRevealed(asked.ask);
    }
  });
}
