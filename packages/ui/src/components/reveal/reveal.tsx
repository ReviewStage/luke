import { createContext, type ReactNode, type RefObject, useContext, useMemo, useRef } from "react";
import {
  LIST_MOTION_WAY,
  ListMotion,
  motionKey,
  motionRows,
  useLeaving,
} from "../list-motion/list-motion.js";

interface Revealed {
  readonly key: string;
  readonly rows: ReactNode;
}

const RevealAreaContext = createContext<RefObject<HTMLElement | null> | undefined>(undefined);

export function revealArea(): ReturnType<typeof motionRows> {
  return motionRows();
}

export function RevealArea({
  root,
  own = false,
  children,
}: {
  root: RefObject<HTMLElement | null>;
  own?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const outer = useContext(RevealAreaContext);
  return (
    <RevealAreaContext.Provider value={own ? root : (outer ?? root)}>
      {children}
    </RevealAreaContext.Provider>
  );
}

const HIDDEN = Symbol("hidden");

let minted = 0;

function mintKey(): string {
  minted += 1;
  return `reveal-${minted}`;
}

function RevealedRows({ revealed }: { revealed: readonly Revealed[] }): React.JSX.Element {
  const drawn = useLeaving(revealed, (each) => each.key);
  return (
    <>
      {drawn.map(({ key, value }) => (
        <div key={key} className="ui-reveal" {...motionKey(key)} {...motionRows()}>
          {value.rows}
        </div>
      ))}
    </>
  );
}

function RevealMotion({
  revealed,
  children,
}: {
  revealed: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const area = useContext(RevealAreaContext);
  const fallback = useRef<HTMLElement | null>(null);
  const keys = useRef(new Map<string, string>());
  let key: string | undefined;
  if (revealed !== undefined) {
    key = keys.current.get(revealed) ?? mintKey();
    keys.current.set(revealed, key);
  }
  const listed = useMemo<readonly Revealed[]>(
    () => (key === undefined ? [] : [{ key, rows: children }]),
    [key, children],
  );
  return (
    <ListMotion root={area ?? fallback} change={key ?? HIDDEN} way={LIST_MOTION_WAY.UNROLL}>
      <RevealedRows revealed={listed} />
    </ListMotion>
  );
}

const SHOWN = "shown";

export function Reveal({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <RevealMotion revealed={shown ? SHOWN : undefined}>{children}</RevealMotion>;
}

export function RevealChoice<Value extends string>({
  value,
  children,
}: {
  value: Value;
  children: (value: Value) => ReactNode;
}): React.JSX.Element {
  const rows = children(value);
  const none = rows === null || rows === undefined || rows === false;
  return <RevealMotion revealed={none ? undefined : value}>{rows}</RevealMotion>;
}
