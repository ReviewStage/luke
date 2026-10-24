import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { VISUALLY_HIDDEN_ELEMENT, VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * announcer.tsx -- the window's one pair of live regions, and `announce`, the one way words are read aloud through them.
 *
 * Whatever a reader should hear without moving to it (a copy made, a tab
 * moved, a setting refused) is handed to `announce` with how loudly it is
 * said: `ANNOUNCE.POLITE` for what was done or is asked, read once the
 * reader is free, and `ANNOUNCE.ALERT` for what was refused, read at once.
 * Both regions are drawn by `Announcer`, empty from the first render,
 * because a live region drawn already holding its words is one a screen
 * reader may never read; one `Announcer` draws them per window, and any
 * other mounted beside it draws nothing until the one drawing them leaves.
 * Nothing is said before an `Announcer` stands. Each region spells its
 * `aria-live` out beside its role, because a modal dialog hides the rest of
 * the window from a reader but for what carries that attribute, and words
 * said while a dialog is open must still be heard.
 *
 * Each announcement lands as a node of its own in its region, so the same
 * words said twice are read twice: a reader hears a node added, not a text
 * left as it was. A region holds only its newest words, so a burst of
 * polite ones always ends on the last, and an alert takes the polite
 * region's words with it, interrupting what was still waiting to be read.
 * Whoever said words takes them back once they stop being true, so a
 * region never holds a refusal a retry answered.
 *
 * The words are text drawn like any other, so session replay masks them
 * with the rest (`@luke/panel`'s `session-replay.ts`).
 */

/** How loudly words are said: politely once the reader is free, or as an alert at once. */
export const ANNOUNCE = {
  POLITE: "polite",
  ALERT: "alert",
} as const;

export type Announce = (typeof ANNOUNCE)[keyof typeof ANNOUNCE];

/** The live role each region is drawn with. */
const REGION_ROLE = {
  [ANNOUNCE.POLITE]: "status",
  [ANNOUNCE.ALERT]: "alert",
} as const satisfies Record<Announce, string>;

/** The live setting each region spells out beside its role. */
const REGION_LIVE = {
  [ANNOUNCE.POLITE]: "polite",
  [ANNOUNCE.ALERT]: "assertive",
} as const satisfies Record<Announce, string>;

/** One announcement: its words, and the count that makes it a node of its own. */
interface Said {
  readonly id: number;
  readonly words: string;
}

/** What the regions say, and which `Announcer` draws them. */
interface Saying {
  readonly owner: object | undefined;
  readonly polite: Said | undefined;
  readonly alert: Said | undefined;
}

const SILENT: Saying = { owner: undefined, polite: undefined, alert: undefined };

let saying: Saying = SILENT;
let said = 0;
const owners: object[] = [];
const listeners = new Set<() => void>();

function tell(next: Saying): void {
  saying = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Saying {
  return saying;
}

/** Hands the regions to the oldest `Announcer` still standing, its regions drawn empty. */
function handOver(): void {
  const owner = owners[0];
  if (owner !== saying.owner) tell({ ...SILENT, owner });
}

/** Takes back what an announcement still says, once what it said is no longer so. */
export type Retire = () => void;

const NOTHING_TO_RETIRE: Retire = () => undefined;

/** Empties `level`'s region where it still says announcement `id`, and leaves any newer words standing. */
function retire(level: Announce, id: number): void {
  if (saying[level]?.id !== id) return;
  tell({ ...saying, [level]: undefined });
}

/**
 * Says `words` through the window's region for `level`; nothing where they
 * are empty or no `Announcer` stands. Answers how to take them back, which
 * a caller does once they stop being true (a refusal answered by a retry,
 * a tally whose query was cleared), so they are not left in the region for
 * a reader to find; words said since are never taken with them.
 */
export function announce(level: Announce, words: string): Retire {
  const spoken = words.trim();
  if (spoken === "" || saying.owner === undefined) return NOTHING_TO_RETIRE;
  said += 1;
  const now = { id: said, words: spoken };
  tell(
    level === ANNOUNCE.ALERT
      ? { owner: saying.owner, polite: undefined, alert: now }
      : { ...saying, polite: now },
  );
  return () => retire(level, now.id);
}

/**
 * Says `words` through `level`'s region each time they change, as a live
 * region would: words a component first draws are not said, and empty
 * words say nothing. Words it said are taken back once they change or the
 * component leaves, since they describe what it draws.
 */
export function useAnnounce(level: Announce, words: string): void {
  const last = useRef(words);
  const taken = useRef<Retire>(NOTHING_TO_RETIRE);
  useEffect(() => {
    if (words === last.current) return;
    last.current = words;
    taken.current();
    taken.current = announce(level, words);
  }, [level, words]);
  useEffect(() => () => taken.current(), []);
}

/** One announcement, as a node of its own, so the same words again are read again. */
function Region({ level, said }: { level: Announce; said: Said | undefined }) {
  return (
    <VisuallyHidden
      as={VISUALLY_HIDDEN_ELEMENT.P}
      role={REGION_ROLE[level]}
      aria-live={REGION_LIVE[level]}
    >
      {said === undefined ? null : <span key={said.id}>{said.words}</span>}
    </VisuallyHidden>
  );
}

/** The window's polite and alert regions; mount one with the window, as its toasts do. */
export function Announcer(): React.JSX.Element | null {
  const [self] = useState(() => ({}));
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  useLayoutEffect(() => {
    owners.push(self);
    handOver();
    return () => {
      owners.splice(owners.indexOf(self), 1);
      handOver();
    };
  }, [self]);
  // Note that one not yet standing draws its regions while none does, so the regions stand empty before anything is said into them.
  const draws = now.owner === self || now.owner === undefined;
  if (!draws) return null;
  return (
    <>
      <Region level={ANNOUNCE.POLITE} said={now.owner === self ? now.polite : undefined} />
      <Region level={ANNOUNCE.ALERT} said={now.owner === self ? now.alert : undefined} />
    </>
  );
}
