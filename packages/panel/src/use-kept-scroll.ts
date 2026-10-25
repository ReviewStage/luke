import { Schema } from "effect";
import { type RefCallback, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { type KeptKey, useKept } from "./use-kept.js";

/**
 * use-kept-scroll.ts -- where a page stood scrolled when its reader left it, kept through `useKept` and put back once as they return.
 *
 * A page that holds several views keeps where each stood, by the view's
 * name, as one record under one key. The position is written as the reader
 * leaves (`keep`, and the page unmounting), never as they scroll, so
 * scrolling draws nothing; and it is put back once, as the page first has
 * its content, never again, so the page holds still while it is read: a
 * list that refreshes, or a reader who scrolled before the content came,
 * is not moved. A position the content is too short for stands where the
 * browser clamps it.
 */

/** Where a scroller stood. */
const storedAt = Schema.Struct({ top: Schema.Finite, left: Schema.Finite });

type ScrollAt = typeof storedAt.Type;

/** Where each view stood scrolled, by its name, as a key keeps it. */
export const storedScrolls = Schema.fromJsonString(Schema.Record(Schema.String, storedAt));

type Scrolls = typeof storedScrolls.Type;

/** What a page hands its scroller and calls as its reader leaves a view. */
export interface KeptScroll {
  /** The scroller's ref. */
  readonly ref: RefCallback<HTMLDivElement>;
  /** Keeps where the view now shown stands scrolled; call it before another is shown. */
  readonly keep: () => void;
}

/**
 * The scroller of the view `name`, put back where `key` kept it once
 * `settled`, the page holding its content; kept again as `keep` is called
 * and as the page goes.
 */
export function useKeptScroll(key: KeptKey<Scrolls>, name: string, settled: boolean): KeptScroll {
  const [kept, choose] = useKept(key, {});
  const element = useRef<HTMLDivElement | null>(null);
  const at = useRef<ScrollAt>({ top: 0, left: 0 });
  // Whether the reader has scrolled, or the position was put back, for the scroller drawn now.
  const known = useRef(false);
  const restoredFor = useRef<string | undefined>(undefined);
  const ref = useCallback((scroller: HTMLDivElement | null) => {
    element.current = scroller;
    if (scroller === null) return undefined;
    known.current = false;
    at.current = { top: scroller.scrollTop, left: scroller.scrollLeft };
    const onScroll = () => {
      known.current = true;
      at.current = { top: scroller.scrollTop, left: scroller.scrollLeft };
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    const scroller = element.current;
    if (!settled || scroller === null || restoredFor.current === name) return;
    restoredFor.current = name;
    // Note that a reader who scrolled before the content came is left where they are.
    if (known.current) return;
    known.current = true;
    const held = kept[name];
    if (held === undefined) return;
    scroller.scrollTop = held.top;
    scroller.scrollLeft = held.left;
    at.current = held;
  }, [settled, name, kept]);
  const keep = () => {
    // Note that a view never read nor scrolled keeps what was kept before, not where it stood while loading.
    if (!known.current) return;
    choose({ ...kept, [name]: at.current });
  };
  const leaving = useRef(keep);
  leaving.current = keep;
  useEffect(() => () => leaving.current(), []);
  return { ref, keep };
}
