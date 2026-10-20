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
 * The browser may not do what it was asked: the person moves it at the same
 * time, or it refuses a write, as Safari throws on a hundred in ten seconds.
 * So any landing ends the panel's move, and one on another entry than the
 * move's stands that entry alone, the writes waiting on the move dropped, as
 * a tab reloaded there would; a write refused leaves only the entry standing
 * held, so the panel never travels to an entry the browser may not hold; and
 * a move refused stands the entry the browser stayed on. Either way the
 * entries around it are learnt again as the browser lands on them.
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

/** The tab's history as the panel's adapter, and the way to stop following the browser, which the web root takes as the tab's app closes. */
export interface BrowserHistory<State> extends HistoryAdapter<State> {
  readonly dispose: () => void;
}

/** Runs one of the browser's history calls, answering whether it ran rather than throwing where the browser refused it. */
function browserDid(call: () => void): boolean {
  try {
    call();
    return true;
  } catch (error) {
    console.warn(
      "The browser refused a history call; the panel's history holds only where it stands.",
      error,
    );
    return false;
  }
}

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
export function browserHistory<State>(limit: number = HISTORY_LIMIT): BrowserHistory<State> {
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

  // Whether the browser refused a write, or a move, since the history last stood, which the next stand answers.
  let refused = false;
  let stayed = false;
  // The history holding only the entry `next` stands on, kept as the same object so the panel, already on it, does not move.
  const onlyStanding = (next: HistorySnapshot<State>): HistorySnapshot<State> => {
    const standing = next.entries[next.at];
    if (standing === undefined) return next;
    base += next.at;
    return { entries: [standing], at: 0 };
  };
  // Note that every way in that reaches the browser ends here, so a refusal made on the way is answered once it stands.
  const stand = (asked: HistorySnapshot<State>) => {
    let next = asked;
    // Note that a refused move left the browser where it stood, so that entry stands, as a tab reloaded there would.
    if (stayed) next = alone(savedEntry<State>());
    else if (refused) next = onlyStanding(asked);
    refused = false;
    stayed = false;
    if (next.entries === snapshot.entries && next.at === snapshot.at) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  const write = (kind: Write, entry: HistoryEntry<State>, at: number) => {
    const saved: SavedEntry<State> = { state: entry.state, idx: base + at };
    highest = Math.max(highest, saved.idx);
    const apply = () => {
      const wrote = browserDid(() =>
        kind === WRITE.PUSH
          ? window.history.pushState(saved, "", entry.address)
          : window.history.replaceState(saved, "", entry.address),
      );
      refused ||= !wrote;
    };
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
    return alone(saved);
  };
  // The browser on `saved`'s entry with none around it known, as a tab reloaded there starts.
  const alone = (saved: SavedEntry<State> | undefined): HistorySnapshot<State> => {
    if (saved === undefined) return landed(undefined);
    highest = Math.max(highest, saved.idx);
    base = saved.idx;
    return { entries: [{ address: addressHere(), state: saved.state }], at: 0 };
  };

  const onPopState = (event: PopStateEvent) => {
    const saved = savedEntry<State>(event);
    if (travelling === undefined) {
      stand(landed(saved));
      return;
    }
    // Note that a traversal of the panel's own already stands, so landing where it went only lets what waits on it through.
    const arrived = saved?.idx === travelling;
    travelling = undefined;
    if (!arrived) {
      // Landing elsewhere is the browser's word over the panel's: with nothing waiting the entries held are the browser's,
      // and otherwise what waited to be written after the move is dropped, and with it what the entries around knew.
      stand(waiting.length === 0 ? landed(saved) : alone(saved));
      waiting.length = 0;
    }
    drain();
    stand(snapshot);
  };
  window.addEventListener("popstate", onPopState);

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
        if (browserDid(() => window.history.go(delta))) return;
        // What waited on the move was written for the entry it went to, which the browser never reached.
        travelling = undefined;
        waiting.length = 0;
        stayed = true;
      });
      stand({ entries: snapshot.entries, at });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => window.removeEventListener("popstate", onPopState),
  };
}
