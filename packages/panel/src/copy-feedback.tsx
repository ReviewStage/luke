/**
 * copy-feedback.tsx -- the window's copy acts: the shell's clipboard for a `CopyButton`, and a toast for a copy made from a menu.
 *
 * Every copy goes to the shell's clipboard (`appPlatform().copyText`, or
 * `copyImage` for a picture, drawn as a PNG where it is not one). A copy
 * button answers on itself (`CopyButton` in `@luke/ui`), handed the act
 * here; a copy made from a menu has no button left to answer on once the
 * menu closes, so it is answered with the window's toast (`toast.tsx`)
 * instead.
 */

import { STATUS_TONE } from "@luke/ui";
import { appPlatform } from "./app-platform.js";
import { TOAST_HOLD, useToast } from "./toast.js";

/** How a copy ended: the clipboard took it, or refused it. */
const COPY_STATE = {
  COPIED: "copied",
  FAILED: "failed",
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

/** What the clipboard's answer to a copy comes to: taken, or refused. */
function copyAnswer(
  copying: Promise<void>,
): Promise<typeof COPY_STATE.COPIED | typeof COPY_STATE.FAILED> {
  return copying.then(
    () => COPY_STATE.COPIED,
    () => COPY_STATE.FAILED,
  );
}

/** The copy act a `@luke/ui` copy button is handed: the words on the shell's clipboard, a refusal rejecting. */
export function copyThroughShell(words: string): Promise<void> {
  return appPlatform().copyText(words);
}

/** The copy act a `@luke/ui` copy button is handed for a picture: the one at `url` on the shell's clipboard, a refusal rejecting. */
export function copyImageThroughShell(url: string): Promise<void> {
  return appPlatform().copyImage(pngBase64Of(url));
}

/**
 * Copies from a menu: hands the words to the shell's clipboard and says what came
 * of it in a toast reading `label` ("Plan copied"), or the failure.
 */
export function useCopyToast(): (words: string, label: string) => void {
  const copied = useMenuCopy();
  return (words, label) => copied(() => copyThroughShell(words), label);
}

/** Copies a picture from a menu, as `useCopyToast` copies words: put on the clipboard as a copy button puts one, and said in a toast. */
export function useImageCopyToast(): (url: string, label: string) => void {
  const copied = useMenuCopy();
  return (url, label) => copied(() => copyImageThroughShell(url), label);
}

/** A menu's copy, said in a toast reading `label` once the clipboard answers, or its failure; only the latest press's answer is said. */
function useMenuCopy(): (copying: () => Promise<void>, label: string) => void {
  const show = useToast();
  return (copying, label) => {
    latestMenuCopy += 1;
    const press = latestMenuCopy;
    copyAnswer(copying()).then((answer) => {
      if (press !== latestMenuCopy) return;
      show(
        answer === COPY_STATE.COPIED
          ? { words: label, tone: STATUS_TONE.COMPLETE, hold: TOAST_HOLD.DONE }
          : { words: COPY_FAILED_NOTE, tone: STATUS_TONE.DANGER, hold: TOAST_HOLD.FAILED },
      );
    });
  };
}
