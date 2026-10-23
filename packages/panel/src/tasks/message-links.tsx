import { LINK_PLACE, type LinkPlace } from "@luke/features/link-grammar";
import { createContext, useContext, useEffect, useRef } from "react";
import { centreWithin, scrollerOf } from "./code-pane.js";

/**
 * message-links.tsx -- a message's own link: whose transcript a message is of, so its Copy link can name it, and the ask to bring a linked message into view.
 *
 * A message is named by its agent, under its task where it has one, and its
 * own id (`@luke/features/link-grammar`'s message place). The tab drawing an
 * agent's transcript hands down how its messages are named; a message
 * drawn anywhere else names nothing and offers no link.
 *
 * A link to a message opens its agent's tab and asks it to bring the
 * message into view, each ask its own, as a section's link asks the task's
 * page. The tab answers once its transcript has landed: it scrolls its own
 * scroller to the message, which wears `data-message-revealed`, lighting it
 * once, or, where the transcript holds no such message, since an
 * agent's earliest steps are left out of it, says so. Note that a message
 * is found by its id in an attribute, `data-message-id`, which carries an
 * id and none of the message's words, so the session recording reads no
 * more of it than of any other attribute.
 */

/** An ask to bring one of an agent's messages into view, and its count, so the same message asked twice is shown twice. */
export interface MessageReveal {
  readonly agentId: string;
  readonly messageId: string;
  readonly ask: number;
}

/** The attribute a message's element carries its id in, which a reveal finds it by. */
const MESSAGE_ID_ATTRIBUTE = "data-message-id";

/** What the tab says where the message a link names is not in its transcript. */
export const MESSAGE_GONE = "That message is no longer in the agent's transcript.";

const MessagePlaceContext = createContext<
  ((messageId: string) => LinkPlace | undefined) | undefined
>(undefined);

/** Hands down how the transcript drawn names its messages. */
export const MessagePlaceProvider = MessagePlaceContext.Provider;

/** The place a message drawn here is named by; none where no transcript names its messages. */
export function useMessagePlace(messageId: string): LinkPlace | undefined {
  return useContext(MessagePlaceContext)?.(messageId);
}

/** How an agent's messages are named: under its task where it has one, and only those the service has read back, since a line still on its way has no id a link can find. */
export function agentMessagePlace(
  agent: { readonly id: string; readonly planId: string | null },
  read: readonly { readonly id: string }[],
): (messageId: string) => LinkPlace | undefined {
  const ids = new Set(read.map((message) => message.id));
  return (messageId) => {
    if (!ids.has(messageId)) return undefined;
    return agent.planId === null
      ? { kind: LINK_PLACE.MESSAGE, agentId: agent.id, messageId }
      : { kind: LINK_PLACE.MESSAGE, planId: agent.planId, agentId: agent.id, messageId };
  };
}

const MessageRevealContext = createContext<
  | { readonly reveal: MessageReveal | undefined; readonly onRevealed: (ask: number) => void }
  | undefined
>(undefined);

/** Hands down the standing ask to bring a message into view, and its letting go. */
export const MessageRevealProvider = MessageRevealContext.Provider;

/**
 * Answers the standing ask to bring one of `agentId`'s messages into view
 * while the tab is `shown`: as soon as the message is drawn, it is scrolled
 * to the middle of its scroller, the scroller told it moved so a log that
 * follows its newest line lets go of the bottom, and lit once. A message
 * not drawn while older ones than the transcript's first held stand is
 * looked for on the older pages (`loadOlder`), read one by one, and while
 * one of them did not answer it waits, the ask standing, for the reader to
 * ask again; one held whose row a long log has not drawn is brought into
 * view through `bringIn`, and lit once its row is drawn. It is said
 * gone through `gone` only once the transcript has `caughtUp`, is held
 * `whole`, and has no such message: for an agent that has `settled`, its last page; for one still
 * writing, a page read after the ask, since an empty page from before it
 * says nothing of what was written since. Either way the ask is let go.
 * Note that a message on a page not yet read is waited for, since a long
 * transcript lands page by page, and that a read that failed leaves the ask
 * standing for the tab's Retry.
 */
/** The element under `root` drawing the message with `messageId`, where it is drawn. */
function messageElement(root: ParentNode, messageId: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>(`[${MESSAGE_ID_ATTRIBUTE}]`)].find(
    (each) => each.getAttribute(MESSAGE_ID_ATTRIBUTE) === messageId,
  );
}

export function useMessageReveal(input: {
  agentId: string;
  shown: boolean;
  caughtUp: boolean;
  /** Whether no messages older than the first held stand. */
  whole: boolean;
  /** Whether the last older read did not answer, so the older pages are not read again on their own. */
  olderFailed: boolean;
  /** Reads the page older than the first message held. */
  loadOlder: () => void;
  pages: number;
  settled: boolean;
  drawn: (messageId: string) => boolean;
  /**
   * Brings a message held but not drawn, its row scrolled out of a log that
   * draws only the rows near its view, into view, handing its row to `then`
   * once drawn; false where the log holds no row of it.
   */
  bringIn?: ((messageId: string, then: (row: HTMLElement) => void) => boolean) | undefined;
  gone: () => void;
}): void {
  const { agentId, shown, caughtUp, pages, settled } = input;
  const standing = useContext(MessageRevealContext);
  const asked = standing?.reveal?.agentId === agentId ? standing.reveal : undefined;
  // The pages read when each ask was first seen, by its count.
  const seen = useRef(new Map<number, number>());
  // The ask whose message is being brought into view, which waits for its row rather than ask again.
  const bringing = useRef<number | undefined>(undefined);
  // The ask answered last, so a draw before the window lets it go answers it no second time.
  const answered = useRef<number | undefined>(undefined);
  if (asked !== undefined && !seen.current.has(asked.ask)) seen.current.set(asked.ask, pages);
  useEffect(() => {
    if (asked === undefined || !shown || answered.current === asked.ask) return;
    const lit = (element: HTMLElement) => {
      answered.current = asked.ask;
      const scroller = scrollerOf(element);
      if (scroller !== undefined) {
        centreWithin(scroller, element);
        scroller.dispatchEvent(new Event("scroll"));
      }
      element.setAttribute("data-message-revealed", "");
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
    // A message held but not drawn yet, the log still waiting to draw, is waited for.
    if (held) return;
    if (!input.whole) {
      // Note that an older read that failed is not asked again here, so a service that does not answer is not asked on every draw; the reader scrolling up asks again.
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
