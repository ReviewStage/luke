/**
 * toast.tsx -- the window's passing notices, as state: what stands, for how long, and what pushes what out; `@luke/ui`'s `Toast`, `ToastStack`, and `ToastActions` draw them.
 *
 * A toast answers an act whose control is gone by the time it lands: a copy
 * made from a menu that closed with the press, a note sent from a dialog
 * that closed with the send, a task archived from a menu, a change refused
 * where nothing beside it is left to say so, a coding agent's turn that
 * ended while the developer was looking elsewhere in the window, or an
 * inbox item an agent posted while they were. Each is a
 * card of its words, an optional second line under them, each cut at two
 * lines, and at most one action, such as Undo, at its end. Up to three stand at once, newest at the
 * bottom, or two in a window too short for three to leave the rest of it in
 * sight; one more pushes the oldest out, unless it waits, as news that
 * arrives in runs does, for one of them to leave. A toast saying what
 * one standing already says takes that one's place rather than stacking a
 * twin above it. The stack always stands in the window's bottom-right
 * corner, over whatever docks at its foot, a plan's call bar or an agent's
 * composer, for no longer than its hold; one with an action there can be
 * dismissed to reach End call or Send under it.
 *
 * Each stands for its own hold, paused while the pointer is over it or focus
 * is in it, and leaves by itself once it runs out, the news an agent or an
 * automation sends among them, since what it reports stands elsewhere too:
 * an agent's unseen dot, a plan's Inbox, the Automations mark. Only one
 * whose action is the one way back to something the developer would
 * otherwise lose, such as words a save left unsaved, persists until it is
 * dismissed. One whose hold runs down by itself with an action drains a bar
 * along its foot over that hold, paused with it. One saying work is under
 * way (`useWorkingToast`) stands until the work settles, then turns in
 * place into what came of it, done or failed, and stands for that one's
 * hold, rather than leaving and another arriving. One with an action
 * may always be dismissed before then, since that is how the developer
 * reaches what it stands over: by its action, by the × it shows over its
 * top-left corner under the pointer or focus, as a Mac's own notifications
 * do, by Escape while focus is in it, by a sideways swipe, or by whoever showed it
 * withdrawing what it is about. One with no action is never pointed at, so
 * clicks pass through it. It arrives on the pair
 * every arriving element rides and leaves first over `--luke-duration-exit`, held
 * mounted through its leaving; the ones its coming or going moves glide
 * there, so reduced motion and a capture run hold all of it still at the
 * tokens.
 *
 * What each says reaches assistive tech through two regions mounted with
 * the window rather than with the toast (`@luke/ui`'s `ToastStack`), because a live region drawn
 * already holding its words is one a screen reader may never read: a polite
 * one for what was done or is asked, and an alert for what was refused. The words are
 * text like any other, so the session recording masks them with the rest.
 */

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@luke/brand";
import { STATUS_TONE, TOAST_HOLD, Toast, ToastActions, ToastStack, type ToastTone } from "@luke/ui";
import { visibleViewport } from "@luke/ui/visible-viewport";
import { Clock, Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime.js";

/** The tones said in the polite region: all but a refusal, which is an alert. */
const POLITE_TONES: ReadonlySet<ToastTone> = new Set([
  STATUS_TONE.COMPLETE,
  STATUS_TONE.ATTENTION,
  STATUS_TONE.WORKING,
]);

/** The tone said in the alert region: a refusal. */
const ALERT_TONES: ReadonlySet<ToastTone> = new Set([STATUS_TONE.DANGER]);

/** How long a toast stands, by what it reports: `@luke/ui`'s, which a copy button's check reads too. */
export { TOAST_HOLD };

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
 * carries, with its own hold, the action's where it names none, or, where
 * it `persists`, none at all, standing until it is dismissed: kept for an
 * action that is the one way back to something the developer would
 * otherwise lose. One that `waits` stands only once fewer than three do,
 * rather than pushing the oldest out, for news that arrives in runs and
 * each piece of which is the developer's to act on. Its `subject` is what it
 * is about, by which whoever showed it may withdraw it once it is stale.
 * One of `STATUS_TONE.WORKING` has no hold and no action: it stands until the
 * work it says is under way settles it (`useWorkingToast`).
 */
export type ToastNotice = {
  readonly words: string;
  readonly detail?: string;
  readonly tone: ToastTone;
  readonly waits?: boolean;
  readonly subject?: string;
} & (
  | { readonly hold: Duration.Duration; readonly action?: never; readonly persists?: never }
  | { readonly action: ToastAction; readonly hold?: Duration.Duration; readonly persists?: never }
  | { readonly action: ToastAction; readonly persists: true; readonly hold?: never }
  | {
      readonly tone: typeof STATUS_TONE.WORKING;
      readonly hold?: never;
      readonly action?: never;
      readonly persists?: never;
    }
);

/** How long a toast takes to leave, as `--luke-duration-exit` says it. */
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

/** What can happen to the toasts: one shown, one working settled in place, one's hold paused, let run again, or the toast sent away, every toast about a subject withdrawn, or the room the window leaves changed. */
const TOAST_STEP = {
  SHOW: "show",
  SETTLE: "settle",
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
  | {
      readonly kind: typeof TOAST_STEP.SETTLE;
      readonly subject: string;
      readonly notice: ToastNotice;
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
interface ToastLine {
  readonly count: number;
  readonly shown: readonly ToastShown[];
  readonly waiting: readonly ToastNotice[];
  readonly room: number;
}

const EMPTY_STACK: ToastLine = { count: 0, shown: [], waiting: [], room: TOAST_ROOM.TALL };

const toastStackAtom = Atom.keepAlive(Atom.make<ToastLine>(EMPTY_STACK));

/** The hold a notice stands for: its own, the Undo hold where it carries an action and names none, or none where it persists or says work is under way. */
function holdOf(notice: ToastNotice): Duration.Duration | undefined {
  if (notice.persists === true || notice.tone === STATUS_TONE.WORKING) return undefined;
  return notice.hold ?? TOAST_HOLD.UNDO;
}

/** A notice standing from `now`, as the stack's next. */
function stand(stack: ToastLine, notice: ToastNotice, now: number): ToastLine {
  const toast = { id: stack.count + 1, notice, leaving: false, left: holdOf(notice), since: now };
  return { ...stack, count: toast.id, shown: [...stack.shown, toast] };
}

/** The toasts standing that are not on their way out. */
function staying(stack: ToastLine): readonly ToastShown[] {
  return stack.shown.filter((toast) => !toast.leaving);
}

/** Sends the toasts `chosen` picks on their way out, from `now`. */
function leave(stack: ToastLine, chosen: (toast: ToastShown) => boolean, now: number): ToastLine {
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

/** Whether two notices say the same thing, with no action between them whose press would be lost, and neither work under way that will settle on its own. */
function sameSaying(a: ToastNotice, b: ToastNotice): boolean {
  return (
    a.tone !== STATUS_TONE.WORKING &&
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
function settle(stack: ToastLine, now: number): ToastLine {
  let next: ToastLine = { ...stack, shown: [] };
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
function crowd(stack: ToastLine, now: number): ToastLine {
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
function arrive(stack: ToastLine, notice: ToastNotice, now: number): ToastLine {
  if (notice.waits === true && staying(stack).length >= stack.room) {
    return { ...stack, waiting: [...stack.waiting, notice] };
  }
  const twin = stack.shown.find((toast) => !toast.leaving && sameSaying(toast.notice, notice));
  const unmatched = { ...stack, shown: stack.shown.filter((toast) => toast !== twin) };
  return crowd(stand(unmatched, notice, now), now);
}

/**
 * The working toast about `subject` turned at `now` into `notice`, in place
 * and for that one's whole hold, or, waiting, turned where it waits; where
 * none stands or waits, as when it was pushed out, `notice` arrives anew.
 */
function settleWork(
  stack: ToastLine,
  subject: string,
  notice: ToastNotice,
  now: number,
): ToastLine {
  const working = (about: ToastNotice) =>
    about.tone === STATUS_TONE.WORKING && about.subject === subject;
  const standing = stack.shown.find((toast) => !toast.leaving && working(toast.notice));
  if (standing !== undefined) {
    const turned = { ...standing, notice, left: holdOf(notice), since: now };
    const shown = stack.shown.map((toast) => (toast === standing ? turned : toast));
    return { ...stack, shown };
  }
  if (stack.waiting.some(working)) {
    return { ...stack, waiting: stack.waiting.map((about) => (working(about) ? notice : about)) };
  }
  return arrive(stack, notice, now);
}

/** A toast's hold paused at `now`, keeping what was left of it. */
function pause(stack: ToastLine, id: number, now: number): ToastLine {
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
function resume(stack: ToastLine, id: number, now: number): ToastLine {
  const shown = stack.shown.map((toast) =>
    toast.id !== id || toast.leaving || toast.since !== undefined
      ? toast
      : { ...toast, since: now },
  );
  return { ...stack, shown };
}

/** The stack once `step` has happened at `now`. */
function stepped(stack: ToastLine, step: ToastStep, now: number): ToastLine {
  switch (step.kind) {
    case TOAST_STEP.SHOW:
      return arrive(stack, step.notice, now);
    case TOAST_STEP.SETTLE:
      return settleWork(stack, step.subject, step.notice, now);
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

/**
 * The toast an act that happened at once says it with, so the developer can
 * take it back: its words in the success tone, with Undo, standing for the
 * Undo hold. Pressing Undo dismisses it, then runs `undo`. It is a notice
 * rather than a show, so it is handed to whatever shows the act's answer:
 * `useToast`'s function, `showToast`, or a working toast's settle.
 */
export function undoToast(words: string, undo: () => void): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: UNDO_LABEL, onPress: undo },
    hold: TOAST_HOLD.UNDO,
  };
}

/**
 * Shows a toast from outside React, on the window's own registry, the one its
 * root provides: for a press whose answer lands after its handler returned
 * (`act.ts`'s `pressAct`).
 */
export function showToast(notice: ToastNotice): void {
  rendererRegistry.set(toastLifeAtom, { kind: TOAST_STEP.SHOW, notice });
}

/** Shows a toast; the same function on every render. */
export function useToast(): (notice: ToastNotice) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((notice: ToastNotice) => step({ kind: TOAST_STEP.SHOW, notice }), [step]);
}

/**
 * Shows a toast saying work is under way, with a spinner, and answers how to
 * settle it: the notice saying what came of the work, which the same card
 * turns into in place. Note that each call is its own subject, so two pieces
 * of work under way at once each settle their own card. The same function on
 * every render.
 */
export function useWorkingToast(): (words: string) => (notice: ToastNotice) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback(
    (words: string) => {
      const subject = crypto.randomUUID();
      step({ kind: TOAST_STEP.SHOW, notice: { words, tone: STATUS_TONE.WORKING, subject } });
      return (notice: ToastNotice) =>
        step({ kind: TOAST_STEP.SETTLE, subject, notice: { subject, ...notice } });
    },
    [step],
  );
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

/** How many toasts the window has room for at the height of what can be seen of it now, the keyboard's left out. */
function roomNow(): number {
  const seen = visibleViewport();
  return seen.bottom - seen.top <= SHORT_WINDOW ? TOAST_ROOM.SHORT : TOAST_ROOM.TALL;
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
    // Note that a phone's keyboard shrinks what is seen without resizing the window.
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", tell);
    return () => {
      window.removeEventListener("resize", tell);
      viewport?.removeEventListener("resize", tell);
    };
  }, [step]);
}

/** One toast, drawn anew for each shown: the ui card, its hold paused while the pointer is over it or focus is in it. */
function ToastCard({
  shown,
  step,
}: {
  shown: ToastShown;
  step: (step: ToastStep) => void;
}): React.JSX.Element {
  const { id, notice, leaving } = shown;
  const { action } = notice;
  const hold = holdOf(notice);
  const dismiss = () => step({ kind: TOAST_STEP.DISMISS, id });
  return (
    <Toast
      tone={notice.tone}
      words={notice.words}
      detail={notice.detail}
      leaving={leaving}
      countdown={action === undefined || hold === undefined ? undefined : Duration.toMillis(hold)}
      actions={
        action === undefined ? undefined : (
          <ToastActions
            label={action.label}
            onPress={action.onPress}
            dismissLabel={DISMISS_LABEL}
            onDismiss={dismiss}
          />
        )
      }
      onHold={(holding) => step({ kind: holding ? TOAST_STEP.PAUSE : TOAST_STEP.RESUME, id })}
      onEscape={dismiss}
    />
  );
}

/** The toasts standing, in the window's bottom-right corner, and the regions that say them. Mounted once, by the window's root. */
export function ToastHost(): React.JSX.Element {
  const { shown } = useAtomValue(toastStackAtom);
  const step = useAtomSet(toastLifeAtom);
  useWindowRoom(step);
  return createPortal(
    <ToastStack
      label={STACK_LABEL}
      polite={newestSaying(shown, POLITE_TONES)}
      alert={newestSaying(shown, ALERT_TONES)}
    >
      {shown.map((toast) => (
        <ToastCard key={toast.id} shown={toast} step={step} />
      ))}
    </ToastStack>,
    document.body,
  );
}
