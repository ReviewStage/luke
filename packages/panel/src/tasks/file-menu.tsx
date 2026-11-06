import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { DownloadIcon, type PaneBarMenu, STATUS_TONE } from "@repo/ui";
import { FolderTreeIcon, GLYPH } from "@repo/ui/icons";
import { appPlatform } from "../app-platform.js";
import { useCopyToast } from "../copy-feedback.js";
import type { MenuAction } from "../desktop/action-menu.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { fileName } from "./file-ref-model.js";
import { WHOLE_TEXT, type WholeText } from "./file-tab-model.js";

const UNREAD = "The file could not be read in full.";
const REFUSED = "This file is too large to copy whole. Open it on GitHub instead.";

export const PATH_COPY_WORDS = {
  COPY_PATH: "Copy path",
  COPY_OLD_PATH: "Copy old path",
  COPY_NEW_PATH: "Copy new path",
  PATH_COPIED: "Path copied",
} as const;

function copyPathAction(path: string, copy: (text: string, words: string) => void): MenuAction {
  return {
    label: PATH_COPY_WORDS.COPY_PATH,
    icon: <FolderTreeIcon aria-hidden="true" />,
    onSelect: () => copy(path, PATH_COPY_WORDS.PATH_COPIED),
  };
}

export function useSaveText(): (name: string, text: string) => Promise<void> {
  const show = useToast();
  return (name, text) =>
    appPlatform()
      .saveFile({ name, text })
      .then(
        () => undefined,
        (cause: unknown) =>
          show({
            words: "The file could not be saved. Try again.",
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: { surface: FAILURE_SURFACE.FILE_SAVE, cause },
          }),
      );
}

export function useFileMenu({
  path,
  ready,
  readText,
}: {
  path: string;
  ready: boolean;
  readText: () => Promise<WholeText>;
}): PaneBarMenu {
  const copyWithToast = useCopyToast();
  const show = useToast();
  const saveText = useSaveText();
  const name = fileName(path);

  const withText = (use: (text: string) => void) =>
    readText().then((whole) => {
      if (whole.kind === WHOLE_TEXT.READ) use(whole.text);
      else {
        const refused = whole.kind === WHOLE_TEXT.REFUSED;
        show({
          words: refused ? REFUSED : UNREAD,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: refused
            ? { surface: FAILURE_SURFACE.FILE_READ, cause: whole.cause, refused }
            : { surface: FAILURE_SURFACE.FILE_READ, cause: whole.cause },
        });
      }
    });

  return {
    thing: "File",
    groups: [
      [
        {
          label: "Copy file name",
          icon: <GLYPH.COPY />,
          onSelect: () => copyWithToast(name, "File name copied"),
        },
        copyPathAction(path, copyWithToast),
        {
          label: "Copy file contents",
          icon: <GLYPH.COPY />,
          disabled: !ready,
          onSelect: () => withText((text) => copyWithToast(text, "File contents copied")),
        },
        {
          label: "Download file",
          icon: <DownloadIcon />,
          disabled: !ready,
          onSelect: () => withText((text) => saveText(name, text)),
        },
      ],
    ],
  };
}
