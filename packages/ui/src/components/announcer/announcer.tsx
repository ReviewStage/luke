import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { VISUALLY_HIDDEN_ELEMENT, VisuallyHidden } from "../visually-hidden/visually-hidden.js";

export const ANNOUNCE = {
  POLITE: "polite",
  ALERT: "alert",
} as const;

export type Announce = (typeof ANNOUNCE)[keyof typeof ANNOUNCE];

const REGION_ROLE = {
  [ANNOUNCE.POLITE]: "status",
  [ANNOUNCE.ALERT]: "alert",
} as const satisfies Record<Announce, string>;

const REGION_LIVE = {
  [ANNOUNCE.POLITE]: "polite",
  [ANNOUNCE.ALERT]: "assertive",
} as const satisfies Record<Announce, string>;

interface Said {
  readonly id: number;
  readonly words: string;
}

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

function handOver(): void {
  const owner = owners[0];
  if (owner !== saying.owner) tell({ ...SILENT, owner });
}

export type Retire = () => void;

const NOTHING_TO_RETIRE: Retire = () => undefined;

function retire(level: Announce, id: number): void {
  if (saying[level]?.id !== id) return;
  tell({ ...saying, [level]: undefined });
}

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
  const draws = now.owner === self || now.owner === undefined;
  if (!draws) return null;
  return (
    <>
      <Region level={ANNOUNCE.POLITE} said={now.owner === self ? now.polite : undefined} />
      <Region level={ANNOUNCE.ALERT} said={now.owner === self ? now.alert : undefined} />
    </>
  );
}
