import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { STATUS_TONE } from "@repo/ui";
import { appPlatform } from "./app-platform.js";
import { TOAST_HOLD, useToast } from "./toast.js";

export const LINK_COPY = {
  LABEL: "Copy link",
  COPIED: "Link copied",
} as const;

const COPY_FAILED_NOTE = "Could not copy to the clipboard. Try again.";

let latestMenuCopy = 0;

const PNG_DATA_URL = /^data:image\/png;base64,([^#]+)/u;

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

export function copyThroughShell(words: string): Promise<void> {
  return appPlatform().copyText(words);
}

export function copyImageThroughShell(url: string): Promise<void> {
  return appPlatform().copyImage(pngBase64Of(url));
}

export function useCopyToast(): (words: string, label: string) => void {
  const copied = useMenuCopy();
  return (words, label) => copied(() => copyThroughShell(words), label);
}

export function useImageCopyToast(): (url: string, label: string) => void {
  const copied = useMenuCopy();
  return (url, label) => copied(() => copyImageThroughShell(url), label);
}

function useMenuCopy(): (copying: () => Promise<void>, label: string) => void {
  const show = useToast();
  return (copying, label) => {
    latestMenuCopy += 1;
    const press = latestMenuCopy;
    copying().then(
      () => {
        if (press !== latestMenuCopy) return;
        show({
          words: label,
          tone: STATUS_TONE.COMPLETE,
          hold: TOAST_HOLD.DONE,
          replayUnmasked: true,
        });
      },
      (cause: unknown) => {
        if (press !== latestMenuCopy) return;
        show({
          words: COPY_FAILED_NOTE,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.COPY, cause },
          replayUnmasked: true,
        });
      },
    );
  };
}
