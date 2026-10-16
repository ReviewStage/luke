/**
 * toast.tsx -- the window's passing notices: up to three cards stacked in its bottom-right corner, each read once and gone.
 *
 * A toast answers an act whose control is gone by the time it lands: a copy
 * made from a menu that closed with the press, a note sent from a dialog
 * that closed with the send, a plan archived from a menu, a change refused
 * where nothing beside it is left to say so, a coding agent's turn that
 * ended while the developer was looking elsewhere in the window, or an
 * inbox item an agent posted while they were. Each is a
 * card of its words, an optional second line under them, each cut at two
 * lines, and at most one action, such as Undo, at its end. Up to three stand at once, newest at the
 * bottom, or two in a window too short for three to leave the rest of it in
 * sight; one more pushes the oldest out, unless it waits, as news that
 * arrives in runs does, for one of them to leave. A toast saying what
 * one standing already says takes that one's place rather than stacking a
 * twin above it. The stack stands clear of whatever docks at the window's
 * foot under it, a plan's call bar or an agent's composer, so a toast never
 * covers End call or Send.
 *
 * Each stands for its own hold, paused while the pointer is over it or focus
 * is in it, or, where it persists, until it is dismissed. One with an action
 * may always be dismissed before then, since that is how the developer
 * reaches what it stands over: by its action, by the × it shows under the
 * pointer or focus, by Escape while focus is in it, or by whoever showed it
 * withdrawing what it is about. One with no action is never pointed at, so
 * clicks pass through it. It arrives on the pair
 * every arriving element rides and leaves first over `--duration-exit`, held
 * mounted through its leaving; the ones its coming or going moves glide
 * there, so reduced motion and a capture run hold all of it still at the
 * tokens.
 *
 * What each says reaches assistive tech through two regions mounted with
 * the window rather than with the toast, because a live region drawn
 * already holding its words is one a screen reader may never read: a polite
 * one for what was done or is asked, and an alert for what was refused. The words are
 * text like any other, so the session recording masks them with the rest.
 */

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@luke/brand";
import { Clock, Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { CircleAlertIcon, CircleCheckIcon, InboxIcon, XIcon } from "lucide-react";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { DOCKED, dockUnder } from "./desktop/column-dock";
import { rendererRuntime } from "./renderer-runtime";

/** What a toast reports: the act done, the act refused, or something asked of the developer. */
export const TOAST_TONE = {
  DONE: "done",
  FAILED: "failed",
  ASK: "ask",
} as const;

/** The tones said in the polite region: all but a refusal, which is an alert. */
const POLITE_TONES: ReadonlySet<ToastTone> = new Set([TOAST_TONE.DONE, TOAST_TONE.ASK]);

/** The tone said in the alert region: a refusal. */
const ALERT_TONES: ReadonlySet<ToastTone> = new Set([TOAST_TONE.FAILED]);

type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

/** How long a toast with no action stands, by what it reports: a change carried, or one refused, which takes longer to read and to act on. */
export const TOAST_HOLD = {
  DONE: Duration.seconds(3),
  FAILED: Duration.seconds(6),
} as const;

/** What a toast's action says when it takes back what the toast reports. */
export const UNDO_LABEL = "Undo";

/** A toast's one action: its button's label, and what a press of it does. */
interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * A toast to show: its words, an optional second line under them, and its
 * tone, and either how long it stands before it leaves or the action it
 * carries, which sets its own hold or, where it `persists`, stands until it
 * is dismissed. One that `waits` stands only once fewer than three do,
 * rather than pushing the oldest out, for news that arrives in runs and
 * each piece of which is the developer's to act on. Its `subject` is what it
 * is about, by which whoever showed it may withdraw it once it is stale.
 */
export type ToastNotice = {
  readonly words: string;
  readonly detail?: string;
  readonly tone: ToastTone;
  readonly waits?: boolean;
  readonly subject?: string;
} & (
  | { readonly hold: Duration.Duration; readonly action?: never; readonly persists?: never }
  | { readonly action: ToastAction; readonly hold?: never; readonly persists?: boolean }
);

/** How long a toast carrying an action stands while nobody points at it: long enough to reach for the action. */
const ACTION_HOLD = Duration.seconds(5);

/** How long a toast takes to leave, as `--duration-exit` says it. */
const TOAST_EXIT = Duration.millis(MOTION_DURATION_MS.EXIT);

/** How many toasts stand at once: three, or two in a window no taller than `SHORT_WINDOW`. */
const TOAST_ROOM = {
  TALL: 3,
  SHORT: 2,
} as const;

/** The tallest window, in CSS pixels, that leaves room for two toasts rather than three: three cards of two lines each stand 300px tall. */
const SHORT_WINDOW = 640;

/** What the dismiss button is called, for whoever cannot see its ×. */
const DISMISS_LABEL = "Dismiss";

/** What the stack is called, as a landmark among the window's regions. */
const STACK_LABEL = "Notifications";

/** Less than this, in CSS pixels, is not a move worth playing. */
const STILL = 0.5;

/** What can happen to the toasts: one shown, one's hold paused, let run again, or the toast sent away, every toast about a subject withdrawn, or the room the window leaves changed. */
const TOAST_STEP = {
  SHOW: "show",
  PAUSE: "pause",
  RESUME: "resume",
  DISMISS: "dismiss",
  WITHDRAW: "withdraw",
  ROOM: "room",
} as const;

type ToastStep =
  | { readonly kind: typeof TOAST_STEP.SHOW; readonly notice: ToastNotice }
  | {
      readonly kind: typeof TOAST_STEP.PAUSE | typeof TOAST_STEP.RESUME | typeof TOAST_STEP.DISMISS;
      readonly id: number;
    }
  | { readonly kind: typeof TOAST_STEP.WITHDRAW; readonly subject: string }
  | { readonly kind: typeof TOAST_STEP.ROOM; readonly room: number };

/**
 * A toast standing, numbered among those shown so a new one is drawn anew,
 * whether it is on its way out, and what is left of its hold: the time left
 * as of `since`, the instant it last began running down, which is absent
 * while the hold is paused. One that persists has no hold left to run. One
 * leaving keeps in `since` the instant it began to leave.
 */
interface ToastShown {
  readonly id: number;
  readonly notice: ToastNotice;
  readonly leaving: boolean;
  readonly left: Duration.Duration | undefined;
  readonly since: number | undefined;
}

/** The toasts standing, oldest first, those that wait for room, how many have been shown, and how many may stand at once. */
interface ToastStack {
  readonly count: number;
  readonly shown: readonly ToastShown[];
  readonly waiting: readonly ToastNotice[];
  readonly room: number;
}

const EMPTY_STACK: ToastStack = { count: 0, shown: [], waiting: [], room: TOAST_ROOM.TALL };

const toastStackAtom = Atom.keepAlive(Atom.make<ToastStack>(EMPTY_STACK));

/** The hold a notice stands for: its own, its action's, or none where it persists. */
function holdOf(notice: ToastNotice): Duration.Duration | undefined {
  if (notice.persists === true) return undefined;
  return notice.hold ?? ACTION_HOLD;
}

/** A notice standing from `now`, as the stack's next. */
function stand(stack: ToastStack, notice: ToastNotice, now: number): ToastStack {
  const toast = { id: stack.count + 1, notice, leaving: false, left: holdOf(notice), since: now };
  return { ...stack, count: toast.id, shown: [...stack.shown, toast] };
}

/** The toasts standing that are not on their way out. */
function staying(stack: ToastStack): readonly ToastShown[] {
  return stack.shown.filter((toast) => !toast.leaving);
}

/** Sends the toasts `chosen` picks on their way out, from `now`. */
function leave(stack: ToastStack, chosen: (toast: ToastShown) => boolean, now: number): ToastStack {
  const shown = stack.shown.map((toast) =>
    toast.leaving || !chosen(toast) ? toast : { ...toast, leaving: true, since: now },
  );
  return { ...stack, shown };
}

/** When a toast next changes by itself: its hold run out, or its exit done; never while paused or persisting. */
function dueAt(toast: ToastShown): number | undefined {
  if (toast.since === undefined) return undefined;
  if (toast.leaving) return toast.since + Duration.toMillis(TOAST_EXIT);
  if (toast.left === undefined) return undefined;
  return toast.since + Duration.toMillis(toast.left);
}

/** Whether two notices say the same thing, with no action between them whose press would be lost. */
function sameSaying(a: ToastNotice, b: ToastNotice): boolean {
  return (
    a.action === undefined &&
    b.action === undefined &&
    a.words === b.words &&
    a.detail === b.detail &&
    a.tone === b.tone
  );
}

/**
 * Lets what fell due by `now` happen: a hold run out starts its toast
 * leaving, at the instant it ran out; an exit done takes its toast away;
 * and each toast that waits stands in turn while there is room.
 */
function settle(stack: ToastStack, now: number): ToastStack {
  let next: ToastStack = { ...stack, shown: [] };
  for (const toast of stack.shown) {
    const due = dueAt(toast);
    if (due === undefined || due > now) next = { ...next, shown: [...next.shown, toast] };
    else if (!toast.leaving)
      next = { ...next, shown: [...next.shown, { ...toast, leaving: true, since: due }] };
  }
  while (next.waiting.length > 0 && staying(next).length < next.room) {
    const [first, ...rest] = next.waiting;
    if (first === undefined) break;
    next = stand({ ...next, waiting: rest }, first, now);
  }
  return next;
}

/**
 * Pushes the oldest out while more stand than there is room for, one that
 * would leave by itself before one that persists, and never the newest.
 * Note that one that persists is only stepped aside, to the head of the
 * line, because it stands until dismissed, and a notice passing through or
 * a window made shorter is no dismissal.
 */
function crowd(stack: ToastStack, now: number): ToastStack {
  let next = stack;
  const aside: ToastNotice[] = [];
  for (;;) {
    const older = staying(next).slice(0, -1);
    const oldest = older.find((toast) => toast.left !== undefined) ?? older[0];
    if (older.length < next.room || oldest === undefined) break;
    next = leave(next, (toast) => toast === oldest, now);
    if (oldest.left === undefined) aside.push(oldest.notice);
  }
  return aside.length === 0 ? next : { ...next, waiting: [...aside, ...next.waiting] };
}

/**
 * A notice arriving at `now`: it joins the line where it waits and there is
 * no room, takes the place of a toast already saying it, or stands at the
 * bottom, pushing the oldest out where the stack is full.
 */
function arrive(stack: ToastStack, notice: ToastNotice, now: number): ToastStack {
  if (notice.waits === true && staying(stack).length >= stack.room) {
    return { ...stack, waiting: [...stack.waiting, notice] };
  }
  const twin = stack.shown.find((toast) => !toast.leaving && sameSaying(toast.notice, notice));
  const unmatched = { ...stack, shown: stack.shown.filter((toast) => toast !== twin) };
  return crowd(stand(unmatched, notice, now), now);
}

/** A toast's hold paused at `now`, keeping what was left of it. */
function pause(stack: ToastStack, id: number, now: number): ToastStack {
  const shown = stack.shown.map((toast) => {
    if (toast.id !== id || toast.leaving || toast.since === undefined) return toast;
    const left =
      toast.left === undefined
        ? undefined
        : Duration.max(
            Duration.zero,
            Duration.subtract(toast.left, Duration.millis(now - toast.since)),
          );
    return { ...toast, left, since: undefined };
  });
  return { ...stack, shown };
}

/** A paused toast's hold let run again from `now`. */
function resume(stack: ToastStack, id: number, now: number): ToastStack {
  const shown = stack.shown.map((toast) =>
    toast.id !== id || toast.leaving || toast.since !== undefined
      ? toast
      : { ...toast, since: now },
  );
  return { ...stack, shown };
}

/** The stack once `step` has happened at `now`. */
function stepped(stack: ToastStack, step: ToastStep, now: number): ToastStack {
  switch (step.kind) {
    case TOAST_STEP.SHOW:
      return arrive(stack, step.notice, now);
    case TOAST_STEP.PAUSE:
      return pause(stack, step.id, now);
    case TOAST_STEP.RESUME:
      return resume(stack, step.id, now);
    case TOAST_STEP.DISMISS:
      return leave(stack, (toast) => toast.id === step.id, now);
    case TOAST_STEP.WITHDRAW: {
      const waiting = stack.waiting.filter((notice) => notice.subject !== step.subject);
      return leave({ ...stack, waiting }, (toast) => toast.notice.subject === step.subject, now);
    }
    case TOAST_STEP.ROOM:
      return crowd({ ...stack, room: step.room }, now);
  }
}

/**
 * The toasts' lives, as an atom whose work is their waits: each step lands
 * on the stack, which then runs down to its next change and lets it happen,
 * until nothing in it changes by itself. Note that it is kept alive, because
 * whoever asked for a toast is often a menu already unmounted by the time it
 * leaves, and that each step interrupts the wait of the one before it, which
 * the stack's own times let it take back up where it stood.
 */
const toastLifeAtom = Atom.keepAlive(
  rendererRuntime.fn((step: ToastStep, get) =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      let stack = settle(stepped(get(toastStackAtom), step, at), at);
      get.set(toastStackAtom, stack);
      // Note that the stack is carried here rather than read back, because
      // nothing else writes it while this runs, and each settle past a due
      // moves it on, so the loop ends even under a registry already disposed.
      for (;;) {
        const dues = stack.shown.flatMap((toast) => dueAt(toast) ?? []);
        if (dues.length === 0) return;
        const now = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Duration.millis(Math.max(0, Math.min(...dues) - now)));
        stack = settle(stack, yield* Clock.currentTimeMillis);
        get.set(toastStackAtom, stack);
      }
    }),
  ),
);

/** Shows a toast; the same function on every render. */
export function useToast(): (notice: ToastNotice) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((notice: ToastNotice) => step({ kind: TOAST_STEP.SHOW, notice }), [step]);
}

/** Withdraws every toast standing or waiting about `subject`, now stale; the same function on every render. */
export function useWithdrawToast(): (subject: string) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((subject: string) => step({ kind: TOAST_STEP.WITHDRAW, subject }), [step]);
}

/** What a toast says aloud: its words, then its second line. */
function spoken(notice: ToastNotice): string {
  return notice.detail === undefined ? notice.words : `${notice.words}. ${notice.detail}`;
}

/** What the newest toast of one of `tones` still standing says aloud, or nothing. */
function newestSaying(shown: readonly ToastShown[], tones: ReadonlySet<ToastTone>): string {
  const newest = shown.findLast((toast) => !toast.leaving && tones.has(toast.notice.tone));
  return newest === undefined ? "" : spoken(newest.notice);
}

/**
 * Glides each toast a change moved from where it was drawn to where it now
 * stands, on the spring small elements ride, read from the tokens at the
 * stack so reduced motion and a capture run play nothing.
 */
function useStackGlide(): React.RefObject<HTMLOListElement | null> {
  const list = useRef<HTMLOListElement>(null);
  const drawn = useRef(new Map<Element, number>());
  useLayoutEffect(() => {
    const root = list.current;
    if (root === null) return;
    const style = getComputedStyle(root);
    const duration = Number.parseFloat(style.getPropertyValue("--duration-fast")) || 0;
    const easing = style.getPropertyValue("--spring-fast").trim();
    const next = new Map<Element, number>();
    for (const toast of root.children) {
      const top = toast.getBoundingClientRect().top;
      const was = drawn.current.get(toast);
      next.set(toast, top);
      // Note that reduced motion leaves 1ms rather than none, which is no motion either.
      if (was === undefined || Math.abs(was - top) < STILL || duration <= 1) continue;
      toast.animate([{ transform: `translateY(${was - top}px)` }, { transform: "none" }], {
        duration,
        easing,
      });
    }
    drawn.current = next;
  });
  return list;
}

/** How many toasts the window has room for at its height now. */
function roomNow(): number {
  return window.innerHeight <= SHORT_WINDOW ? TOAST_ROOM.SHORT : TOAST_ROOM.TALL;
}

/** Tells the stack how many toasts the window has room for, as the host mounts and whenever its height crosses `SHORT_WINDOW`. */
function useWindowRoom(step: (step: ToastStep) => void): void {
  useLayoutEffect(() => {
    let told: number | undefined;
    const tell = () => {
      const room = roomNow();
      if (room === told) return;
      told = room;
      step({ kind: TOAST_STEP.ROOM, room });
    };
    tell();
    window.addEventListener("resize", tell);
    return () => window.removeEventListener("resize", tell);
  }, [step]);
}

/**
 * Keeps the stack clear of what docks at the window's foot under it, a
 * plan's call bar or an agent's composer, by saying that dock's height on
 * the stack as `--toast-dock`, which its `bottom` stands above. Note that it
 * follows the docks only while a toast stands, because an empty stack draws
 * nothing, and watching the whole window for docks coming and going is not
 * worth doing for nothing.
 */
function useDockClearance(stack: RefObject<HTMLElement | null>, standing: boolean): void {
  useLayoutEffect(() => {
    const host = stack.current;
    if (host === null || !standing) return;
    const write = () => host.style.setProperty("--toast-dock", `${dockUnder(host)}px`);
    const sized = new ResizeObserver(write);
    const follow = () => {
      sized.disconnect();
      for (const part of document.querySelectorAll(DOCKED)) sized.observe(part);
    };
    const arrived = new MutationObserver(() => {
      follow();
      write();
    });
    arrived.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", write);
    follow();
    write();
    return () => {
      sized.disconnect();
      arrived.disconnect();
      window.removeEventListener("resize", write);
      host.style.removeProperty("--toast-dock");
    };
  }, [stack, standing]);
}

/** The glyph a toast leads with: a check for what was done, an alert for what was refused, and the Inbox's tray for an ask. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case TOAST_TONE.DONE:
      return <CircleCheckIcon aria-hidden="true" />;
    case TOAST_TONE.FAILED:
      return <CircleAlertIcon aria-hidden="true" />;
    case TOAST_TONE.ASK:
      return <InboxIcon aria-hidden="true" />;
  }
}

/**
 * One toast, drawn anew for each shown. Its hold is paused while the pointer
 * is over it or focus is in it, each of which it keeps apart, so that one
 * ending while the other stands lets nothing run.
 */
function ToastCard({
  shown,
  step,
}: {
  shown: ToastShown;
  step: (step: ToastStep) => void;
}): React.JSX.Element {
  const held = useRef({ pointer: false, focus: false });
  const { id, notice, leaving } = shown;
  const { action } = notice;
  const hold = (by: keyof typeof held.current, holding: boolean) => {
    const was = held.current.pointer || held.current.focus;
    held.current = { ...held.current, [by]: holding };
    const now = held.current.pointer || held.current.focus;
    if (now !== was) step({ kind: now ? TOAST_STEP.PAUSE : TOAST_STEP.RESUME, id });
  };
  return (
    <li
      className="toast"
      data-tone={notice.tone}
      data-action={action === undefined ? undefined : "true"}
      data-leaving={leaving ? "true" : undefined}
      {...(action === undefined
        ? undefined
        : {
            onPointerEnter: () => hold("pointer", true),
            onPointerLeave: () => hold("pointer", false),
            onFocus: () => hold("focus", true),
            onBlur: () => hold("focus", false),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key !== "Escape") return;
              event.stopPropagation();
              step({ kind: TOAST_STEP.DISMISS, id });
            },
          })}
    >
      <ToneGlyph tone={notice.tone} />
      <span className="toast-text">
        <span className="toast-words">{notice.words}</span>
        {notice.detail === undefined ? null : <span className="toast-detail">{notice.detail}</span>}
      </span>
      {action === undefined ? null : (
        <>
          <button
            type="button"
            className="toast-action"
            onClick={() => {
              step({ kind: TOAST_STEP.DISMISS, id });
              action.onPress();
            }}
          >
            {action.label}
          </button>
          <button
            type="button"
            className="toast-dismiss"
            aria-label={DISMISS_LABEL}
            onClick={() => step({ kind: TOAST_STEP.DISMISS, id })}
          >
            <XIcon aria-hidden="true" />
          </button>
        </>
      )}
    </li>
  );
}

/** The toasts standing, in the window's bottom-right corner, and the regions that say them. Mounted once, by the window's root. */
export function ToastHost(): React.JSX.Element {
  const { shown } = useAtomValue(toastStackAtom);
  const step = useAtomSet(toastLifeAtom);
  const stack = useRef<HTMLElement>(null);
  const list = useStackGlide();
  useWindowRoom(step);
  useDockClearance(stack, shown.length > 0);
  return createPortal(
    <>
      <section ref={stack} className="toast-stack" aria-label={STACK_LABEL}>
        <ol ref={list}>
          {shown.map((toast) => (
            <ToastCard key={toast.id} shown={toast} step={step} />
          ))}
        </ol>
      </section>
      <p className="visually-hidden" role="status">
        {newestSaying(shown, POLITE_TONES)}
      </p>
      <p className="visually-hidden" role="alert">
        {newestSaying(shown, ALERT_TONES)}
      </p>
    </>,
    document.body,
  );
}
