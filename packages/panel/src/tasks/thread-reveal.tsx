import type { ReviewThread } from "@repo/features/agent-wire";
import type { PullRequestThreadView } from "@repo/features/link-grammar";
import { LANDED_ANIMATION } from "@repo/ui/landed";
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

export const THREAD_REVEAL_WORDS = {
  GONE: "That comment is no longer on this pull request.",
  FILE_GONE: "That comment's file is no longer in this pull request's changes.",
  VIEW_FILES: "View in Files changed",
  VIEW_CONVERSATION: "View in Conversation",
  THING: "Review thread",
} as const;

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

export const ThreadRevealProvider = ThreadRevealContext.Provider;

export function useWindowThreadReveal(
  agentId: string,
): { readonly reveal: ThreadReveal; readonly onRevealed: (ask: number) => void } | undefined {
  const standing = useContext(ThreadRevealContext);
  const reveal = standing?.reveal;
  return reveal === undefined || reveal.agentId !== agentId
    ? undefined
    : { reveal, onRevealed: standing?.onRevealed ?? (() => undefined) };
}

export interface ThreadLanding {
  readonly target: string;
  readonly ask: number;
  readonly scroll?: ((card: HTMLElement) => void) | undefined;
  readonly ready?: ((card: HTMLElement) => boolean) | undefined;
  readonly frames?: number | undefined;
  readonly onLanded: (ask: number) => void;
  readonly onFaded: (ask: number) => void;
}

const ThreadLandingContext = createContext<ThreadLanding | undefined>(undefined);

export const ThreadLandingProvider = ThreadLandingContext.Provider;

export interface LandedCard {
  readonly ref: (card: HTMLElement | null) => void;
  readonly ringed: boolean;
  readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void;
}

export interface LandedThread extends LandedCard {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const LANDING_FRAMES = 60;

export function landable(card: HTMLElement): boolean {
  return (
    card.isConnected &&
    card.closest("[hidden]") === null &&
    getComputedStyle(card).visibility === "visible"
  );
}

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
    onAnimationEnd: (event) => {
      if (event.target !== event.currentTarget || event.animationName !== LANDED_ANIMATION) return;
      setRinged(false);
      fade.current?.();
      fade.current = undefined;
    },
  };
}

function summaryOf(card: HTMLElement): HTMLElement | null {
  return card.querySelector<HTMLElement>("summary");
}

function itself(card: HTMLElement): HTMLElement {
  return card;
}

export function useLandedThread(thread: ReviewThread, defaultOpen: boolean): LandedThread {
  const [open, setOpen] = useState(defaultOpen);
  const card = useLanding(thread.id, summaryOf, () => setOpen(true));
  return { ...card, open, onOpenChange: setOpen };
}

export function useLandedEntry(url: string): LandedCard {
  return useLanding(url, itself, () => undefined);
}
