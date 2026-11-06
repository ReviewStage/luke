import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@repo/brand";
import {
  type MarkProvider,
  STATUS_TONE,
  TOAST_HOLD,
  Toast,
  ToastActions,
  type ToastCopy,
  ToastStack,
  type ToastTone,
} from "@repo/ui";
import { visibleViewport } from "@repo/ui/visible-viewport";
import { Clock, Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { appPlatform } from "./app-platform.js";
import { failureOfConnection, reportShownFailure, type ShownFailure } from "./failure-report.js";
import { rendererRegistry, rendererRuntime } from "./renderer-runtime.js";

const POLITE_TONES: ReadonlySet<ToastTone> = new Set([
  STATUS_TONE.COMPLETE,
  STATUS_TONE.ATTENTION,
  STATUS_TONE.WORKING,
]);

const ALERT_TONES: ReadonlySet<ToastTone> = new Set([STATUS_TONE.DANGER]);

export { TOAST_HOLD };

const UNDO_LABEL = "Undo";

const DETAILS_WHAT = "details";

interface ToastAction {
  readonly label: string;
  readonly href?: string | undefined;
  readonly onPress: () => void;
  readonly replayUnmasked?: boolean | undefined;
}

type ToastSaying =
  | { readonly tone: Exclude<ToastTone, typeof STATUS_TONE.DANGER>; readonly failure?: never }
  | { readonly tone: typeof STATUS_TONE.DANGER; readonly failure: ShownFailure };

export type ToastNotice = {
  readonly words: string;
  readonly glyph?: () => React.JSX.Element;
  readonly mark?: MarkProvider;
  readonly detail?: string;
  readonly subject?: string;
  readonly replayUnmasked?: boolean | undefined;
  readonly onDismiss?: () => void;
} & ToastSaying &
  (
    | { readonly hold: Duration.Duration; readonly action?: never; readonly persists?: never }
    | { readonly action: ToastAction; readonly hold?: Duration.Duration; readonly persists?: never }
    | { readonly action: ToastAction; readonly persists: true; readonly hold?: never }
    | {
        readonly subject: string;
        readonly persists: true;
        readonly action?: never;
        readonly hold?: never;
      }
    | {
        readonly tone: typeof STATUS_TONE.WORKING;
        readonly hold?: never;
        readonly action?: never;
        readonly persists?: never;
      }
  );

type KeptNotice = ToastNotice & { readonly details?: string | undefined };

const TOAST_EXIT = Duration.millis(MOTION_DURATION_MS.EXIT);

const TOAST_ROOM = {
  TALL: 3,
  SHORT: 2,
} as const;

const SHORT_WINDOW = 640;

const DISMISS_LABEL = "Dismiss";

const STACK_LABEL = "Notifications";

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
  | { readonly kind: typeof TOAST_STEP.SHOW; readonly notice: KeptNotice }
  | {
      readonly kind: typeof TOAST_STEP.PAUSE | typeof TOAST_STEP.RESUME | typeof TOAST_STEP.DISMISS;
      readonly id: number;
    }
  | {
      readonly kind: typeof TOAST_STEP.SETTLE;
      readonly subject: string;
      readonly notice: KeptNotice;
    }
  | { readonly kind: typeof TOAST_STEP.WITHDRAW; readonly subject: string }
  | { readonly kind: typeof TOAST_STEP.ROOM; readonly room: number };

interface ToastShown {
  readonly id: number;
  readonly notice: KeptNotice;
  readonly leaving: boolean;
  readonly left: Duration.Duration | undefined;
  readonly since: number | undefined;
}

interface ToastLine {
  readonly count: number;
  readonly shown: readonly ToastShown[];
  readonly waiting: readonly KeptNotice[];
  readonly room: number;
}

const EMPTY_STACK: ToastLine = { count: 0, shown: [], waiting: [], room: TOAST_ROOM.TALL };

const toastStackAtom = Atom.keepAlive(Atom.make<ToastLine>(EMPTY_STACK));

function holdOf(notice: ToastNotice): Duration.Duration | undefined {
  if (notice.persists === true || notice.tone === STATUS_TONE.WORKING) return undefined;
  return notice.hold ?? TOAST_HOLD.UNDO;
}

function stand(stack: ToastLine, notice: KeptNotice, now: number): ToastLine {
  const toast = { id: stack.count + 1, notice, leaving: false, left: holdOf(notice), since: now };
  return { ...stack, count: toast.id, shown: [...stack.shown, toast] };
}

function staying(stack: ToastLine): readonly ToastShown[] {
  return stack.shown.filter((toast) => !toast.leaving);
}

function leave(stack: ToastLine, chosen: (toast: ToastShown) => boolean, now: number): ToastLine {
  const shown = stack.shown.map((toast) =>
    toast.leaving || !chosen(toast) ? toast : { ...toast, leaving: true, since: now },
  );
  return { ...stack, shown };
}

function dueAt(toast: ToastShown): number | undefined {
  if (toast.since === undefined) return undefined;
  if (toast.leaving) return toast.since + Duration.toMillis(TOAST_EXIT);
  if (toast.left === undefined) return undefined;
  return toast.since + Duration.toMillis(toast.left);
}

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

function crowd(stack: ToastLine, now: number): ToastLine {
  let next = stack;
  const aside: KeptNotice[] = [];
  for (;;) {
    const older = staying(next).slice(0, -1);
    const oldest = older.find((toast) => toast.left !== undefined) ?? older[0];
    if (older.length < next.room || oldest === undefined) break;
    next = leave(next, (toast) => toast === oldest, now);
    if (oldest.left === undefined) aside.push(oldest.notice);
  }
  return aside.length === 0 ? next : { ...next, waiting: [...aside, ...next.waiting] };
}

function arrive(stack: ToastLine, notice: KeptNotice, now: number): ToastLine {
  const twin = stack.shown.find((toast) => !toast.leaving && sameSaying(toast.notice, notice));
  const unmatched = { ...stack, shown: stack.shown.filter((toast) => toast !== twin) };
  return crowd(stand(unmatched, notice, now), now);
}

function settleWork(stack: ToastLine, subject: string, notice: KeptNotice, now: number): ToastLine {
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

function resume(stack: ToastLine, id: number, now: number): ToastLine {
  const shown = stack.shown.map((toast) =>
    toast.id !== id || toast.leaving || toast.since !== undefined
      ? toast
      : { ...toast, since: now },
  );
  return { ...stack, shown };
}

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

function reportSaid(step: ToastStep, at: number): ToastStep | undefined {
  if (step.kind !== TOAST_STEP.SHOW && step.kind !== TOAST_STEP.SETTLE) return step;
  if (step.notice.tone !== STATUS_TONE.DANGER) return step;
  const details = reportShownFailure(step.notice.failure, at);
  if (step.notice.action === undefined && failureOfConnection(step.notice.failure)) {
    return step.kind === TOAST_STEP.SETTLE
      ? { kind: TOAST_STEP.WITHDRAW, subject: step.subject }
      : undefined;
  }
  return { ...step, notice: { ...step.notice, details } };
}

const toastLifeAtom = Atom.keepAlive(
  rendererRuntime.fn((step: ToastStep, get) =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis;
      const said = yield* Effect.sync(() => reportSaid(step, at));
      const before = get(toastStackAtom);
      let stack = settle(said === undefined ? before : stepped(before, said, at), at);
      get.set(toastStackAtom, stack);
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

export function undoToast(words: string, undo: () => void): ToastNotice {
  return {
    words,
    tone: STATUS_TONE.COMPLETE,
    action: { label: UNDO_LABEL, onPress: undo, replayUnmasked: true },
    hold: TOAST_HOLD.UNDO,
  };
}

export function showToast(notice: ToastNotice): void {
  rendererRegistry.set(toastLifeAtom, { kind: TOAST_STEP.SHOW, notice });
}

export function useToast(): (notice: ToastNotice) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((notice: ToastNotice) => step({ kind: TOAST_STEP.SHOW, notice }), [step]);
}

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

export function useWithdrawToast(): (subject: string) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((subject: string) => step({ kind: TOAST_STEP.WITHDRAW, subject }), [step]);
}

function spoken(notice: ToastNotice): string {
  return notice.detail === undefined ? notice.words : `${notice.words}. ${notice.detail}`;
}

function newestSaying(shown: readonly ToastShown[], tones: ReadonlySet<ToastTone>): string {
  const newest = shown.findLast((toast) => !toast.leaving && tones.has(toast.notice.tone));
  return newest === undefined ? "" : spoken(newest.notice);
}

function roomNow(): number {
  const seen = visibleViewport();
  return seen.bottom - seen.top <= SHORT_WINDOW ? TOAST_ROOM.SHORT : TOAST_ROOM.TALL;
}

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
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", tell);
    return () => {
      window.removeEventListener("resize", tell);
      viewport?.removeEventListener("resize", tell);
    };
  }, [step]);
}

function ToastCard({
  shown,
  step,
}: {
  shown: ToastShown;
  step: (step: ToastStep) => void;
}): React.JSX.Element {
  const { id, notice, leaving } = shown;
  const { action, details } = notice;
  const hold = holdOf(notice);
  const dismiss = () => {
    step({ kind: TOAST_STEP.DISMISS, id });
    if (!leaving) notice.onDismiss?.();
  };
  const copy: ToastCopy | undefined =
    details === undefined
      ? undefined
      : { text: details, what: DETAILS_WHAT, copy: (text) => appPlatform().copyText(text) };
  const acts = action !== undefined || copy !== undefined;
  return (
    <Toast
      tone={notice.tone}
      glyph={notice.glyph}
      mark={notice.mark}
      words={notice.words}
      detail={notice.detail}
      replayUnmasked={notice.replayUnmasked}
      leaving={leaving}
      countdown={!acts || hold === undefined ? undefined : Duration.toMillis(hold)}
      actions={
        !acts ? undefined : (
          <ToastActions
            {...(action === undefined
              ? {}
              : { label: action.label, href: action.href, onPress: action.onPress })}
            copy={copy}
            dismissLabel={DISMISS_LABEL}
            onDismiss={dismiss}
            replayUnmasked={action?.replayUnmasked}
          />
        )
      }
      onHold={(holding) => step({ kind: holding ? TOAST_STEP.PAUSE : TOAST_STEP.RESUME, id })}
      onEscape={dismiss}
    />
  );
}

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
