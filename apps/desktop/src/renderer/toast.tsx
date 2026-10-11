/**
 * toast.tsx -- the window's one passing notice: a small pill at the foot of the window, read once and gone.
 *
 * It answers an act whose control is gone by the time it lands: a copy made
 * from a menu that closed with the press, or a note sent from a dialog that
 * closed with the send. One stands at a time, bottom-centre, with no action
 * on it; a second takes the first's place and starts its hold afresh. It
 * arrives on the pair every arriving element rides and leaves first over
 * `--duration-exit`, held mounted through its leaving, so reduced motion and
 * a capture run hold it still at the tokens. Its words are text like any
 * other, so the session recording masks them with the rest.
 */

import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@sidecar/surface";
import { Duration, Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { CheckIcon, CircleAlertIcon } from "lucide-react";
import { createPortal } from "react-dom";
import { rendererRuntime } from "./renderer-runtime";

/** What a toast reports: the act done, or the act refused. */
export const TOAST_TONE = {
  DONE: "done",
  FAILED: "failed",
} as const;

type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

/** A toast to show: its words, its tone, and how long it stands before it leaves. */
export interface ToastNotice {
  readonly words: string;
  readonly tone: ToastTone;
  readonly hold: Duration.Duration;
}

/** How long the toast takes to leave, as `--duration-exit` says it. */
const TOAST_EXIT = Duration.millis(MOTION_DURATION_MS.EXIT);

/** The toast standing, and whether it is on its way out; nothing while none stands. */
interface ToastShown {
  readonly notice: ToastNotice;
  readonly leaving: boolean;
}

const toastShownAtom = Atom.keepAlive(Atom.make<ToastShown | undefined>(undefined));

/**
 * A toast's life, as an atom whose work is its waits: it stands for its
 * hold, leaves, and is gone. Note that it is kept alive, because whoever
 * asked for it is often a menu already unmounted by the time it leaves, and
 * a second toast interrupts the first's waits and starts its own.
 */
const toastLifeAtom = Atom.keepAlive(
  rendererRuntime.fn((notice: ToastNotice, get) =>
    Effect.gen(function* () {
      get.set(toastShownAtom, { notice, leaving: false });
      yield* Effect.sleep(notice.hold);
      get.set(toastShownAtom, { notice, leaving: true });
      yield* Effect.sleep(TOAST_EXIT);
      get.set(toastShownAtom, undefined);
    }),
  ),
);

/** Shows a toast, taking the place of any standing. */
export function useToast(): (notice: ToastNotice) => void {
  return useAtomSet(toastLifeAtom);
}

/** The toast standing, at the window's foot. Mounted once, by the window's root. */
export function ToastHost(): React.JSX.Element | null {
  const shown = useAtomValue(toastShownAtom);
  if (shown === undefined) return null;
  const { notice, leaving } = shown;
  return createPortal(
    <p
      className="toast"
      role="status"
      data-tone={notice.tone}
      data-leaving={leaving ? "true" : undefined}
    >
      {notice.tone === TOAST_TONE.FAILED ? (
        <CircleAlertIcon aria-hidden="true" />
      ) : (
        <CheckIcon aria-hidden="true" />
      )}
      {notice.words}
    </p>,
    document.body,
  );
}
