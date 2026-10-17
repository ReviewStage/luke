/**
 * history-adapter.ts -- a window's back-and-forward history behind one interface, so the desktop keeps it in memory and a browser can keep it in its URL.
 *
 * Each entry is an address, the place's Luke link where the window writes
 * one, and a state the window reopens the place from, the way a browser's
 * `history.state` sits beside its URL. The window decides what a visit is
 * and which entries it can still go to; the adapter only holds the entries
 * and where the window stands among them.
 *
 * The desktop's window keeps its history in memory for as long as it is
 * open, the way a browser tab does, writes no address, and holds no more
 * than `limit` entries, dropping the oldest first.
 */

/** One place the window has stood on: its link, where the window writes one, and the state it reopens from. */
export interface HistoryEntry<State> {
  readonly address: string | undefined;
  readonly state: State;
}

/** Every entry held, oldest first, and the one standing; `at` is -1 while none is. */
export interface HistorySnapshot<State> {
  readonly entries: readonly HistoryEntry<State>[];
  readonly at: number;
}

/** A window's history: read whole, written by a visit or a move along it, heard as it changes. */
export interface HistoryAdapter<State> {
  /** The history as it stands, the same object until it changes. */
  readonly current: () => HistorySnapshot<State>;
  /** A visit: clears the entries ahead and stands on `entry`. */
  readonly push: (entry: HistoryEntry<State>) => void;
  /** Puts `entry` in place of the one standing, or stands on it where none is. */
  readonly replace: (entry: HistoryEntry<State>) => void;
  /** Stands `delta` entries along, back where negative; nothing where no entry stands there. */
  readonly go: (delta: number) => void;
  /** Hears every change; answers the way to stop. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** The most entries an in-memory history holds by default. */
const HISTORY_LIMIT = 50;

const EMPTY: HistorySnapshot<never> = { entries: [], at: -1 };

/** A history held in memory, as the desktop's window keeps it, of at most `limit` entries. */
export function memoryHistory<State>(limit: number = HISTORY_LIMIT): HistoryAdapter<State> {
  let snapshot: HistorySnapshot<State> = EMPTY;
  const listeners = new Set<() => void>();
  const stand = (next: HistorySnapshot<State>) => {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    current: () => snapshot,
    push: (entry) => {
      const entries = [...snapshot.entries.slice(0, snapshot.at + 1), entry].slice(-limit);
      stand({ entries, at: entries.length - 1 });
    },
    replace: (entry) => {
      if (snapshot.at < 0) {
        stand({ entries: [entry], at: 0 });
        return;
      }
      stand({ entries: snapshot.entries.with(snapshot.at, entry), at: snapshot.at });
    },
    go: (delta) => {
      const at = snapshot.at + delta;
      if (delta === 0 || at < 0 || at >= snapshot.entries.length) return;
      stand({ entries: snapshot.entries, at });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
