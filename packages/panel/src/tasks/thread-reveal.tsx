import type { ReviewThread } from "@luke/features/coding-agent-wire";
import type { PullRequestThreadView } from "@luke/features/luke-link";
import {
  type AnimationEvent,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { focusSeek } from "../focus-seek.js";

/**
 * thread-reveal.tsx -- one review thread of a pull request brought into view in its Pull request tab, by a link to it (`LINK_PLACE.PULL_REQUEST_THREAD`) or a press of View in Files changed or View in Conversation.
 *
 * A link opens the agent's Pull request tab on the view it names and leaves
 * the ask here (`ThreadRevealProvider`), counted so the same thread asked
 * twice is shown twice, as a message's link leaves its own
 * (`message-links.tsx`). The tab takes the ask as it draws and lets it go,
 * then finds the thread by GitHub's node id in the conversation it read.
 * Whichever view the thread is drawn in hands its cards the thread to land
 * on (`ThreadLandingProvider`): the card opens itself, a minimized one's
 * chip with it, waits until it stands in sight, the view having scrolled it
 * there, takes the focus without scrolling again, and is ringed once, as a
 * search result landed on is (`data-search-landed`). The ring's end is told
 * back, which lets go of the lines the view lit for it.
 */

/** What a thread revealed says where it cannot be shown. */
export const THREAD_REVEAL_WORDS = {
  GONE: "That comment is no longer on this pull request.",
  FILE_GONE: "That comment's file is no longer in this pull request's changes.",
  VIEW_FILES: "View in Files changed",
  VIEW_CONVERSATION: "View in Conversation",
  /** The name of a thread's ⋯. */
  MENU: "Comment actions",
} as const;

/** An ask to bring one review thread of an agent's pull request into view, on one of its tab's views; counted, so each ask is its own. */
export interface ThreadReveal {
  readonly agentId: string;
  readonly threadId: string;
  readonly view: PullRequestThreadView;
  readonly ask: number;
}

const ThreadRevealContext = createContext<
  | { readonly reveal: ThreadReveal | undefined; readonly onRevealed: (ask: number) => void }
  | undefined
>(undefined);

/** Hands down the window's standing ask to bring a review thread into view, and its letting go. */
export const ThreadRevealProvider = ThreadRevealContext.Provider;

/** The window's standing ask for one of `agentId`'s threads, and the door that lets it go; none where none stands for this agent. */
export function useWindowThreadReveal(
  agentId: string,
): { readonly reveal: ThreadReveal; readonly onRevealed: (ask: number) => void } | undefined {
  const standing = useContext(ThreadRevealContext);
  const reveal = standing?.reveal;
  return reveal === undefined || reveal.agentId !== agentId
    ? undefined
    : { reveal, onRevealed: standing?.onRevealed ?? (() => undefined) };
}

/** The card a view lands on, a review thread by GitHub's id or a conversation entry by its page (`target`), and what the view does around the landing. */
export interface ThreadLanding {
  readonly target: string;
  readonly ask: number;
  /** Brings the card into sight in the view's own scroller; none where the view has scrolled it there itself. */
  readonly scroll?: ((card: HTMLElement) => void) | undefined;
  /** Whether the card stands where the landing may end on it; defaults to `landable`. */
  readonly ready?: ((card: HTMLElement) => boolean) | undefined;
  /** How many frames the card is waited for before the landing is given up. */
  readonly frames?: number | undefined;
  /** Told the card took the focus. */
  readonly onLanded: (ask: number) => void;
  /** Told the card's ring ended. */
  readonly onFaded: (ask: number) => void;
}

const ThreadLandingContext = createContext<ThreadLanding | undefined>(undefined);

/** Hands a view's cards the one to land on; none lands on none. */
export const ThreadLandingProvider = ThreadLandingContext.Provider;

/** A card a landing may end on: its element, and its ring while the landing stands. */
export interface LandedCard {
  /** Holds the card's element, the one ringed and scrolled to. */
  readonly ref: (card: HTMLElement | null) => void;
  /** Whether the card wears its ring, `data-search-landed`. */
  readonly ringed: boolean;
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

/** A thread card, its fold opened by a landing. */
export interface LandedThread extends LandedCard {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The ring's animation (`settings.css`'s `search-landed`), whose end is the landing's. */
const RING_ANIMATION = "search-landed";

/** How many frames a card is waited for where the view says no other. */
const LANDING_FRAMES = 60;

/**
 * Whether a card may take the focus a landing brings: in the panel's
 * layout, in no hidden view, as a Pull request tab hides the views not
 * chosen, and visible, the panel past the arrival its staged surface waits
 * out (`focus-seek.ts`), since a card still `visibility: hidden` refuses
 * the focus and the landing would end without it.
 */
export function landable(card: HTMLElement): boolean {
  return (
    card.isConnected &&
    card.closest("[hidden]") === null &&
    getComputedStyle(card).visibility === "visible"
  );
}

/**
 * A card's landing, where the view lands on `target`: once the card is drawn
 * where the view says it may end, it is scrolled into sight where the view
 * scrolls it, what `focused` names in it takes the focus without scrolling,
 * and it wears its ring until the ring's animation ends. `onAsked` hears
 * each new ask as the card draws, before the view scrolls.
 */
function useLanding(
  target: string | undefined,
  focused: (card: HTMLElement) => HTMLElement | null,
  onAsked: () => void,
): LandedCard {
  const landing = useContext(ThreadLandingContext);
  const asked = landing !== undefined && landing.target === target ? landing : undefined;
  const card = useRef<HTMLElement | null>(null);
  const ref = useCallback((element: HTMLElement | null) => {
    card.current = element;
  }, []);
  const [seen, setSeen] = useState<number | undefined>(undefined);
  const [ringed, setRinged] = useState(false);
  if (asked !== undefined && asked.ask !== seen) {
    setSeen(asked.ask);
    onAsked();
  }
  const latest = useRef({ asked, focused });
  latest.current = { asked, focused };
  // The landing's word that its ring ended, kept from the moment it landed, since the ask is let go then.
  const fade = useRef<(() => void) | undefined>(undefined);
  const ask = asked?.ask;
  useEffect(() => {
    const standing = latest.current.asked;
    if (ask === undefined || standing === undefined) return undefined;
    return focusSeek({
      find: () => card.current,
      ready: standing.ready ?? landable,
      frames: standing.frames ?? LANDING_FRAMES,
      act: (card) => {
        standing.scroll?.(card);
        latest.current.focused(card)?.focus({ preventScroll: true });
        fade.current = () => standing.onFaded(ask);
        setRinged(true);
        standing.onLanded(ask);
      },
    });
  }, [ask]);
  return {
    ref,
    ringed,
    // Note that only the card's own ring ends the landing, since its body's motion bubbles here too.
    onAnimationEnd: (event) => {
      if (event.target !== event.currentTarget || event.animationName !== RING_ANIMATION) return;
      setRinged(false);
      fade.current?.();
      fade.current = undefined;
    },
  };
}

/** A thread card's summary, which takes the focus a landing brings. */
function summaryOf(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>("summary");
}

/** A card that takes the focus itself, as a conversation entry does (`tabIndex` −1). */
function itself(card: HTMLElement): HTMLElement {
  return card;
}

/** A thread card's fold, `defaultOpen` until pressed, and each landing on its thread, which opens it at once, so the view measures it open before it scrolls. */
export function useLandedThread(thread: ReviewThread, defaultOpen: boolean): LandedThread {
  const [open, setOpen] = useState(defaultOpen);
  const card = useLanding(thread.id, summaryOf, () => setOpen(true));
  return { ...card, open, onOpenChange: setOpen };
}

/** A conversation entry's landing, by its page, as a link to it on GitHub lands on it. */
export function useLandedEntry(url: string): LandedCard {
  return useLanding(url, itself, () => undefined);
}
