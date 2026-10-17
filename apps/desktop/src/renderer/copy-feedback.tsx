/**
 * copy-feedback.tsx -- the window's one answer to a copy: a button's glyph turning to a check for a moment, or a toast for a copy made from a menu.
 *
 * Every copy goes to the shell's clipboard (`appPlatform().copyText`) and is
 * answered the way Linear, GitHub, and Vercel answer one. A copy button's
 * glyph crossfades to a check in the success colour for `BUTTON_HOLD`, then
 * back; its label and accessible name stay as they were, so nothing beside
 * it shifts, and only its hint says "Copied" while the check stands. A
 * clipboard that refused turns the glyph to an alert instead, for the same
 * moment, its hint saying so. A second press restarts the moment, and only
 * the last press's answer is shown, however the clipboard orders them. A copy
 * made from a menu has no button left to answer on once the menu closes, so
 * it is answered with the window's toast (`toast.tsx`) instead.
 */

import { useAtom } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";
import { appPlatform } from "./app-platform";
import { rendererRuntime } from "./renderer-runtime";
import { TOAST_TONE, useToast } from "./toast";

/** What a copy button shows: its resting glyph, the check, or the alert. */
const COPY_STATE = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;

export type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

/** How long a button's check, or its alert, stands: long enough to see, gone before anyone waits on it. */
const BUTTON_HOLD = Duration.millis(1_200);

/** How long a copy's toast stands before it leaves. */
const TOAST_HOLD = Duration.millis(1_500);

/** What a copy button's hint says while its check or its alert stands. */
const COPY_HINT = {
  [COPY_STATE.COPIED]: "Copied",
  [COPY_STATE.FAILED]: "Could not copy",
} as const;

/** What every item that copies a Luke link is called, wherever it stands, and what its toast says once the clipboard took it. */
export const LINK_COPY = {
  LABEL: "Copy link",
  COPIED: "Link copied",
} as const;

/** What a copy's toast says when the clipboard refused it. */
const COPY_FAILED_NOTE = "Could not copy to the clipboard. Try again.";

/**
 * The window's last menu copy, counted, so only its answer reaches the one
 * toast: a slower clipboard answering an earlier copy says nothing.
 */
let latestMenuCopy = 0;

/** What the clipboard's answer to a copy comes to: the check, or the alert. */
function copyAnswer(
  copying: Promise<void>,
): Promise<typeof COPY_STATE.COPIED | typeof COPY_STATE.FAILED> {
  return copying.then(
    () => COPY_STATE.COPIED,
    () => COPY_STATE.FAILED,
  );
}

/** A button's own hold, as an atom whose work is the wait: waiting exactly as long as the glyph stands. */
const buttonHoldAtom = () => rendererRuntime.fn(() => Effect.sleep(BUTTON_HOLD));

/** A copy button's state, and its press. */
interface CopyFeedback {
  readonly state: CopyState;
  readonly copy: (words: string) => void;
}

/**
 * One copy button's state and its press. The press hands the words to the
 * shell's clipboard and, once it answers, shows the check or the alert for the hold;
 * a press while one stands starts the hold again from its own answer.
 */
export function useCopyFeedback(): CopyFeedback {
  const [hold] = useState(buttonHoldAtom);
  const [held, restart] = useAtom(hold);
  const [landed, setLanded] = useState<CopyState>(COPY_STATE.IDLE);
  // Note that this is a ref, because an answer reads it as it lands, which
  // no render stands between.
  const latest = useRef(0);
  const copy = (words: string) => {
    latest.current += 1;
    const press = latest.current;
    copyAnswer(appPlatform().copyText(words)).then((answer) => {
      if (press !== latest.current) return;
      setLanded(answer);
      restart();
    });
  };
  return { state: held.waiting ? landed : COPY_STATE.IDLE, copy };
}

/** What a copy button's hint says in this state: its own label at rest. */
export function copyHint(state: CopyState, label: string): string {
  return state === COPY_STATE.IDLE ? label : COPY_HINT[state];
}

/**
 * A copy button's glyph: the copy, the check, and the alert stacked in one
 * square, only the one for the state shown, so the change is a crossfade
 * that never moves the button. Its state is announced by a line only a
 * reader hears, since the button's own name does not change.
 */
export function CopyGlyph({ state }: { state: CopyState }): React.JSX.Element {
  return (
    <span className="copy-glyph" data-state={state}>
      <CopyIcon aria-hidden="true" data-glyph={COPY_STATE.IDLE} />
      <CheckIcon aria-hidden="true" data-glyph={COPY_STATE.COPIED} />
      <CircleAlertIcon aria-hidden="true" data-glyph={COPY_STATE.FAILED} />
      <span className="visually-hidden" role="status">
        {state === COPY_STATE.IDLE ? "" : COPY_HINT[state]}
      </span>
    </span>
  );
}

/**
 * Copies from a menu: hands the words to the shell's clipboard and says what came
 * of it in a toast reading `label` ("Plan copied"), or the failure.
 */
export function useCopyToast(): (words: string, label: string) => void {
  const show = useToast();
  return (words, label) => {
    latestMenuCopy += 1;
    const press = latestMenuCopy;
    copyAnswer(appPlatform().copyText(words)).then((answer) => {
      if (press !== latestMenuCopy) return;
      show(
        answer === COPY_STATE.COPIED
          ? { words: label, tone: TOAST_TONE.DONE, hold: TOAST_HOLD }
          : { words: COPY_FAILED_NOTE, tone: TOAST_TONE.FAILED, hold: TOAST_HOLD },
      );
    });
  };
}
