/**
 * browser-history.ts -- the panel's back and forward kept in the tab's own history, so the address bar and the browser's Back and Forward follow the panel, and the panel follows them.
 *
 * Each step the panel records is an entry of the tab's history, written with
 * `history.pushState` or `history.replaceState` at the step's address, its
 * state saved beside the entry's index as `{state, idx}`. The entries are
 * also held here, by that index, so the panel reads every step's state
 * without the browser travelling to it, as `@luke/ui/history-adapter`
 * promises. A `popstate` is the browser moving by itself: the index it lands
 * on stands, and every listener hears it, so the panel goes there
 * (`navigation-history.ts`). A move of the panel's own stands at once, as the
 * memory history's does, and the browser's traversal, which lands later,
 * changes nothing; a write or another move made before it lands waits for
 * it, because the browser would put it on the entry it is leaving.
 *
 * A tab reloaded on an entry this history wrote starts on it, its state read
 * back from the browser, and learns the entries around it as the browser
 * lands on them. An entry it never wrote, the page's own first load or a
 * fragment's, holds no state, so landing there stands nothing, and the
 * address is opened as a link instead (`load-link.ts`).
 */

import type { HistoryAdapter, HistoryEntry, HistorySnapshot } from "@luke/ui/history-adapter";
import { Schema } from "effect";

/** The most entries held, as the desktop's memory history holds; the browser keeps its own bound. */
const HISTORY_LIMIT = 50;

const EMPTY: HistorySnapshot<never> = { entries: [], at: -1 };

/** How an entry is written into the tab's history: a new one after the one standing, or in its place. */
const WRITE = {
  PUSH: "push",
  REPLACE: "replace",
} as const;

type Write = (typeof WRITE)[keyof typeof WRITE];

/** What an entry this history wrote holds as the browser's `history.state`: the step's state and the entry's index. */
interface SavedEntry<State> {
  readonly state: State;
  readonly idx: number;
}

/** The address written for an entry whose own is not a path of this site, which the browser would refuse: the panel's own page, which names no place. */
const PANEL_ADDRESS = "/app";

/** A path of this site: one slash, then anything but a second, or a backslash a browser reads as one, which would name another host. */
const SAME_ORIGIN_PATH = /^\/(?![/\\])/u;

/** The tabs and newlines a URL's parser drops before reading it, which could hide a second slash from `SAME_ORIGIN_PATH`. */
const URL_DROPPED = /[\t\n\r]/gu;

/** Whether `address` is a path of this site, as the browser reads it: one slash first once what its parser drops is gone, and this site's origin once read. */
function sameOriginPath(address: string): boolean {
  if (!SAME_ORIGIN_PATH.test(address.replace(URL_DROPPED, ""))) return false;
  try {
    return new URL(address, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** The entry as it is written: at its own address where that is a path of this site, else at the panel's page, so a bad address never throws. */
function writable<State>(entry: HistoryEntry<State>): HistoryEntry<State> {
  return sameOriginPath(entry.address) ? entry : { ...entry, address: PANEL_ADDRESS };
}

/** The address the tab stands at, as the panel writes one: its path, query, and fragment. */
function addressHere(): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/** An entry's state as this history writes it, read back from the browser, which may hold anything there. */
const isSavedEntry = Schema.is(Schema.Struct({ state: Schema.Unknown, idx: Schema.Int }));

/** The step saved in the entry the browser stands on, or lands on with `landing`; nothing for an entry this history never wrote. */
export function savedEntry<State>(landing?: PopStateEvent): SavedEntry<State> | undefined {
  const held: unknown = landing === undefined ? window.history.state : landing.state;
  if (!isSavedEntry(held)) return undefined;
  // SAFETY: only this history writes an entry shaped `{state, idx}`, with the state the panel handed it.
  return { idx: held.idx, state: held.state as State };
}

/**
 * The tab's history as the panel's adapter, holding at most `limit` entries.
 * `base` is the browser's index of the first entry held, so the entry at `n`
 * is the browser's `base + n`; an index never seen is minted past every one
 * that was, so an entry written after landing somewhere unknown never takes
 * the index of one the browser still holds.
 */
export function browserHistory<State>(limit: number = HISTORY_LIMIT): HistoryAdapter<State> {
  const loaded = savedEntry<State>();
  let base = loaded?.idx ?? 0;
  let highest = base;
  let snapshot: HistorySnapshot<State> =
    loaded === undefined
      ? EMPTY
      : { entries: [{ address: addressHere(), state: loaded.state }], at: 0 };
  const listeners = new Set<() => void>();
  // The index a traversal of the panel's is travelling to, and the browser's writes and moves waiting on it, in order.
  let travelling: number | undefined;
  const waiting: (() => void)[] = [];
  const drain = () => {
    while (travelling === undefined) {
      const next = waiting.shift();
      if (next === undefined) return;
      next();
    }
  };
  // Note that the browser is written in the order the entries were, one traversal at a time,
  // because a write or a move made while one travels would act on the entry it is leaving.
  const inTurn = (step: () => void) => {
    waiting.push(step);
    drain();
  };

  const stand = (next: HistorySnapshot<State>) => {
    if (next.entries === snapshot.entries && next.at === snapshot.at) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const write = (kind: Write, entry: HistoryEntry<State>, at: number) => {
    const saved: SavedEntry<State> = { state: entry.state, idx: base + at };
    highest = Math.max(highest, saved.idx);
    const apply = () =>
      kind === WRITE.PUSH
        ? window.history.pushState(saved, "", entry.address)
        : window.history.replaceState(saved, "", entry.address);
    inTurn(apply);
  };
  // Stands `entries` with `at` among them, dropping the oldest past the bound.
  const keep = (entries: readonly HistoryEntry<State>[], at: number): HistorySnapshot<State> => {
    const dropped = Math.max(0, entries.length - limit);
    base += dropped;
    return { entries: entries.slice(dropped), at: at - dropped };
  };
  // Where the browser landing on an entry leaves the history: on one held, beside the ones held, or alone.
  const landed = (saved: SavedEntry<State> | undefined): HistorySnapshot<State> => {
    if (saved === undefined) {
      highest += 1;
      base = highest;
      return EMPTY;
    }
    highest = Math.max(highest, saved.idx);
    const { entries } = snapshot;
    const at = saved.idx - base;
    if (at >= 0 && at < entries.length) return { entries, at };
    const entry: HistoryEntry<State> = { address: addressHere(), state: saved.state };
    if (at === -1) {
      base -= 1;
      return { entries: [entry, ...entries].slice(0, limit), at: 0 };
    }
    if (at === entries.length) return keep([...entries, entry], at);
    base = saved.idx;
    return { entries: [entry], at: 0 };
  };

  window.addEventListener("popstate", (event) => {
    const saved = savedEntry<State>(event);
    // Note that a traversal of the panel's own already stands, so its landing only lets what waits on it through.
    if (travelling !== undefined) {
      if (saved?.idx !== travelling) return;
      travelling = undefined;
      drain();
      return;
    }
    stand(landed(saved));
  });

  return {
    current: () => snapshot,
    push: (pushed) => {
      const entry = writable(pushed);
      if (snapshot.at < 0) {
        write(WRITE.REPLACE, entry, 0);
        stand({ entries: [entry], at: 0 });
        return;
      }
      const next = keep([...snapshot.entries.slice(0, snapshot.at + 1), entry], snapshot.at + 1);
      write(WRITE.PUSH, entry, next.at);
      stand(next);
    },
    replace: (replaced) => {
      const entry = writable(replaced);
      const at = Math.max(snapshot.at, 0);
      const entries = snapshot.at < 0 ? [entry] : snapshot.entries.with(at, entry);
      write(WRITE.REPLACE, entry, at);
      stand({ entries, at });
    },
    go: (delta) => {
      const at = snapshot.at + delta;
      if (delta === 0 || at < 0 || at >= snapshot.entries.length) return;
      const target = base + at;
      inTurn(() => {
        travelling = target;
        window.history.go(delta);
      });
      stand({ entries: snapshot.entries, at });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
