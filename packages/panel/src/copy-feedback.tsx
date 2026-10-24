import { STATUS_TONE, VisuallyHidden } from "@luke/ui";
/**
 * copy-feedback.tsx -- the window's one answer to a copy: a button's glyph turning to a check for a moment, or a toast for a copy made from a menu.
 *
 * Every copy goes to the shell's clipboard (`appPlatform().copyText`, or
 * `copyImage` for a picture, drawn as a PNG where it is not one) and is
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
import { MOTION_DELAY_MS } from "@luke/brand";
import { Duration, Effect } from "effect";
import { CheckIcon, CircleAlertIcon, CopyIcon } from "lucide-react";
import { useRef, useState } from "react";
import { appPlatform } from "./app-platform.js";
import { rendererRuntime } from "./renderer-runtime.js";
import { TOAST_HOLD, useToast } from "./toast.js";

/** What a copy button shows: its resting glyph, the check, or the alert. */
const COPY_STATE = {
  IDLE: "idle",
  COPIED: "copied",
  FAILED: "failed",
} as const;

export type CopyState = (typeof COPY_STATE)[keyof typeof COPY_STATE];

/** How long a button's check, or its alert, stands: long enough to see, gone before anyone waits on it. */
const BUTTON_HOLD = Duration.millis(MOTION_DELAY_MS.CONFIRM);

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

/** A PNG's `data:` address, its bytes in base64 up to any fragment. */
const PNG_DATA_URL = /^data:image\/png;base64,([^#]+)/u;

/**
 * The picture at `url` as a PNG's bytes in base64, the one shape every
 * clipboard takes a picture in: a PNG's own bytes as they are, and any
 * other picture drawn again as one.
 */
async function pngBase64Of(url: string): Promise<string> {
  const own = PNG_DATA_URL.exec(url)?.[1];
  if (own !== undefined) return own;
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("No canvas to draw the picture on.");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/u, "");
}

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

/** A copy button's state and its press. */
interface CopyFeedback {
  readonly state: CopyState;
  readonly copy: (words: string) => void;
}

/**
 * One copy button's state and its press. The press hands the words to the
 * shell's clipboard and, once it answers, shows the check or the alert for
 * the hold; a press while one stands starts the hold again from its own
 * answer.
 */
export function useCopyFeedback(): CopyFeedback {
  const [hold] = useState(buttonHoldAtom);
  const [held, restart] = useAtom(hold);
  const [landed, setLanded] = useState<CopyState>(COPY_STATE.IDLE);
  // Note that this is a ref, because an answer reads it as it lands, which
  // no render stands between.
  const latest = useRef(0);
  return {
    state: held.waiting ? landed : COPY_STATE.IDLE,
    copy: (words) => {
      latest.current += 1;
      const press = latest.current;
      copyAnswer(appPlatform().copyText(words)).then((answered) => {
        if (press !== latest.current) return;
        setLanded(answered);
        restart();
      });
    },
  };
}

/** The copy act a `@luke/ui` copy button is handed: the words on the shell's clipboard, a refusal rejecting. */
export function copyThroughShell(words: string): Promise<void> {
  return appPlatform().copyText(words);
}

/** The copy act a `@luke/ui` copy button is handed for a picture: the one at `url` on the shell's clipboard, a refusal rejecting. */
export function copyImageThroughShell(url: string): Promise<void> {
  return appPlatform().copyImage(pngBase64Of(url));
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
      <VisuallyHidden role="status">
        {state === COPY_STATE.IDLE ? "" : COPY_HINT[state]}
      </VisuallyHidden>
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
          ? { words: label, tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }
          : { words: COPY_FAILED_NOTE, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED },
      );
    });
  };
}
