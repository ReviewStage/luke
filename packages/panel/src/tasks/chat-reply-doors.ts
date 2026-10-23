/**
 * chat-reply-doors.ts -- where a Reply in Chat lays its quote: the box nearest the words it was over, each box standing for the part of the place it answers.
 *
 * A place of the chat holds several boxes: an open ask's answer, an open
 * thread's reply, and the channel's own at its foot. Words selected in a
 * message and replied to (`reply-to-selection.tsx`) are quoted into the
 * one that answers them, as a reply in the Inbox or an agent's tab lands
 * in the one box there: an ask's words in its answer, a thread's in its
 * box while it is open, and anything else in the channel's. Each box
 * stands for an element of the place, its card or its thread's row, and
 * the quote goes to the first standing around the words that takes it, so
 * one that cannot, a box held while it sends, a thread folded, hands it on
 * to the one around it, and the channel's box takes what none took.
 */

import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

/** A box's way of laying a quote in, answering whether it did. */
export type ChatReplyDoor = (words: string) => boolean;

/** The boxes of a place, each by the element whose words it answers. */
export type ChatReplyDoors = Map<Element, ChatReplyDoor>;

/** The boxes of the place drawn; none outside one, where no Reply is offered. */
export const ChatReplyDoorsContext = createContext<ChatReplyDoors | undefined>(undefined);

/** Stands `door`, the latest drawn, for the words under `region`, for as long as both stand. */
export function useChatReplyDoor(region: RefObject<Element | null>, door: ChatReplyDoor): void {
  const doors = useContext(ChatReplyDoorsContext);
  const latest = useRef(door);
  useLayoutEffect(() => {
    latest.current = door;
  });
  useEffect(() => {
    const element = region.current;
    if (doors === undefined || element === null) return undefined;
    doors.set(element, (words) => latest.current(words));
    return () => {
      doors.delete(element);
    };
  }, [doors, region]);
}

/** Lays `reply` into the box nearest `words`, the first standing for an element around them that takes it, answering whether one did. */
export function replyInto(doors: ChatReplyDoors, words: Element, reply: string): boolean {
  for (let at: Element | null = words; at !== null; at = at.parentElement) {
    if (doors.get(at)?.(reply) === true) return true;
  }
  return false;
}
