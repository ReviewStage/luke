import { useCallback, useRef } from "react";
import type { PanelPresentation } from "./panel-state";
import { useStateWithRef } from "./use-state-with-ref";

/**
 * What every composer this hook can drive has to say. Busy is the in-flight
 * bit: a reply on its way back is answering that object, so nothing may
 * replace it underneath but ending it outright. A rejection is the last
 * send's reason, cleared by typing again.
 */
interface PanelEntryBase {
  busy: boolean;
  rejection?: string | undefined;
}

/**
 * Whether the entry is open to being changed: something is held, and no reply
 * is on its way back answering it.
 */
export function panelEntryOpen<T extends PanelEntryBase>(
  entry: T | undefined,
): entry is T & { busy: false } {
  return entry !== undefined && !entry.busy;
}

interface PanelEntryHost {
  /** The shape this composer stands the panel down to. Asking to write one thing is asking for one shape. */
  aside: PanelPresentation;
  presentation: () => PanelPresentation;
  applyPresentation: (next: PanelPresentation) => void;
  /** Brings the panel back around the place the entry was begun from. */
  restorePanel: () => void;
  /** Brings the panel back as it stood. */
  leave: () => void;
}

/**
 * The panel a composer stands down from, without the shape it stands down to.
 * A hook that owns one composer knows its own aside; what it is handed is
 * everything about the panel it is leaving and coming back to.
 */
export type PanelEntrySurface = Omit<PanelEntryHost, "aside">;

interface UsePanelEntryOptions<T extends PanelEntryBase> extends PanelEntryHost {
  isSendable: (entry: T | undefined) => entry is T;
  send: (entry: T) => Promise<{ rejection?: string }>;
  /** After a send lands, before the panel is restored — the "Sent" line. */
  onDelivered?: () => void;
  /**
   * Owns the moment between a landed send and the panel's return. A host with
   * something to show — the feedback confirmation — holds `finish` and calls
   * it when the showing is done, or drops it if the shape was asked for again
   * meanwhile; a host with nothing to show leaves this out and the panel
   * returns at once. `finish` re-reads the presentation when it runs, so a
   * finish that outlived its moment restores nothing.
   */
  afterDelivery?: (finish: () => void) => void;
}

interface PanelEntry<T extends PanelEntryBase> {
  entry: T | undefined;
  latest: () => T | undefined;
  apply: (next: T | undefined) => void;
  /** Stands the panel down without replacing what is held. */
  standDown: () => void;
  patch: (partial: Partial<T>) => void;
  cancel: () => void;
  commit: () => void;
}

/**
 * One composer lifecycle: begin, type, send, give up. A note to the founders
 * is a hold on the panel, parameterized by the shape it stands down to, what
 * is worth sending, and how a send is carried.
 */
export function usePanelEntry<T extends PanelEntryBase>(
  options: UsePanelEntryOptions<T>,
): PanelEntry<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [entry, setEntry, latest] = useStateWithRef<T | undefined>(undefined);

  const apply = useCallback((next: T | undefined) => setEntry(next), [setEntry]);

  const standDown = useCallback(() => {
    const host = optionsRef.current;
    host.applyPresentation(host.aside);
  }, []);

  const patch = useCallback(
    (partial: Partial<T>) => {
      const current = latest();
      if (!panelEntryOpen(current)) return;
      apply({ ...current, ...partial, rejection: undefined });
    },
    [apply, latest],
  );

  const cancel = useCallback(() => {
    const host = optionsRef.current;
    const current = latest();
    // Giving up from the aside shape returns you where you were; giving up
    // from inside the panel has nothing to put away.
    const aside = host.presentation() === host.aside;
    apply(undefined);
    if (!aside) return;
    if (current !== undefined) host.restorePanel();
    else host.leave();
  }, [apply, latest]);

  const commit = useCallback(() => {
    const host = optionsRef.current;
    const current = latest();
    if (!host.isSendable(current)) return;
    const sending = { ...current, busy: true, rejection: undefined };
    apply(sending);
    void host.send(sending).then((result) => {
      // Whoever is writing now is not necessarily whoever sent this one:
      // Escape reaches the shape while a save is in flight, and so does
      // beginning again. A reply that outlived its own entry is spent.
      if (latest() !== sending) return;
      if (result.rejection) {
        apply({ ...sending, busy: false, rejection: result.rejection });
        return;
      }
      apply(undefined);
      host.onDelivered?.();
      // Everything after the delivery reads the host at the moment it runs,
      // not the moment the send landed: a host that holds `finish` through a
      // confirmation may find the presentation has moved on meanwhile.
      const finish = () => {
        const now = optionsRef.current;
        if (now.presentation() !== now.aside) return;
        now.restorePanel();
      };
      if (host.afterDelivery) host.afterDelivery(finish);
      else finish();
    });
  }, [apply, latest]);

  return {
    entry,
    latest,
    apply,
    standDown,
    patch,
    cancel,
    commit,
  };
}
