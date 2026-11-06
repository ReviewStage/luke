import type { DialogRoot } from "@base-ui/react/dialog";
import {
  type ReactNode,
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
import { GLYPH } from "../../icons/glyph-registry.js";
import { motionHeld } from "../../motion-timing.js";
import type { PictureExpand } from "../../picture-expand.js";
import { replayMotion } from "../../replay-motion.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { DialogContent, Dialog as ShadcnDialog } from "../../shadcn/dialog.js";
import { trappedTab } from "../../trapped-tab.js";
import { ANNOUNCE, announce, type Retire } from "../announcer/announcer.js";
import { IconButton } from "../button/button.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";
import {
  DIALOG_ANSWERS,
  DIALOG_FOOT,
  type DialogFoot,
  DialogFootContext,
  DialogReplayUnmasked,
  type FootClaim,
} from "./dialog-foot.js";
import { useHeldFocus } from "./held-focus.js";

export const DIALOG_ROLE = {
  DIALOG: "dialog",
  ALERT_DIALOG: "alertdialog",
} as const;

export type DialogRole = (typeof DIALOG_ROLE)[keyof typeof DIALOG_ROLE];

export const DIALOG_SIZE = {
  CONFIRM: "confirm",
  WIDE: "wide",
  COMPOSER: "composer",
  MEDIA: "media",
  WINDOW: "window",
  SHEET: "sheet",
} as const;

export type DialogSize = (typeof DIALOG_SIZE)[keyof typeof DIALOG_SIZE];

type DialogName =
  | {
      title: string;
      subtitle?: string | undefined;
      closeLabel?: string | undefined;
      labelledBy?: undefined;
    }
  | {
      title?: undefined;
      subtitle?: undefined;
      closeLabel?: undefined;
      labelledBy: string;
    };

export interface DialogHandle {
  dismiss: () => void;
}

export type RestoreTo = (opener: HTMLElement) => () => HTMLElement | null;

const ROW_FOCUS =
  "[data-roving-item], button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]";

const DISMISSAL: ReadonlySet<DialogRoot.ChangeEventReason> = new Set([
  "escape-key",
  "outside-press",
]);

const CARD_LOOK = [
  "ui-dialog focus:outline-none",
  "data-[size=wide]:w-dialog-wide data-[size=wide]:gap-block-gap",
  "data-[size=composer]:w-dialog-composer data-[size=composer]:gap-3",
  "room-narrow:data-[size=composer]:-ml-dialog-reach room-narrow:data-[size=composer]:-mr-dialog-reach room-narrow:data-[size=composer]:w-dialog-composer-reach room-narrow:data-[size=composer]:pt-card-inset-snug room-narrow:data-[size=composer]:pr-card-inset-snug room-narrow:data-[size=composer]:pb-card-inset-snug room-narrow:data-[size=composer]:pl-card-inset-snug",
  "data-[size=media]:w-auto data-[size=media]:min-w-dialog-media-min data-[size=media]:max-w-dialog-media-max data-[size=media]:gap-0 data-[size=media]:overflow-hidden data-[size=media]:p-0",
  "data-[size=window]:w-auto data-[size=window]:max-h-none data-[size=window]:max-w-none data-[size=window]:place-self-stretch data-[size=window]:min-h-0 data-[size=window]:min-w-0 data-[size=window]:gap-0 data-[size=window]:rounded-none data-[size=window]:border-0 data-[size=window]:bg-transparent data-[size=window]:p-0 data-[size=window]:shadow-none data-[size=window]:ml-[max(var(--spacing-ui-16),env(safe-area-inset-left,0px))] data-[size=window]:mr-[max(var(--spacing-ui-16),env(safe-area-inset-right,0px))] data-[size=window]:mb-[max(var(--spacing-ui-16),env(safe-area-inset-bottom,0px)_-_var(--ui-keyboard-inset))] data-[size=window]:mt-[max(var(--spacing-dialog-window-top),env(safe-area-inset-top,0px))] @min-[1024px]/ui-dialog-room:data-[size=window]:mx-ui-48 @min-[1024px]/ui-dialog-room:data-[size=window]:mb-ui-24",
  "data-[size=sheet]:w-dialog-wide data-[size=sheet]:gap-0 data-[size=sheet]:rounded-none data-[size=sheet]:border-0 data-[size=sheet]:bg-transparent data-[size=sheet]:p-0 data-[size=sheet]:shadow-none data-[size=sheet]:animate-none data-[size=sheet]:data-ending-style:animate-sheet-leave",
  "data-[expanding=true]:animate-none",
  "data-[dropping=true]:shadow-dialog-drop",
  "data-[nudge=true]:animate-dialog-nudge",
  "data-[refused=true]:animate-dialog-shake",
].join(" ");

const MIDDLE =
  "flex min-h-0 flex-1 flex-col gap-[inherit] overflow-x-hidden overflow-y-auto overscroll-contain [--ui-focus-ring-offset:var(--ui-focus-ring-inset)] data-[size=media]:contents data-[size=window]:contents data-[size=sheet]:contents data-[size=composer]:overflow-visible";

const VEIL_ATTRIBUTE = "data-dialog-veil";

export const DIALOG_VEIL = { [VEIL_ATTRIBUTE]: "" } as const;

export function DialogCard({
  hug = false,
  children,
}: {
  hug?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`ui-dialog-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-dialog border border-border-strong bg-popover text-popover-foreground shadow-dialog ${hug ? "max-h-full max-w-full min-w-dialog-media-min" : "size-full"}`}
      data-hug={hug}
    >
      {children}
    </div>
  );
}

function DialogHead({
  titleId,
  subtitleId,
  title,
  subtitle,
  closeLabel,
  replayUnmasked,
  titleReplayMasked,
  onClose,
}: {
  titleId: string;
  subtitleId: string;
  title: string;
  subtitle: string | undefined;
  closeLabel: string | undefined;
  replayUnmasked: boolean;
  titleReplayMasked: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const words = (
    <Text variant={TEXT_VARIANT.DIALOG} as={TEXT_ELEMENT.H2} id={titleId}>
      <ReplayWords unmasked={replayUnmasked} masked={titleReplayMasked}>
        {title}
      </ReplayWords>
    </Text>
  );
  if (subtitle === undefined && closeLabel === undefined) return words;
  return (
    <div className="ui-dialog-head flex items-start gap-control-gap">
      <div className="flex min-w-0 flex-1 flex-col gap-tight-gap">
        {words}
        {subtitle === undefined ? null : (
          <Text id={subtitleId} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            <ReplayWords unmasked={replayUnmasked}>{subtitle}</ReplayWords>
          </Text>
        )}
      </div>
      {closeLabel === undefined ? null : (
        <span className="flex h-lh flex-none items-center text-dialog">
          <IconButton icon={<GLYPH.CLOSE />} label={closeLabel} onClick={onClose} />
        </span>
      )}
    </div>
  );
}

const WINDOW_ROOM = "ui-dialog-backdrop p-0";

const SHEET_ROOM =
  "ui-dialog-backdrop items-end justify-items-center p-0 animate-sheet-scrim data-ending-style:animate-sheet-leave";

function roomOf(size: DialogSize): string {
  if (size === DIALOG_SIZE.WINDOW) return WINDOW_ROOM;
  return size === DIALOG_SIZE.SHEET ? SHEET_ROOM : "ui-dialog-backdrop";
}

const HELD_NOTICE = "Your draft is kept. Press Escape again to close.";

export type DialogProps = DialogName & {
  ref?: Ref<DialogHandle> | undefined;
  open: boolean;
  role?: DialogRole | undefined;
  size?: DialogSize | undefined;
  describedBy?: string | undefined;
  replayUnmasked?: boolean | undefined;
  titleReplayMasked?: boolean | undefined;
  busy?: boolean | undefined;
  refused?: boolean | undefined;
  holding?: boolean | undefined;
  initialFocus?: React.RefObject<HTMLElement | null> | undefined;
  onDismiss: () => void;
  restoreTo?: RestoreTo | undefined;
  invoker?: HTMLElement | undefined;
  onExited?: (() => void) | undefined;
  onKeyDown?: ((event: React.KeyboardEvent<HTMLDivElement>) => void) | undefined;
  dropTarget?:
    | Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">
    | undefined;
  dropping?: boolean | undefined;
  actions?: React.ReactNode;
  actionsStart?: React.ReactNode;
  expand?: PictureExpand | undefined;
  children: React.ReactNode;
};

const CARD_ANSWER = {
  NUDGE: "data-nudge",
  REFUSED: "data-refused",
} as const;

function nudge(card: HTMLDivElement | null): void {
  if (card !== null) replayMotion(card, CARD_ANSWER.NUDGE);
}

function useRefusalShake(card: React.RefObject<HTMLDivElement | null>, refused: boolean): void {
  const was = useRef(refused);
  useLayoutEffect(() => {
    if (refused && !was.current && card.current !== null) {
      replayMotion(card.current, CARD_ANSWER.REFUSED);
    }
    was.current = refused;
  }, [card, refused]);
}

function reachable(element: HTMLElement): boolean {
  return element.isConnected && element.closest("[inert]") === null;
}

function rowFocus(row: Element | null): HTMLElement | null {
  if (!(row instanceof HTMLElement) || !reachable(row)) return null;
  return row.querySelector<HTMLElement>(ROW_FOCUS);
}

interface RowPlace {
  row: Element;
  next: Element | null;
  list: Element;
}

function neighborIn({ row, next, list }: RowPlace): HTMLElement | null {
  const after = rowFocus(next);
  if (after !== null) return after;
  for (const each of list.children) {
    const head = each === row ? null : rowFocus(each);
    if (head !== null) return head;
  }
  return null;
}

function rowPlaces(opener: HTMLElement): RowPlace[] {
  const row = opener.closest("li");
  const list = row?.parentElement;
  if (row === null || list === null || list === undefined) return [];
  return [{ row, next: row.nextElementSibling, list }, ...rowPlaces(list)];
}

export const nextRowOrHead: RestoreTo = (opener) => {
  const places = rowPlaces(opener);
  return () => {
    for (const place of places) {
      const found = neighborIn(place);
      if (found !== null) return found;
    }
    return null;
  };
};

interface Opener {
  element: HTMLElement;
  restore: (() => HTMLElement | null) | undefined;
}

function focusTaken(card: HTMLElement | null): boolean {
  const now = document.activeElement;
  if (!(now instanceof HTMLElement) || now === document.body || !reachable(now)) return false;
  return !(card?.contains(now) ?? false);
}

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

function useInvokerFocus(
  open: boolean,
  restoreTo: RestoreTo | undefined,
  card: React.RefObject<HTMLElement | null>,
  opener: HTMLElement | undefined,
): () => void {
  const invoker = useRef<Opener | null>(null);
  useLayoutEffect(() => {
    if (!open || invoker.current !== null) return;
    const element = opener ?? document.activeElement;
    if (!(element instanceof HTMLElement)) return;
    invoker.current = { element, restore: restoreTo?.(element) };
  }, [open, restoreTo, opener]);
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

export function Dialog({
  ref,
  open,
  role = DIALOG_ROLE.DIALOG,
  size = DIALOG_SIZE.CONFIRM,
  title,
  subtitle,
  closeLabel,
  labelledBy,
  describedBy,
  replayUnmasked = false,
  titleReplayMasked = false,
  busy = false,
  refused = false,
  holding = false,
  initialFocus,
  onDismiss,
  restoreTo,
  invoker,
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
  const pressedOn = useRef<EventTarget | null>(null);
  const [drawn, setDrawn] = useState(false);
  const titleId = useId();
  const subtitleId = useId();
  const [held, setHeld] = useState(false);
  if (held && (!holding || !open)) setHeld(false);
  const heldSaid = useRef<Retire>(() => undefined);
  useEffect(() => {
    if (!open) heldSaid.current();
  }, [open]);
  useEffect(() => () => heldSaid.current(), []);

  const handBackFocus = useInvokerFocus(open, restoreTo, card, invoker);
  const { foot, claimed, asker, setSlot } = useFootClaim();
  const still = busy || claimed?.busy === true;
  useHeldFocus<HTMLElement>(claimed?.focus ?? initialFocus ?? card, open && drawn && !still);
  useHeldFocus(card, open && drawn && still);
  useEffect(() => {
    if (claimed === undefined) handBack(asker, card.current);
  }, [claimed, asker]);
  useRefusalShake(card, refused || claimed?.refused === true);
  useLayoutEffect(() => {
    if (drawn && expand !== undefined && card.current !== null) expand.grow(card.current);
  }, [drawn, expand]);

  const dismiss = () => {
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
  const goneAtOnce = !open && stood.current && motionHeld();
  useEffect(() => {
    if (goneAtOnce) exited();
  });

  if (goneAtOnce) return null;

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isComposingKey(event)) return;
    if (event.key === "Tab") {
      trappedTab(event);
      return;
    }
    if (event.key === "Escape") return;
    onKeyDown?.(event);
  };

  return (
    <ShadcnDialog
      open={open}
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
        aria-describedby={describedBy ?? (subtitle === undefined ? undefined : subtitleId)}
        aria-busy={busy}
        tabIndex={-1}
        initialFocus={() => (busy ? card.current : (initialFocus?.current ?? card.current))}
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
          className: roomOf(size),
          onClick: (event) => event.stopPropagation(),
          ...dropTarget,
        }}
      >
        {title === undefined ? null : (
          <DialogHead
            titleId={titleId}
            subtitleId={subtitleId}
            title={title}
            subtitle={subtitle}
            closeLabel={closeLabel}
            replayUnmasked={replayUnmasked}
            titleReplayMasked={titleReplayMasked}
            onClose={dismiss}
          />
        )}
        <div
          data-slot="dialog-body"
          data-size={size}
          className={MIDDLE}
          inert={claimed !== undefined}
        >
          <DialogFootContext.Provider value={foot}>
            <ReplayWords unmasked={replayUnmasked}>{children}</ReplayWords>
          </DialogFootContext.Provider>
        </div>
        {claimed !== undefined || (actions === undefined && actionsStart === undefined) ? null : (
          <div className={DIALOG_FOOT}>
            {actionsStart}
            <div className={DIALOG_ANSWERS}>
              <DialogReplayUnmasked.Provider value={replayUnmasked}>
                {actions}
              </DialogReplayUnmasked.Provider>
            </div>
          </div>
        )}
        <div ref={setSlot} className={DIALOG_FOOT} hidden={claimed === undefined} />
      </DialogContent>
    </ShadcnDialog>
  );
}
