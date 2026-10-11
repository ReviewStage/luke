/**
 * toast.tsx -- the window's one passing notice: a small pill at the foot of the window, read once and gone.
 *
 * It answers an act whose control is gone by the time it lands: a copy made
 * from a menu that closed with the press, a note sent from a dialog that
 * closed with the send, a plan archived from a menu, or a change that was
 * refused where nothing beside it is left to say so. One stands at a time,
 * bottom-centre; a second takes the first's place and starts its hold
 * afresh. A toast may carry one action, such as Undo, as a button at its
 * end: it then stands for `ACTION_HOLD`, its hold paused while the pointer
 * is over it or focus is in it, and a press of the action takes it away.
 * One with no action is never pointed at, so clicks pass through it. It
 * arrives on the pair every arriving element rides and leaves first over
 * `--duration-exit`, held mounted through its leaving, so reduced motion and
 * a capture run hold it still at the tokens. Its words are text like any
 * other, so the session recording masks them with the rest.
 */

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Clock, Duration, Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { rendererRuntime } from "./renderer-runtime";

/** What a toast reports: the act done, or the act refused. */
export const TOAST_TONE = {
  DONE: "done",
  FAILED: "failed",
} as const;

type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

/** How long a toast with no action stands, by what it reports: a change carried, or one refused, which takes longer to read. */
export const TOAST_HOLD = {
  DONE: Duration.seconds(3),
  FAILED: Duration.seconds(4),
} as const;

/** What a toast's action says when it takes back what the toast reports. */
export const UNDO_LABEL = "Undo";

/** A toast's one action: its button's label, and what a press of it does. */
interface ToastAction {
  readonly label: string;
  readonly onPress: () => void;
}

/**
 * A toast to show: its words and its tone, and either how long it stands
 * before it leaves or the action it carries, which sets its own hold.
 */
export type ToastNotice = { readonly words: string; readonly tone: ToastTone } & (
  | { readonly hold: Duration.Duration; readonly action?: never }
  | { readonly action: ToastAction; readonly hold?: never }
);

/** How long a toast carrying an action stands while nobody points at it: long enough to reach for the action. */
const ACTION_HOLD = Duration.seconds(5);

/** How long the toast takes to leave, as `--duration-exit` says it. */
const TOAST_EXIT = Duration.millis(MOTION_DURATION_MS.EXIT);

/** What can happen to the toast: one shown, its hold paused or let run again, or it sent away. */
const TOAST_STEP = {
  SHOW: "show",
  PAUSE: "pause",
  RESUME: "resume",
  DISMISS: "dismiss",
} as const;

type ToastStep =
  | { readonly kind: typeof TOAST_STEP.SHOW; readonly notice: ToastNotice }
  | {
      readonly kind: Exclude<(typeof TOAST_STEP)[keyof typeof TOAST_STEP], typeof TOAST_STEP.SHOW>;
    };

/**
 * The toast standing, counted among those shown so a new one is drawn anew,
 * whether it is on its way out, and what is left of its hold: the time left
 * as of `since`, the instant it last began running down, which is absent
 * while the hold is paused. Nothing while none stands.
 */
interface ToastShown {
  readonly count: number;
  readonly notice: ToastNotice;
  readonly leaving: boolean;
  readonly left: Duration.Duration;
  readonly since: number | undefined;
}

const toastShownAtom = Atom.keepAlive(Atom.make<ToastShown | undefined>(undefined));

/** What is left of a standing toast's hold at `now`: none once it is leaving. */
function holdLeft(shown: ToastShown, now: number): Duration.Duration {
  if (shown.leaving) return Duration.zero;
  if (shown.since === undefined) return shown.left;
  return Duration.max(
    Duration.zero,
    Duration.subtract(shown.left, Duration.millis(now - shown.since)),
  );
}

/**
 * A toast's life, as an atom whose work is its waits: it stands for its
 * hold, leaves, and is gone. A pause ends the wait where it stands and keeps
 * what was left of it, which a resume waits out; a pause while the toast is
 * leaving brings it back for the pointer that reached it. Note that it is
 * kept alive, because whoever asked for it is often a menu already unmounted
 * by the time it leaves, and each step interrupts the waits of the one
 * before it.
 */
const toastLifeAtom = Atom.keepAlive(
  rendererRuntime.fn((step: ToastStep, get) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const standing = get(toastShownAtom);
      const shown =
        step.kind === TOAST_STEP.SHOW
          ? {
              count: (standing?.count ?? 0) + 1,
              notice: step.notice,
              left: step.notice.hold ?? ACTION_HOLD,
            }
          : standing === undefined
            ? undefined
            : {
                count: standing.count,
                notice: standing.notice,
                left: step.kind === TOAST_STEP.DISMISS ? Duration.zero : holdLeft(standing, now),
              };
      if (shown === undefined) return;
      if (step.kind === TOAST_STEP.PAUSE) {
        get.set(toastShownAtom, { ...shown, leaving: false, since: undefined });
        return;
      }
      get.set(toastShownAtom, { ...shown, leaving: false, since: now });
      yield* Effect.sleep(shown.left);
      get.set(toastShownAtom, { ...shown, leaving: true, left: Duration.zero, since: undefined });
      yield* Effect.sleep(TOAST_EXIT);
      get.set(toastShownAtom, undefined);
    }),
  ),
);

/** Shows a toast, taking the place of any standing; the same function on every render. */
export function useToast(): (notice: ToastNotice) => void {
  const step = useAtomSet(toastLifeAtom);
  return useCallback((notice: ToastNotice) => step({ kind: TOAST_STEP.SHOW, notice }), [step]);
}

/**
 * One toast, drawn anew for each shown. Its hold is paused while the pointer
 * is over it or focus is in it, each of which it keeps apart, so that one
 * ending while the other stands lets nothing run.
 */
function ToastPill({
  shown,
  step,
}: {
  shown: ToastShown;
  step: (step: ToastStep) => void;
}): React.JSX.Element {
  const held = useRef({ pointer: false, focus: false });
  const { notice, leaving } = shown;
  const { action } = notice;
  const hold = (by: keyof typeof held.current, holding: boolean) => {
    const was = held.current.pointer || held.current.focus;
    held.current = { ...held.current, [by]: holding };
    const now = held.current.pointer || held.current.focus;
    if (now !== was) step({ kind: now ? TOAST_STEP.PAUSE : TOAST_STEP.RESUME });
  };
  return (
    <p
      className="toast"
      role="status"
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
          })}
    >
      {notice.tone === TOAST_TONE.FAILED ? (
        <CircleAlertIcon aria-hidden="true" />
      ) : (
        <CheckIcon aria-hidden="true" />
      )}
      {notice.words}
      {action === undefined ? null : (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            step({ kind: TOAST_STEP.DISMISS });
            action.onPress();
          }}
        >
          {action.label}
        </button>
      )}
    </p>
  );
}

/** The toast standing, at the window's foot. Mounted once, by the window's root. */
export function ToastHost(): React.JSX.Element | null {
  const shown = useAtomValue(toastShownAtom);
  const step = useAtomSet(toastLifeAtom);
  if (shown === undefined) return null;
  return createPortal(<ToastPill key={shown.count} shown={shown} step={step} />, document.body);
}
