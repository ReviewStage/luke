import { LINK_PLACE, type LinkPlace } from "@luke/features/luke-link";
import { createContext, useContext, useEffect, useRef } from "react";
import { centreWithin, scrollerOf } from "./code-pane.js";

/**
 * message-links.tsx -- a message's own link: whose transcript a message is of, so its Copy link can name it, and the ask to bring a linked message into view.
 *
 * A message is named by its agent, under its task where it has one, and its
 * own id (`@luke/features/luke-link`'s message place). The tab drawing an
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
 * follows its newest line lets go of the bottom, and lit once. It is said
 * gone through `gone` only once the transcript has `caughtUp` with no such
 * message: for an agent that has `settled`, its last page; for one still
 * writing, a page read after the ask, since an empty page from before it
 * says nothing of what was written since. Either way the ask is let go.
 * Note that a message on a page not yet read is waited for, since a long
 * transcript lands page by page, and that a read that failed leaves the ask
 * standing for the tab's Retry.
 */
export function useMessageReveal(input: {
  agentId: string;
  shown: boolean;
  caughtUp: boolean;
  pages: number;
  settled: boolean;
  drawn: (messageId: string) => boolean;
  gone: () => void;
}): void {
  const { agentId, shown, caughtUp, pages, settled } = input;
  const standing = useContext(MessageRevealContext);
  const asked = standing?.reveal?.agentId === agentId ? standing.reveal : undefined;
  // The pages read when each ask was first seen, by its count.
  const seen = useRef(new Map<number, number>());
  if (asked !== undefined && !seen.current.has(asked.ask)) seen.current.set(asked.ask, pages);
  useEffect(() => {
    if (asked === undefined || !shown) return;
    const element = input.drawn(asked.messageId)
      ? [...document.querySelectorAll<HTMLElement>(`[${MESSAGE_ID_ATTRIBUTE}]`)].find(
          (each) => each.getAttribute(MESSAGE_ID_ATTRIBUTE) === asked.messageId,
        )
      : undefined;
    const since = seen.current.get(asked.ask) ?? pages;
    if (element !== undefined) {
      const scroller = scrollerOf(element);
      if (scroller !== undefined) {
        centreWithin(scroller, element);
        scroller.dispatchEvent(new Event("scroll"));
      }
      element.setAttribute("data-message-revealed", "");
    } else if (caughtUp && (settled || pages > since)) {
      input.gone();
    } else {
      return;
    }
    standing?.onRevealed(asked.ask);
  });
}
