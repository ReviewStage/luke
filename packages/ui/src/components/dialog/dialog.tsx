import type { DialogRoot } from "@base-ui/react/dialog";
import {
  type Ref,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isComposingKey } from "../../composing-key.js";
import { motionHeld } from "../../motion-timing.js";
import type { PictureExpand } from "../../picture-expand.js";
import { replayMotion } from "../../replay-motion.js";
import { DialogContent, Dialog as ShadcnDialog } from "../../shadcn/dialog.js";
import { trappedTab } from "../../trapped-tab.js";
import { ANNOUNCE, announce, type Retire } from "../announcer/announcer.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import {
  DIALOG_ANSWERS,
  DIALOG_FOOT,
  type DialogFoot,
  DialogFootContext,
  type FootClaim,
} from "./dialog-foot.js";
import { useHeldFocus } from "./held-focus.js";

/**
 * dialog.tsx -- the window dimmed under one card that holds the keyboard
 * until it is put away: every modal's frame, whatever it asks.
 *
 * Every modal stands the same way, the way every desktop app's does: the
 * window dims, the card holds focus and keeps Tab among its own controls,
 * and Escape or a press that begins and ends on the dimmed window puts it
 * away, which hands focus back to whatever opened it if that still stands,
 * or, where the card's own act took it away, the row it stood in with it,
 * to where its owner says (`restoreTo`): the row after it, or the list's
 * head where none is left (`nextRowOrHead`).
 * A press that begins in the card and ends on the dimmed window, as a text
 * selection dragged out of the card does, puts nothing away. No key and no
 * press inside goes on to the window, because a window chord or a press on a
 * row would change what stands behind a card nobody has finished with. What
 * the card says, its own keys (Return in a field, Command-Return, the
 * arrows), and what a dismissal costs are the dialog's own.
 *
 * It is drawn by shadcn/ui's Base UI dialog (`../../shadcn/dialog.tsx`),
 * trapping focus, which hears Escape (never while an input method composes)
 * and a press that begins and ends on the dimmed window, and keeps a dialog
 * opened over another the one Escape reaches. Whether it stands is its
 * owner's (`open`), so what Base UI hears as a dismissal is handed to the
 * dialog's own `dismiss`, which decides whether the card goes; Tab's own
 * move among the card's controls, and handing focus back to what opened the
 * card, stay the dialog's. Its portal stands its card a render after the
 * dialog mounts, so what the card holds is read from inside it (the voice
 * picker's row scrolled into view), never from an effect of the dialog's
 * owner as it opens.
 *
 * The dialog stands while it is `open`, and as `open` falls the card and its
 * dimmed window fade out on the exit token, drawn and taking no press until
 * the fade has run, focus handed back to what opened the card once it has,
 * so it never lands on something the act that closed the card is about to
 * take away. Reduced motion and a capture run, which zero the tokens, take it
 * away at once. An owner whose card holds state or reads data while it is
 * drawn hears `onExited` once the card is gone, and takes it out then. An
 * owner always passes `open`: one that mounts the dialog to open it and
 * unmounts it to close it passes `true`, and its card goes at once. Asked away while it
 * is at work, by Escape or the dimmed window, the card swells for a moment,
 * so the press is answered even though the owner keeps it open. A dialog
 * whose act was refused shakes its card once as the refusal lands, so the
 * failure reads before its words are read. A dialog holding a draft, words
 * written and not yet sent, answers the first Escape or press on the dimmed
 * window with the same swell and stays, its draft as it was, and is put away
 * by the next one; a reader is told so through the window's `Announcer`, since a card that stays is otherwise a press gone nowhere. The card is the
 * profile's dialog card, its inset and its corners, at a question's
 * measure, wider for a note being written, fitted edge to edge to a file
 * shown, or as large as the window allows, a small margin from the window's
 * edges and its top clear of the traffic lights where the window draws them
 * (`--luke-dialog-window-top`, which the window sets); what it holds lays
 * itself out inside. A dialog that takes files dropped on the dimmed window rings its
 * card while a drag it would take is over it.
 *
 * A dialog that asks something draws its parts in the card's own slots: its
 * `title` at its head, which names the card, and its `actions` at its foot,
 * Cancel first and the act last at the foot's end, each answer at a common
 * width so a short verb is not a smaller target than Cancel beside it, with a
 * tool of the dialog's own (attaching a screenshot) at the foot's start where
 * it has one. What it holds between them is the part that gives way and
 * scrolls (a `min-h-0` middle of the card, with the head and the foot outside
 * it), so its title and its answers stay on screen however short the
 * window is. A picture's card opened from its tile grows from the tile
 * and goes back into it (`expand`), in place of the fade and rise every other
 * card opens with. A dialog whose head is more than words (a picture's bar, a title
 * holding a chip) draws its own and names the card by it (`labelledBy`).
 */

/** What the card is to assistive technology: a dialog, or a question that must be answered before going on. */
export const DIALOG_ROLE = {
  DIALOG: "dialog",
  ALERT_DIALOG: "alertdialog",
} as const;

export type DialogRole = (typeof DIALOG_ROLE)[keyof typeof DIALOG_ROLE];

/**
 * How wide the card stands: a question's measure, wider for a note being
 * written, wider still for a composer card with chips at its foot, fitted
 * to a file shown edge to edge, or as large as the window allows, a file
 * shown edge to edge in a card a small margin from the window's edges, its
 * top clear of what the window draws over it.
 */
export const DIALOG_SIZE = {
  CONFIRM: "confirm",
  WIDE: "wide",
  COMPOSER: "composer",
  MEDIA: "media",
  WINDOW: "window",
} as const;

export type DialogSize = (typeof DIALOG_SIZE)[keyof typeof DIALOG_SIZE];

/** What names the card: the title drawn at its head, or the id of a head the dialog draws itself. */
type DialogName =
  | {
      /** The card's title, drawn at its head in the dialog's type. */
      title: string;
      labelledBy?: undefined;
    }
  | {
      title?: undefined;
      /** The id of the card's title, where the dialog draws its own head. */
      labelledBy: string;
    };

/** What an owner may ask of its dialog: to be put away as Escape would put it away, as a field that keeps Escape for itself asks. */
export interface DialogHandle {
  dismiss: () => void;
}

/**
 * Where focus goes once a card is gone if what opened it has left the
 * window meanwhile: worked out from what opened it as the card opens, while
 * that still stands, and answered once the card is gone; nothing leaves
 * focus where it fell.
 */
export type RestoreTo = (opener: HTMLElement) => () => HTMLElement | null;

/** What in a row takes focus: the item a list's arrows walk, else its first control. */
const ROW_FOCUS =
  "[data-roving-item], button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]";

/** What Base UI hears as a dismissal: Escape, and a press on the dimmed window. */
const DISMISSAL: ReadonlySet<DialogRoot.ChangeEventReason> = new Set([
  "escape-key",
  "outside-press",
]);

/**
 * The card's own looks over the shadcn card: its measures by size (a
 * composer's, on a phone, reaching back half the dimmed window's margin at
 * a card's snug inset), a picture's grow standing its entrance down, the
 * ring a drag it would take draws, the swell and the shake, and no ring of
 * its own, since it holds focus for its controls. `luke-dialog` names it
 * for what finds a card in the page.
 */
const CARD_LOOK = [
  "luke-dialog focus:outline-none",
  "data-[size=wide]:w-dialog-wide data-[size=wide]:gap-3",
  "data-[size=composer]:w-dialog-composer data-[size=composer]:gap-3",
  "room-narrow:data-[size=composer]:-ml-dialog-reach room-narrow:data-[size=composer]:-mr-dialog-reach room-narrow:data-[size=composer]:w-dialog-composer-reach room-narrow:data-[size=composer]:pt-card-inset-snug room-narrow:data-[size=composer]:pr-card-inset-snug room-narrow:data-[size=composer]:pb-card-inset-snug room-narrow:data-[size=composer]:pl-card-inset-snug",
  "data-[size=media]:w-auto data-[size=media]:min-w-dialog-media-min data-[size=media]:max-w-dialog-media-max data-[size=media]:gap-0 data-[size=media]:overflow-hidden data-[size=media]:p-0",
  "data-[size=window]:w-auto data-[size=window]:max-h-none data-[size=window]:max-w-none data-[size=window]:place-self-stretch data-[size=window]:gap-0 data-[size=window]:overflow-hidden data-[size=window]:p-0 data-[size=window]:mx-luke-12 data-[size=window]:mb-luke-12 data-[size=window]:mt-dialog-window-top @min-[1024px]/luke-dialog-room:data-[size=window]:mx-luke-16 @min-[1024px]/luke-dialog-room:data-[size=window]:mb-luke-16",
  "data-[expanding=true]:animate-none",
  "data-[dropping=true]:shadow-dialog-drop",
  "data-[nudge=true]:animate-dialog-nudge",
  "data-[refused=true]:animate-dialog-shake",
].join(" ");

/**
 * The middle: what the card holds between its head and its foot, the one part
 * that gives way and scrolls, laid out as the card is (a column at the card's
 * own gap) so what it holds keeps the spacing it had as the card's children.
 * Note that it clips what it holds, so it draws a control's ring inside the
 * control, as a `Card` does, rather than clipped at the edge; that a
 * picture's card (`media`, `window`) is fitted edge to edge and draws its own head and
 * scroller, so its middle lays nothing out; and that a composer's card
 * does not scroll its middle, because its chips hang lists (the repository's,
 * the `@` menu) past the card's inner edges, which a scroller would clip and
 * a picker would take for its room (`roomAround`). Its middle still gives
 * way to the card's height, as `.new-task` did standing in the card itself,
 * so its field yields to a short window (`desktop.css`) and its foot stays.
 */
const MIDDLE =
  "flex min-h-0 flex-1 flex-col gap-[inherit] overflow-x-hidden overflow-y-auto overscroll-contain [--luke-focus-ring-offset:var(--luke-focus-ring-inset)] data-[size=media]:contents data-[size=window]:contents data-[size=composer]:overflow-visible";

/** What marks a card's own veil, the room around a file shown in a card the window's size. */
const VEIL_ATTRIBUTE = "data-dialog-veil";

/**
 * What an owner spreads on the part of its card that stands for the dimmed
 * window, the room around a file shown in a card the window's size
 * (`DIALOG_SIZE.WINDOW`), which covers most of the dimmed window: a press
 * that goes down and comes up on it puts the card away as one on the dimmed
 * window does, and one that lands on what it holds does not.
 */
export const DIALOG_VEIL = { [VEIL_ATTRIBUTE]: "" } as const;

/** The dimmed window under a card the window's size, which keeps its own margins (`CARD_LOOK`). */
const WINDOW_ROOM = "luke-dialog-backdrop p-0";

/** What a reader is told when a draft holds the card back. */
const HELD_NOTICE = "Your draft is kept. Press Escape again to close.";

/** What a dialog is told: who names it, whether it is at work, where focus lands, and how it is put away. */
export type DialogProps = DialogName & {
  ref?: Ref<DialogHandle> | undefined;
  /** Whether the card stands; falling, it fades out before it goes. */
  open: boolean;
  role?: DialogRole | undefined;
  /** How wide the card stands, a question's measure unless asked. */
  size?: DialogSize | undefined;
  /** The id of what the card says, where it is a question. */
  describedBy?: string | undefined;
  /** Whether the dialog is at work, its controls stilled. */
  busy?: boolean | undefined;
  /** Whether its act was refused and the refusal stands; each time it turns true the card shakes. */
  refused?: boolean | undefined;
  /** Whether it holds a draft, which the first Escape or press on the dimmed window keeps it open for. */
  holding?: boolean | undefined;
  /** The control that takes focus as the card opens and again whenever the dialog is no longer busy. */
  initialFocus?: React.RefObject<HTMLElement | null> | undefined;
  /** Escape or a press on the dimmed window: the dialog decides what putting it away costs. */
  onDismiss: () => void;
  /** Where focus goes once the card is gone if what opened it has left the window meanwhile (`nextRowOrHead`); none leaves it where it fell. */
  restoreTo?: RestoreTo | undefined;
  /** Its fade has run and it is gone, which an owner whose card holds state or reads data lets go of it on. */
  onExited?: (() => void) | undefined;
  /** The dialog's own keys, heard after Tab and Escape and never while an input method composes. */
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** What the dimmed window does with a drag, for a dialog that takes files dropped anywhere on it. */
  dropTarget?:
    | Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">
    | undefined;
  /** Whether a drag the dimmed window would take is over it, which rings the card that will take it. */
  dropping?: boolean | undefined;
  /** The answers at the card's foot, at its end: Cancel first, the act last. */
  actions?: React.ReactNode;
  /** A tool of the dialog's own at the foot's start, before its answers. */
  actionsStart?: React.ReactNode;
  /** The tile a picture's card grows from in place of its own entrance (`usePictureExpand`); none for every other dialog. */
  expand?: PictureExpand | undefined;
  children: React.ReactNode;
};

/** What the card plays as it answers: a swell for a dismissal it holds back, a shake for an act refused. */
const CARD_ANSWER = {
  NUDGE: "data-nudge",
  REFUSED: "data-refused",
} as const;

/**
 * Nudges the card, once per attempt, when it is asked away and stays: a
 * brief swell that says it heard and will not go yet, rather than a press
 * that went nowhere.
 */
function nudge(card: HTMLDivElement | null): void {
  if (card !== null) replayMotion(card, CARD_ANSWER.NUDGE);
}

/**
 * Shakes the card once each time `refused` turns true, so a refusal landing
 * again after a retry shakes it again; one already standing as the card
 * opens plays nothing over its entrance.
 */
function useRefusalShake(card: React.RefObject<HTMLDivElement | null>, refused: boolean): void {
  const was = useRef(refused);
  useLayoutEffect(() => {
    if (refused && !was.current && card.current !== null) {
      replayMotion(card.current, CARD_ANSWER.REFUSED);
    }
    was.current = refused;
  }, [card, refused]);
}

/** Whether `element` can take focus: in the window, and in no part of it put out of reach, as a row leaving its list is. */
function reachable(element: HTMLElement): boolean {
  return element.isConnected && element.closest("[inert]") === null;
}

/** What takes focus in `row`, where it stands within reach. */
function rowFocus(row: Element | null): HTMLElement | null {
  if (!(row instanceof HTMLElement) || !reachable(row)) return null;
  return row.querySelector<HTMLElement>(ROW_FOCUS);
}

/** A row the opener stood in, the row after it, and the list holding them, as they stood as the card opened. */
interface RowPlace {
  row: Element;
  next: Element | null;
  list: Element;
}

/** The row after `place`'s, or its list's first row but its own, whichever still stands within reach. */
function neighbourIn({ row, next, list }: RowPlace): HTMLElement | null {
  const after = rowFocus(next);
  if (after !== null) return after;
  for (const each of list.children) {
    const head = each === row ? null : rowFocus(each);
    if (head !== null) return head;
  }
  return null;
}

/** Every row `opener` stands in, innermost first: a reply in its thread, then the thread in its list. */
function rowPlaces(opener: HTMLElement): RowPlace[] {
  const row = opener.closest("li");
  const list = row?.parentElement;
  if (row === null || list === null || list === undefined) return [];
  return [{ row, next: row.nextElementSibling, list }, ...rowPlaces(list)];
}

/**
 * The row after the one `opener` stands in, or the first row of its list
 * where that one is gone too, as they stand once the card is gone: where
 * focus goes when the card's act took the opener's row with it (a task
 * deleted, an Inbox item resolved), so the keyboard carries on down the list
 * rather than falling to the window. A row is the list item the opener
 * stands in, and one leaving its list, out of reach, is passed over; where
 * the act took the whole list with it, as a thread goes with the one comment
 * it held, the row around that list is looked past the same way, and so on
 * out. An opener in no list has no neighbour.
 */
export const nextRowOrHead: RestoreTo = (opener) => {
  const places = rowPlaces(opener);
  return () => {
    for (const place of places) {
      const found = neighbourIn(place);
      if (found !== null) return found;
    }
    return null;
  };
};

/** What opened the card, and where focus goes in its place should it be gone. */
interface Opener {
  element: HTMLElement;
  restore: (() => HTMLElement | null) | undefined;
}

/** Whether focus has gone somewhere of its own outside the card, where a hand-back leaves it, since the card no longer holds it to give back. */
function focusTaken(card: HTMLElement | null): boolean {
  const now = document.activeElement;
  if (!(now instanceof HTMLElement) || now === document.body || !reachable(now)) return false;
  return !(card?.contains(now) ?? false);
}

/**
 * Hands focus back to what opened the card and forgets it, or, where that
 * has left the window meanwhile, to where `restoreTo` said, if anywhere;
 * answers what opened it, for an unmount to look again.
 */
function handBack(
  invoker: React.RefObject<Opener | null>,
  card: HTMLElement | null,
): Opener | null {
  const back = invoker.current;
  invoker.current = null;
  if (back === null || focusTaken(card)) return back;
  const to = reachable(back.element) ? back.element : back.restore?.();
  to?.focus({ preventScroll: true });
  return back;
}

/**
 * Remembers what held focus as the dialog opened, and where focus goes
 * should that be gone by the time the card is (`restoreTo`), and answers the
 * hand-back the dialog runs once its card is gone; an unmount hands it back
 * too, since a card its owner takes away has no exit of its own.
 *
 * Note that the invoker is read in a layout effect, because the card's own
 * focus lands in a later effect, and once it has, the control that opened
 * the card no longer holds it; that a card asked open again before its
 * fade has run keeps the invoker it had, since focus by then stands in the
 * card; and that focus goes back only once the card is gone, after Base
 * UI's own have let go of the card's trap, which would otherwise take
 * focus back into the card on its way out, and after the act that closed
 * it has taken away what it took.
 */
function useInvokerFocus(
  open: boolean,
  restoreTo: RestoreTo | undefined,
  card: React.RefObject<HTMLElement | null>,
): () => void {
  const invoker = useRef<Opener | null>(null);
  useLayoutEffect(() => {
    if (!open || invoker.current !== null) return;
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return;
    invoker.current = { element, restore: restoreTo?.(element) };
  }, [open, restoreTo]);
  // Note that an unmount looks again a microtask on, once the commit that
  // unmounts it has taken out what it takes, because a card drawn inside the
  // row its act took away unmounts with that row while the row still stands,
  // so focus handed back to it falls to the window as the row goes.
  useLayoutEffect(
    () => () => {
      const back = handBack(invoker, card.current);
      const restore = back?.restore;
      if (back === null || restore === undefined) return;
      queueMicrotask(() => {
        if (reachable(back.element) || focusTaken(null)) return;
        restore()?.focus({ preventScroll: true });
      });
    },
    [card],
  );
  return () => {
    handBack(invoker, card.current);
  };
}

/**
 * The card's foot as what it holds may claim it: the slot a question is
 * drawn into, and the question standing there, if one is.
 *
 * Note that what held focus as the question was first asked is kept across
 * the question claiming the foot again as its answer runs, so the card can
 * hand focus back to it once the foot is let go.
 */
function useFootClaim(): {
  foot: DialogFoot;
  claimed: FootClaim | undefined;
  asker: React.RefObject<Opener | null>;
  setSlot: (slot: HTMLDivElement | null) => void;
} {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const [claimed, setClaimed] = useState<FootClaim | undefined>(undefined);
  const asker = useRef<Opener | null>(null);
  const claim = useCallback((next: FootClaim) => {
    if (asker.current === null && document.activeElement instanceof HTMLElement) {
      asker.current = { element: document.activeElement, restore: undefined };
    }
    setClaimed(next);
    return () => setClaimed((standing) => (standing === next ? undefined : standing));
  }, []);
  const foot = useMemo(() => ({ slot, claim }), [slot, claim]);
  return { foot, claimed, asker, setSlot };
}

/**
 * The dimmed window and the card over it, drawn in Base UI's portal over
 * `document.body` so no stacking context of the surface that opened it can
 * clip or cover it.
 * Focus lands on `initialFocus`, or on the card itself where there is none,
 * and goes to the card while `busy` stills the controls, so it never falls
 * to the window behind.
 */
export function Dialog({
  ref,
  open,
  role = DIALOG_ROLE.DIALOG,
  size = DIALOG_SIZE.CONFIRM,
  title,
  labelledBy,
  describedBy,
  busy = false,
  refused = false,
  holding = false,
  initialFocus,
  onDismiss,
  restoreTo,
  onExited,
  onKeyDown,
  dropTarget,
  dropping = false,
  actions,
  actionsStart,
  expand,
  children,
}: DialogProps): React.JSX.Element | null {
  const card = useRef<HTMLDivElement | null>(null);
  // Where a press on the card went down, so one that ends on its veil is a dismissal only where it began there.
  const pressedOn = useRef<EventTarget | null>(null);
  // Note that the card stands a render after the dialog mounts, because
  // Base UI's portal makes its node first, so what reaches the card waits
  // for it to stand.
  const [drawn, setDrawn] = useState(false);
  const titleId = useId();
  // Whether a draft has already held the card back once, which the next
  // dismissal goes through; a card opened again holds its draft afresh.
  const [held, setHeld] = useState(false);
  if (held && (!holding || !open)) setHeld(false);
  // What the held draft's notice said, taken back once the card closes or goes, which ends what it told.
  const heldSaid = useRef<Retire>(() => undefined);
  useEffect(() => {
    if (!open) heldSaid.current();
  }, [open]);
  useEffect(() => () => heldSaid.current(), []);

  const handBackFocus = useInvokerFocus(open, restoreTo, card);
  const { foot, claimed, asker, setSlot } = useFootClaim();
  // A question standing at the foot holds the card as the card's own answers would.
  const still = busy || claimed?.busy === true;
  // Note that a card on its way out holds no focus of its own, which goes back to what opened it once it is gone.
  useHeldFocus<HTMLElement>(claimed?.focus ?? initialFocus ?? card, open && drawn && !still);
  useHeldFocus(card, open && drawn && still);
  // Note that this runs after the card takes focus back as the foot is let
  // go, so what asked the question has it where it still stands.
  useEffect(() => {
    if (claimed === undefined) handBack(asker, card.current);
  }, [claimed, asker]);
  useRefusalShake(card, refused || claimed?.refused === true);
  // Note that this runs before the card's first paint, so its own entrance
  // is stood down before a frame of it is drawn.
  useLayoutEffect(() => {
    if (drawn && expand !== undefined && card.current !== null) expand.grow(card.current);
  }, [drawn, expand]);

  // Note that the owner still hears a dismissal asked while the dialog is
  // at work and decides what it costs; the nudge answers it, which no owner
  // takes. A draft's hold is the dialog's own, so the owner hears only the
  // dismissal that goes through.
  const dismiss = () => {
    // A question at the foot is what Escape takes back, the card staying.
    if (claimed !== undefined) {
      if (!claimed.withdraw()) nudge(card.current);
      return;
    }
    if (busy) {
      nudge(card.current);
      onDismiss();
      return;
    }
    if (holding && !held) {
      setHeld(true);
      nudge(card.current);
      heldSaid.current = announce(ANNOUNCE.POLITE, HELD_NOTICE);
      return;
    }
    onDismiss();
  };
  useImperativeHandle(ref, () => ({ dismiss }));

  // Note that the owner hears it gone only once the card has stood, because
  // one that never opened has left nothing to let go of.
  const stood = useRef(false);
  useEffect(() => {
    if (open) stood.current = true;
  }, [open]);
  const exited = () => {
    handBackFocus();
    if (!stood.current) return;
    stood.current = false;
    onExited?.();
  };
  // Note that a card taken away in the render that closes it is heard here,
  // because Base UI never sees it leave.
  useEffect(() => {
    if (!open && motionHeld()) exited();
  });

  // Note that reduced motion and a capture run take the card away in the
  // render that closes it, rather than a frame later once Base UI finds no
  // fade to wait on.
  if (!open && motionHeld()) return null;

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Note that no key pressed in the card goes on to the window. A button's
    // own Enter and Space are its default action, which this leaves alone.
    event.stopPropagation();
    // A key an input method is composing with is the method's, not the dialog's.
    if (isComposingKey(event)) return;
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    // Note that Escape is Base UI's, heard on the nearest card alone and
    // handed to `dismiss` (`onOpenChange`), so the window behind it stays as
    // it was.
    if (event.key === "Escape") return;
    onKeyDown?.(event);
  };

  return (
    <ShadcnDialog
      open={open}
      // Note that the card traps focus without locking the page's scroll,
      // as it always has: the dimmed window already takes every press
      // outside the card, and a lock would shift a page with a scrollbar.
      modal="trap-focus"
      onOpenChange={(open, details) => {
        if (!open && DISMISSAL.has(details.reason)) dismiss();
      }}
      onOpenChangeComplete={(done) => {
        if (!done) exited();
      }}
    >
      <DialogContent
        ref={(node: HTMLDivElement | null) => {
          card.current = node;
          setDrawn(node !== null);
        }}
        className={CARD_LOOK}
        data-size={size}
        data-dropping={dropping}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        aria-describedby={describedBy}
        aria-busy={busy}
        tabIndex={-1}
        initialFocus={() => (busy ? card.current : (initialFocus?.current ?? card.current))}
        // Note that focus goes back to what opened the card through
        // `useInvokerFocus`, because a card its owner unmounts closes with no
        // close of Base UI's own to hand it back.
        finalFocus={false}
        onKeyDown={keyDown}
        onPointerDown={(event) => {
          pressedOn.current = event.target;
        }}
        onClick={(event) => {
          const { target } = event;
          if (target !== pressedOn.current || !(target instanceof Element)) return;
          if (target.hasAttribute(VEIL_ATTRIBUTE)) dismiss();
        }}
        viewport={{
          className: size === DIALOG_SIZE.WINDOW ? WINDOW_ROOM : "luke-dialog-backdrop",
          // Note that a press goes no further than the dialog, because the
          // surface that opened it is its parent in React's tree and may take
          // presses of its own.
          onClick: (event) => event.stopPropagation(),
          ...dropTarget,
        }}
      >
        {title === undefined ? null : (
          <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
            {title}
          </Text>
        )}
        <div
          data-slot="dialog-body"
          data-size={size}
          className={MIDDLE}
          inert={claimed !== undefined}
        >
          <DialogFootContext.Provider value={foot}>{children}</DialogFootContext.Provider>
        </div>
        {claimed !== undefined || (actions === undefined && actionsStart === undefined) ? null : (
          <div className={DIALOG_FOOT}>
            {actionsStart}
            <div className={DIALOG_ANSWERS}>{actions}</div>
          </div>
        )}
        <div ref={setSlot} className={DIALOG_FOOT} hidden={claimed === undefined} />
      </DialogContent>
    </ShadcnDialog>
  );
}
