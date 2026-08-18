import { useCallback, useRef } from "react";
import type { PanelPresentation } from "./panel-state";
import { useStateWithRef } from "./use-state-with-ref";

/**
 * What every composer this hook can drive has to say. Busy is the in-flight
 * bit: a reply on its way back is answering that object, so nothing may
 * replace it underneath but ending it outright. A rejection is the last
 * send's reason, cleared by typing again.
 */
export interface PanelEntryBase {
  busy: boolean;
  rejection?: string;
}

/** Where giving up from the aside shape goes. */
export const PANEL_ENTRY_CANCEL = {
  /** The composer was not the drawn shape, so nothing to put away. */
  NONE: "none",
  /** Return to the panel this was opened from. */
  RESTORE: "restore",
  /** Leave entirely — a browser or nothing of Luke's. */
  LEAVE: "leave",
} as const;

export type PanelEntryCancel = (typeof PANEL_ENTRY_CANCEL)[keyof typeof PANEL_ENTRY_CANCEL];

/** What a send's reply means for the entry that is still on screen. */
export const PANEL_ENTRY_REPLY = {
  /** The entry that was sent is gone; the reply is spent. */
  IGNORE: "ignore",
  /** Still that entry, and the send was refused. */
  REJECT: "reject",
  /** Still that entry, and the send landed. */
  DELIVER: "deliver",
} as const;

export type PanelEntryReply = (typeof PANEL_ENTRY_REPLY)[keyof typeof PANEL_ENTRY_REPLY];

/**
 * Whether ending an entry released the hold it had on the panel. An entry
 * that ends while the pointer is already away would otherwise leave the
 * panel held open by nothing, because the pointer cannot leave a second time.
 */
export function panelEntryReleased<T>(previous: T | undefined, next: T | undefined): boolean {
  return previous !== undefined && next === undefined;
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

/**
 * Where cancel goes. Giving up from the aside shape returns you where you
 * were; giving up from inside the panel has nothing to put away.
 */
export function panelEntryCancel(input: { aside: boolean; restore: boolean }): PanelEntryCancel {
  if (!input.aside) return PANEL_ENTRY_CANCEL.NONE;
  return input.restore ? PANEL_ENTRY_CANCEL.RESTORE : PANEL_ENTRY_CANCEL.LEAVE;
}

/**
 * What a send's reply does. Whoever is writing now is not necessarily whoever
 * sent this one: Escape reaches the shape while a save is in flight, and so
 * does beginning again. A reply that outlived its own entry is spent.
 */
export function panelEntryReply(input: {
  stillHeld: boolean;
  rejection?: string;
}): PanelEntryReply {
  if (!input.stillHeld) return PANEL_ENTRY_REPLY.IGNORE;
  return input.rejection ? PANEL_ENTRY_REPLY.REJECT : PANEL_ENTRY_REPLY.DELIVER;
}

/**
 * Whether a delivered send should show its answer and then take its leave.
 * Saved from the aside shape, the panel comes back around what was just done;
 * with the pointer away, nothing else would ever ask it to close.
 */
export function panelEntrySettles(input: { aside: boolean; pointerInside: boolean }): boolean {
  return input.aside && !input.pointerInside;
}

export interface PanelEntryHost {
  /**
   * The shape this composer stands the panel down to — the slot, or the
   * feedback surface. Asking to write one thing is asking for one shape.
   */
  aside: PanelPresentation;
  pointerInside: () => boolean;
  presentation: () => PanelPresentation;
  /**
   * Called when an entry ends while the pointer is already away, so the hold
   * it had on the panel is released. The pointer cannot leave a second time.
   */
  onReleasedWhileAway: () => void;
  cancelHover: () => void;
  applyPresentation: (next: PanelPresentation) => void;
  restorePanel: () => void;
  leave: () => void;
  /**
   * Show the answer, then take the panel's leave — the pointer is usually
   * still on the button that was pressed, and where it is not, nothing else
   * would ever ask this panel to close.
   */
  settle: () => void;
  /**
   * Mirror of whether an entry is held, read by the presentation cluster
   * without waiting a render: a capsule close keeps the settings tab for a
   * half-written key or note, and nothing else.
   */
  heldRef: { current: boolean };
}

export interface UsePanelEntryOptions<T extends PanelEntryBase> extends PanelEntryHost {
  /**
   * Whether giving up from the aside shape returns to the panel. A key page
   * that was opened, or a composer asked for by voice, leaves instead.
   */
  restoresPanel: (entry: T) => boolean;
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

export interface PanelEntry<T extends PanelEntryBase> {
  entry: T | undefined;
  latest: () => T | undefined;
  apply: (next: T | undefined) => void;
  /** Stands the panel down to the aside shape, with this as what it holds. */
  begin: (next: T) => void;
  /** Stands the panel down without replacing what is held. */
  standDown: () => void;
  patch: (partial: Partial<T>) => void;
  cancel: () => void;
  commit: () => void;
}

/**
 * One composer lifecycle: begin, type, send, give up. A credential's slot and
 * a note to the founders are the same hold on the panel, parameterized by the
 * shape they stand down to, whether giving up restores the panel, what is
 * worth sending, and how a send is carried.
 */
export function usePanelEntry<T extends PanelEntryBase>(
  options: UsePanelEntryOptions<T>,
): PanelEntry<T> {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [entry, setEntry, latest] = useStateWithRef<T | undefined>(undefined);

  const apply = useCallback(
    (next: T | undefined) => {
      const host = optionsRef.current;
      const released = panelEntryReleased(latest(), next);
      setEntry(next);
      host.heldRef.current = next !== undefined;
      if (released && !host.pointerInside()) host.onReleasedWhileAway();
    },
    [latest, setEntry],
  );

  const standDown = useCallback(() => {
    const host = optionsRef.current;
    host.cancelHover();
    host.applyPresentation(host.aside);
  }, []);

  const begin = useCallback(
    (next: T) => {
      apply(next);
      standDown();
    },
    [apply, standDown],
  );

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
    const destination = panelEntryCancel({
      aside: host.presentation() === host.aside,
      restore: current !== undefined && host.restoresPanel(current),
    });
    apply(undefined);
    if (destination === PANEL_ENTRY_CANCEL.RESTORE) host.restorePanel();
    else if (destination === PANEL_ENTRY_CANCEL.LEAVE) host.leave();
  }, [apply, latest]);

  const commit = useCallback(() => {
    const host = optionsRef.current;
    const current = latest();
    if (!host.isSendable(current)) return;
    const sending = { ...current, busy: true, rejection: undefined };
    apply(sending);
    void host.send(sending).then((result) => {
      const reply = panelEntryReply({
        stillHeld: latest() === sending,
        ...(result.rejection ? { rejection: result.rejection } : {}),
      });
      if (reply === PANEL_ENTRY_REPLY.IGNORE) return;
      if (reply === PANEL_ENTRY_REPLY.REJECT) {
        apply({ ...sending, busy: false, rejection: result.rejection });
        return;
      }
      apply(undefined);
      host.onDelivered?.();
      // Everything after the delivery reads the host at the moment it runs,
      // not the moment the send landed: a host that holds `finish` through a
      // confirmation hands back a panel whose pointer may have moved.
      const finish = () => {
        const now = optionsRef.current;
        if (now.presentation() !== now.aside) return;
        now.restorePanel();
        if (!panelEntrySettles({ aside: true, pointerInside: now.pointerInside() })) return;
        now.cancelHover();
        now.settle();
      };
      if (host.afterDelivery) host.afterDelivery(finish);
      else finish();
    });
  }, [apply, latest]);

  return {
    entry,
    latest,
    apply,
    begin,
    standDown,
    patch,
    cancel,
    commit,
  };
}
